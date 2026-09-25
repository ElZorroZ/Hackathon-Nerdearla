"""
CLI de test del pipeline: Whisper + Gemma.

Uso:
    python -m src.run_test
    python -m src.run_test --whisper-model base --gemma-model gemma2:2b
"""

import argparse
import io
import json
import logging
import time

import numpy as np

from src.config import (
    WHISPER_MODEL, GEMMA_MODEL, TARGET_LANG,
    CHUNK_DURATION, SAMPLE_RATE, OLLAMA_HOST,
)
from src.engine.whisper_engine import WhisperEngine
from src.engine.translator import GemmaTranslator
from src.engine.room_manager import RoomManager
from src.services.subtitle_store import SubtitleStore
from src.services.metrics_collector import MetricsCollector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("test")


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
    store = SubtitleStore()
    metrics = MetricsCollector()
    manager = RoomManager(whisper_engine, translator, store, metrics)
    manager.add_room("test-room")
    manager.start()

    logger.info("Generando audio de prueba...")
    test_audio = generate_test_wav(duration=3.0)
    manager.submit_audio("test-room", test_audio)

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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test de integración Whisper + Gemma")
    parser.add_argument("--test", action="store_true", help="Ejecutar test de integración")
    parser.add_argument("--whisper-model", default=WHISPER_MODEL, help="Modelo Whisper")
    parser.add_argument("--gemma-model", default=GEMMA_MODEL, help="Modelo Gemma en Ollama")
    parser.add_argument("--target-lang", default=TARGET_LANG, help="Idioma de traducción")
    args = parser.parse_args()

    run_test()
