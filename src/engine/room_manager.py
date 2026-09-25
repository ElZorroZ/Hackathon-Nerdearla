"""Room Manager - Cola compartida round-robin con métricas y historial."""

import logging
import queue
import threading
import time
from typing import Optional

from src.config import CHUNK_DURATION
from src.models import AudioChunk, SubtitleEntry
from src.engine.whisper_engine import WhisperEngine
from src.engine.translator import GemmaTranslator
from src.services.subtitle_store import SubtitleStore
from src.services.metrics_collector import MetricsCollector

logger = logging.getLogger("room_manager")


class RoomManager:
    """Gestiona múltiples salas con una sola instancia de Whisper."""

    def __init__(
        self,
        whisper_engine: WhisperEngine,
        translator: GemmaTranslator,
        subtitle_store: SubtitleStore,
        metrics: MetricsCollector,
    ):
        self.whisper = whisper_engine
        self.translator = translator
        self.store = subtitle_store
        self.metrics = metrics
        self.audio_queues: dict[str, queue.Queue] = {}
        self.results_queues: dict[str, queue.Queue] = {}
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._paused: set[str] = set()
        self._last_text: dict[str, str] = {}  # contexto por sala

    def add_room(self, room_id: str) -> None:
        with self._lock:
            if room_id not in self.audio_queues:
                self.audio_queues[room_id] = queue.Queue(maxsize=50)
                self.results_queues[room_id] = queue.Queue(maxsize=100)
                self.store.register_room(room_id)
                self.metrics.register_room(room_id)
                logger.info("Sala registrada: %s", room_id)

    def submit_audio(self, room_id: str, audio_bytes: bytes) -> None:
        if room_id in self.audio_queues and room_id not in self._paused:
            try:
                self.audio_queues[room_id].put_nowait(
                    AudioChunk(room_id=room_id, audio_bytes=audio_bytes)
                )
            except queue.Full:
                # Descartar chunk más viejo y encolar el nuevo
                try:
                    self.audio_queues[room_id].get_nowait()
                except queue.Empty:
                    pass
                try:
                    self.audio_queues[room_id].put_nowait(
                        AudioChunk(room_id=room_id, audio_bytes=audio_bytes)
                    )
                except queue.Full:
                    pass
                logger.warning("Cola llena para sala %s, descartando chunk viejo", room_id)

    def get_result(self, room_id: str, timeout: float = 0.1) -> Optional[SubtitleEntry]:
        if room_id in self.results_queues:
            try:
                return self.results_queues[room_id].get(timeout=timeout)
            except queue.Empty:
                return None
        return None

    def pause_room(self, room_id: str) -> bool:
        with self._lock:
            if room_id in self.audio_queues:
                self._paused.add(room_id)
                self.metrics.set_status(room_id, "paused")
                return True
            return False

    def resume_room(self, room_id: str) -> bool:
        with self._lock:
            if room_id in self._paused:
                self._paused.discard(room_id)
                self.metrics.set_status(room_id, "active")
                return True
            return False

    def clear_room(self, room_id: str) -> bool:
        with self._lock:
            if room_id in self.audio_queues:
                while not self.audio_queues[room_id].empty():
                    try:
                        self.audio_queues[room_id].get_nowait()
                    except queue.Empty:
                        break
                self.store.clear(room_id)
                return True
            return False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._process_loop, daemon=True)
        self._thread.start()
        logger.info("RoomManager iniciado (procesamiento round-robin)")

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _process_loop(self) -> None:
        """Loop principal: round-robin entre salas."""
        while self._running:
            processed_any = False
            for room_id, q in list(self.audio_queues.items()):
                if room_id in self._paused:
                    continue
                try:
                    chunk = q.get_nowait()
                except queue.Empty:
                    continue

                processed_any = True
                t0 = time.perf_counter()

                try:
                    prev_text = self._last_text.get(room_id, "")
                    original, detected_lang = self.whisper.transcribe(chunk.audio_bytes, initial_prompt=prev_text)
                    t1 = time.perf_counter()

                    if not original:
                        # Limpiar contexto si el chunk fue descartado
                        self._last_text[room_id] = ""
                        continue

                    # Deduplicar solapamiento: si el inicio del texto nuevo coincide
                    # con el final del texto anterior (por chunk overlap), cortar la parte repetida
                    prev_text = self._last_text.get(room_id, "")
                    if prev_text:
                        original = self._dedup_overlap(prev_text, original)

                    # Guardar contexto para el próximo chunk
                    self._last_text[room_id] = original

                    # Si Whisper detectó que el texto ya está en el idioma destino, no traducir
                    target_lang = self.translator.target_lang
                    if detected_lang and detected_lang == target_lang:
                        translated = original
                        t2 = time.perf_counter()
                    else:
                        translated = self.translator.translate(original)
                        t2 = time.perf_counter()

                    whisper_ms = (t1 - t0) * 1000
                    gemma_ms = (t2 - t1) * 1000

                    entry = SubtitleEntry(
                        room_id=room_id,
                        original=original,
                        translated=translated,
                        start_time=time.time(),
                        end_time=time.time() + CHUNK_DURATION,
                        whisper_latency_ms=whisper_ms,
                        gemma_latency_ms=gemma_ms,
                    )

                    self.store.add(entry)
                    self.metrics.record_subtitle(room_id, whisper_ms, gemma_ms)

                    try:
                        self.results_queues[room_id].put_nowait(entry)
                    except queue.Full:
                        pass

                    logger.info(
                        "[%s] whisper=%.0fms gemma=%.0fms | orig: %s | trad: %s",
                        room_id,
                        whisper_ms,
                        gemma_ms,
                        original[:60],
                        translated[:60],
                    )
                except Exception as e:
                    logger.error("[%s] Error procesando chunk: %s", room_id, e)
                    self.metrics.record_error(room_id, str(e))

            if not processed_any:
                time.sleep(0.05)

    @staticmethod
    def _dedup_overlap(prev: str, new: str) -> str:
        """Corta la parte solapada del inicio de `new` que ya estaba al final de `prev`."""
        import re

        def normalize(w: str) -> str:
            return re.sub(r'[^\w]', '', w.lower())

        prev_words = prev.split()
        new_words = new.split()
        if not prev_words or not new_words:
            return new

        prev_norm = [normalize(w) for w in prev_words]
        new_norm = [normalize(w) for w in new_words]

        # Buscar el mayor prefijo de new que coincide con un sufijo de prev
        max_overlap = 0
        max_check = min(len(prev_norm), len(new_norm), 15)
        for n in range(max_check, 0, -1):
            if prev_norm[-n:] == new_norm[:n]:
                max_overlap = n
                break

        if max_overlap > 0:
            deduped = " ".join(new_words[max_overlap:])
            if deduped.strip():
                logger.debug("Dedup: removed %d words from overlap: '%s' -> '%s'",
                             max_overlap, new[:60], deduped[:60])
                return deduped
        return new
