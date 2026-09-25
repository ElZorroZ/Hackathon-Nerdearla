"""Room Manager - Cola compartida round-robin con métricas y historial."""

import logging
import queue
import threading
import time
from typing import Optional

from src.config import CHUNK_DURATION
from src.models import AudioChunk, SubtitleEntry, KeyMoment
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
        self._room_langs: dict[str, str] = {}  # idioma fuente por sala
        self._requested_langs: dict[str, set[str]] = {}  # idiomas destino pedidos por clientes
        self._word_counts: dict[str, int] = {}  # contador de palabras por sala
        self._key_moments: dict[str, list[KeyMoment]] = {}  # hitos por sala
        self._key_moment_callbacks: list = []  # callbacks para emitir key moments vía WS

    def add_room(self, room_id: str, lang: str = "es") -> None:
        with self._lock:
            if room_id not in self.audio_queues:
                self.audio_queues[room_id] = queue.Queue(maxsize=50)
                self.results_queues[room_id] = queue.Queue(maxsize=100)
                self.store.register_room(room_id)
                self.metrics.register_room(room_id)
                self._room_langs[room_id] = lang
                self._word_counts[room_id] = 0
                self._key_moments[room_id] = []
                logger.info("Sala registrada: %s (lang=%s)", room_id, lang)

    # Zero-Lag: si la cola acumula más de MAX_QUEUE_LAG chunks, flush y tomar el más reciente
    MAX_QUEUE_LAG = 3

    def set_room_lang(self, room_id: str, lang: str) -> None:
        with self._lock:
            self._room_langs[room_id] = lang
            logger.info("Sala %s: idioma cambiado a %s", room_id, lang)

    def request_room_lang(self, room_id: str, lang: str) -> None:
        """Registra un idioma destino pedido por un cliente para una sala."""
        if not lang or lang == "original":
            return
        with self._lock:
            langs = self._requested_langs.setdefault(room_id, set())
            if lang not in langs:
                langs.add(lang)
                logger.info("Sala %s: idioma destino pedido: %s (total: %s)",
                            room_id, lang, sorted(langs))

    def get_requested_langs(self, room_id: str) -> set[str]:
        """Idiomas destino activos: los pedidos por clientes + TARGET_LANG default."""
        langs = set(self._requested_langs.get(room_id, set()))
        langs.add(self.translator.target_lang)
        return langs

    def get_room_lang(self, room_id: str) -> str:
        return self._room_langs.get(room_id, "es")

    def get_key_moments(self, room_id: str) -> list[dict]:
        moments = self._key_moments.get(room_id, [])
        import datetime
        return [
            {
                "timestamp": km.timestamp,
                "time_str": datetime.datetime.fromtimestamp(km.timestamp).strftime("%H:%M:%S"),
                "title": km.title,
                "subtitle_index": km.subtitle_index,
            }
            for km in moments
        ]

    def on_key_moment(self, callback) -> None:
        """Registra un callback para emitir key moments vía WebSocket."""
        self._key_moment_callbacks.append(callback)

    def get_transcript_text(self, room_id: str) -> str:
        """Devuelve todo el historial de transcripción de una sala como texto plano."""
        entries = self.store.get_all(room_id)
        return " ".join(e.original for e in entries if e.original)

    def submit_audio(self, room_id: str, audio_bytes: bytes) -> None:
        if room_id in self.audio_queues and room_id not in self._paused:
            q = self.audio_queues[room_id]
            # Zero-Lag policy: si hay >= MAX_QUEUE_LAG chunks pendientes, vaciar cola
            pending = q.qsize()
            if pending >= self.MAX_QUEUE_LAG:
                flushed = 0
                while not q.empty():
                    try:
                        q.get_nowait()
                        flushed += 1
                    except queue.Empty:
                        break
                logger.warning(
                    "[Zero-Lag] Sala %s: flush de %d chunks viejos (latencia > %.1fs)",
                    room_id, flushed, pending * CHUNK_DURATION,
                )
                self.metrics.set_status(room_id, "active")
            try:
                q.put_nowait(AudioChunk(room_id=room_id, audio_bytes=audio_bytes))
            except queue.Full:
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
                try:
                    q.put_nowait(AudioChunk(room_id=room_id, audio_bytes=audio_bytes))
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
                    room_lang = self._room_langs.get(room_id, "es")
                    original, detected_lang, avg_logprob, no_speech_prob = self.whisper.transcribe(
                        chunk.audio_bytes, language=room_lang, initial_prompt=prev_text
                    )
                    t1 = time.perf_counter()

                    if not original:
                        # Limpiar contexto si el chunk fue descartado
                        self._last_text[room_id] = ""
                        # Still record audio quality even if text was empty
                        self.metrics.record_subtitle(room_id, 0, 0, avg_logprob, no_speech_prob)
                        continue

                    # Deduplicar solapamiento: si el inicio del texto nuevo coincide
                    # con el final del texto anterior (por chunk overlap), cortar la parte repetida
                    prev_text = self._last_text.get(room_id, "")
                    if prev_text:
                        original = self._dedup_overlap(prev_text, original)

                    # Guardar contexto para el próximo chunk
                    self._last_text[room_id] = original

                    # Traducir a todos los idiomas pedidos por clientes
                    target_langs = self.get_requested_langs(room_id)
                    translations: dict[str, str] = {}
                    translated = original
                    for tl in target_langs:
                        if detected_lang and detected_lang == tl:
                            translations[tl] = original
                        else:
                            translations[tl] = self.translator.translate(original, target_lang=tl)
                    # Compat: `translated` conserva el idioma default (TARGET_LANG)
                    default_lang = self.translator.target_lang
                    translated = translations.get(default_lang, original)
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
                        translations=translations,
                    )

                    self.store.add(entry)
                    self.metrics.record_subtitle(room_id, whisper_ms, gemma_ms, avg_logprob, no_speech_prob)

                    # Key Moments: extraer título cada ~300 palabras
                    word_count = len(original.split())
                    self._word_counts[room_id] = self._word_counts.get(room_id, 0) + word_count
                    if self._word_counts[room_id] >= 300:
                        self._word_counts[room_id] = 0
                        self._extract_key_moment(room_id, room_lang, entry.index)

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

    def _extract_key_moment(self, room_id: str, lang: str, subtitle_index: int) -> None:
        """Extrae un título de tema con Gemma en segundo plano."""
        try:
            # Usar las últimas ~30 entradas como contexto
            entries = self.store.get_all(room_id)
            recent = entries[-30:] if len(entries) > 30 else entries
            text = " ".join(e.original for e in recent if e.original)
            if len(text) < 20:
                return

            title = self.translator.extract_key_moment(text, lang)
            if not title:
                return

            km = KeyMoment(
                room_id=room_id,
                timestamp=time.time(),
                title=title,
                subtitle_index=subtitle_index,
            )
            self._key_moments.setdefault(room_id, []).append(km)
            logger.info("[%s] Key moment: %s", room_id, title)

            # Notificar callbacks (para emitir vía WS)
            import datetime
            km_data = {
                "type": "key_moment",
                "room_id": room_id,
                "timestamp": km.timestamp,
                "time_str": datetime.datetime.fromtimestamp(km.timestamp).strftime("%H:%M:%S"),
                "title": title,
                "subtitle_index": subtitle_index,
            }
            for cb in self._key_moment_callbacks:
                try:
                    cb(km_data)
                except Exception as e:
                    logger.error("Error en key_moment callback: %s", e)
        except Exception as e:
            logger.error("[%s] Error extrayendo key moment: %s", room_id, e)
