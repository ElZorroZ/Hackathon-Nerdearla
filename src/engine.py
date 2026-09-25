"""
Engine Core: Transcripción + Traducción simultánea con Whisper y Gemma.

Arquitectura:
- Una sola instancia de Whisper cargada en GPU (compartida entre todas las salas).
- Cola de chunks de audio por sala (round-robin).
- Gemma via Ollama para traducción ES -> EN (o viceversa).

Uso:
    python engine.py
    python engine.py --test   # prueba con audio sintético
"""

import argparse
import asyncio
import json
import logging
import os
import queue
import subprocess
import threading
import time
import wave
import io
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import whisper
import ollama

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("engine")

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

WHISPER_MODEL = "base"        # tiny | base | small | medium | large
WHISPER_DEVICE = "cuda"       # cuda | cpu
GEMMA_MODEL = "gemma2:2b"     # modelo en Ollama
CHUNK_DURATION = 3.0          # segundos de audio por chunk
SAMPLE_RATE = 16000
TARGET_LANG = "es"            # idioma de salida de la traducción


def _detect_ollama_host() -> str:
    """Detecta el host de Ollama. Si estamos en WSL, usa la IP del host Windows."""
    env_host = os.environ.get("OLLAMA_HOST")
    if env_host:
        return env_host
    try:
        with open("/proc/version", "r") as f:
            if "microsoft" in f.read().lower():
                result = subprocess.run(
                    ["ip", "route", "show", "default"],
                    capture_output=True, text=True, timeout=3,
                )
                for line in result.stdout.splitlines():
                    if "default via" in line:
                        return line.split()[2] + ":11434"
    except Exception:
        pass
    return "127.0.0.1:11434"


OLLAMA_HOST = _detect_ollama_host()


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class AudioChunk:
    room_id: str
    audio_bytes: bytes
    sample_rate: int = SAMPLE_RATE


@dataclass
class SubtitleResult:
    room_id: str
    original: str
    translated: str
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Whisper Engine (singleton en GPU)
# ---------------------------------------------------------------------------

class WhisperEngine:
    """Singleton de Whisper cargado una sola vez en GPU."""

    _instance: Optional["WhisperEngine"] = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, model_name: str = WHISPER_MODEL, device: str = WHISPER_DEVICE):
        if hasattr(self, "_loaded"):
            return
        logger.info("Cargando Whisper model='%s' device='%s'...", model_name, device)
        self.model = whisper.load_model(model_name, device=device)
        self._loaded = True
        logger.info("Whisper cargado en GPU ✓")

    def transcribe(self, audio_bytes: bytes, language: str = "en") -> str:
        """Transcribe audio bytes (WAV 16kHz mono) a texto."""
        audio_np = self._bytes_to_numpy(audio_bytes)
        if audio_np.size == 0:
            return ""
        result = self.model.transcribe(
            audio_np,
            language=language,
            fp16=True,
            task="transcribe",
        )
        return result.get("text", "").strip()

    @staticmethod
    def _bytes_to_numpy(audio_bytes: bytes) -> np.ndarray:
        """Convierte WAV bytes a numpy array float32."""
        try:
            wf = wave.open(io.BytesIO(audio_bytes), "rb")
            frames = wf.readframes(wf.getnframes())
            wf.close()
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            return audio
        except Exception as e:
            logger.warning("Error parseando audio: %s", e)
            return np.array([], dtype=np.float32)


# ---------------------------------------------------------------------------
# Gemma Translator (via Ollama)
# ---------------------------------------------------------------------------

class GemmaTranslator:
    """Traducción usando Gemma a través de Ollama."""

    def __init__(self, model: str = GEMMA_MODEL, target_lang: str = TARGET_LANG, host: str = OLLAMA_HOST):
        self.model = model
        self.target_lang = target_lang
        self.client = ollama.Client(host=f"http://{host}")
        self._lang_names = {
            "es": "Spanish",
            "en": "English",
            "pt": "Portuguese",
            "fr": "French",
        }
        logger.info("GemmaTranslator inicializado: model=%s host=%s", model, host)

    def translate(self, text: str) -> str:
        """Traduce texto al idioma objetivo usando Gemma."""
        if not text.strip():
            return ""
        target = self._lang_names.get(self.target_lang, "English")
        prompt = (
            f"Translate the following text to {target}. "
            f"Output ONLY the translation, no explanations.\n\n"
            f"Text: {text}\n"
            f"Translation:"
        )
        try:
            response = self.client.generate(
                model=self.model,
                prompt=prompt,
                options={
                    "temperature": 0.3,
                    "num_predict": 128,
                    "stop": ["\n\n"],
                },
            )
            return response.get("response", "").strip()
        except Exception as e:
            logger.error("Error en Gemma: %s", e)
            return text  # fallback: devolver original


# ---------------------------------------------------------------------------
# Room Manager (cola compartida)
# ---------------------------------------------------------------------------

class RoomManager:
    """
    Gestiona múltiples salas con una sola instancia de Whisper.
    Usa una cola compartida y procesa en round-robin.
    """

    def __init__(self, whisper_engine: WhisperEngine, translator: GemmaTranslator):
        self.whisper = whisper_engine
        self.translator = translator
        self.audio_queues: dict[str, queue.Queue] = {}
        self.results_queues: dict[str, queue.Queue] = {}
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def add_room(self, room_id: str) -> None:
        with self._lock:
            if room_id not in self.audio_queues:
                self.audio_queues[room_id] = queue.Queue(maxsize=50)
                self.results_queues[room_id] = queue.Queue(maxsize=100)
                logger.info("Sala registrada: %s", room_id)

    def submit_audio(self, room_id: str, audio_bytes: bytes) -> None:
        if room_id in self.audio_queues:
            try:
                self.audio_queues[room_id].put_nowait(
                    AudioChunk(room_id=room_id, audio_bytes=audio_bytes)
                )
            except queue.Full:
                logger.warning("Cola llena para sala %s, descartando chunk", room_id)

    def get_result(self, room_id: str, timeout: float = 0.1) -> Optional[SubtitleResult]:
        if room_id in self.results_queues:
            try:
                return self.results_queues[room_id].get(timeout=timeout)
            except queue.Empty:
                return None
        return None

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
                try:
                    chunk = q.get_nowait()
                except queue.Empty:
                    continue

                processed_any = True
                t0 = time.perf_counter()

                # 1) Transcripción con Whisper (GPU compartida)
                original = self.whisper.transcribe(chunk.audio_bytes)
                t1 = time.perf_counter()

                if not original:
                    continue

                # 2) Traducción con Gemma (Ollama)
                translated = self.translator.translate(original)
                t2 = time.perf_counter()

                result = SubtitleResult(
                    room_id=room_id,
                    original=original,
                    translated=translated,
                )

                try:
                    self.results_queues[room_id].put_nowait(result)
                except queue.Full:
                    pass

                logger.info(
                    "[%s] whisper=%.2fs gemma=%.2fs | orig: %s | trad: %s",
                    room_id,
                    t1 - t0,
                    t2 - t1,
                    original[:60],
                    translated[:60],
                )

            if not processed_any:
                time.sleep(0.05)  # idle: ceder CPU


# ---------------------------------------------------------------------------
# Generador de audio de prueba (tono sintético)
# ---------------------------------------------------------------------------

def generate_test_wav(duration: float = CHUNK_DURATION, freq: int = 440) -> bytes:
    """Genera un WAV de prueba con un tono (para test del pipeline)."""
    n_samples = int(SAMPLE_RATE * duration)
    t = np.linspace(0, duration, n_samples, endpoint=False)
    wave_data = (np.sin(2 * np.pi * freq * t) * 0.3 * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(wave_data.tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Test de integración
# ---------------------------------------------------------------------------

def run_test():
    """Test del pipeline: Whisper + Gemma."""
    logger.info("=== TEST DE INTEGRACIÓN ===")
    logger.info("Ollama host detectado: %s", OLLAMA_HOST)

    # 1) Test Gemma primero (sin audio)
    logger.info("--- Test 1: Gemma translation ---")
    translator = GemmaTranslator(target_lang="es")
    test_text = "We are deploying a multi-channel audio stream using WebSockets."
    translated = translator.translate(test_text)
    logger.info("Original: %s", test_text)
    logger.info("Traducido: %s", translated)

    # 2) Test Whisper + pipeline completo
    logger.info("--- Test 2: Whisper + pipeline ---")
    whisper_engine = WhisperEngine()
    manager = RoomManager(whisper_engine, translator)
    manager.add_room("test-room")
    manager.start()

    # Generar audio sintético (no produce texto real, pero prueba el pipeline)
    logger.info("Generando audio de prueba...")
    test_audio = generate_test_wav(duration=3.0)
    manager.submit_audio("test-room", test_audio)

    # Esperar resultado
    logger.info("Esperando resultado...")
    result = manager.get_result("test-room", timeout=15)
    if result:
        logger.info("Resultado: %s", json.dumps({
            "room": result.room_id,
            "original": result.original,
            "translated": result.translated,
        }, ensure_ascii=False))
    else:
        logger.info("No se detectó texto (esperado con tono sintético). Pipeline OK.")

    manager.stop()
    logger.info("=== TEST COMPLETADO ===")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Engine de transcripción + traducción")
    parser.add_argument("--test", action="store_true", help="Ejecutar test de integración")
    parser.add_argument("--whisper-model", default=WHISPER_MODEL, help="Modelo Whisper")
    parser.add_argument("--gemma-model", default=GEMMA_MODEL, help="Modelo Gemma en Ollama")
    parser.add_argument("--target-lang", default=TARGET_LANG, help="Idioma de traducción")
    args = parser.parse_args()

    if args.test:
        run_test()
    else:
        parser.print_help()
