"""Whisper Engine - Singleton en GPU para transcripción de audio (faster-whisper)."""

import ctypes
import io
import logging
import os
import sys
import threading
import wave
from typing import Optional

import numpy as np

from src.config import WHISPER_MODEL, WHISPER_DEVICE, SAMPLE_RATE

logger = logging.getLogger("whisper_engine")

# Preload CUDA 12 libs for ctranslate2 with RTLD_GLOBAL (system has CUDA 13)
_VENV_NVIDIA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".venv", "lib", f"python{sys.version_info.major}.{sys.version_info.minor}",
    "site-packages", "nvidia",
)
for _lib_dir in ["cuda_runtime/lib", "cuda_nvrtc/lib", "cublas/lib"]:
    _full = os.path.join(_VENV_NVIDIA, _lib_dir)
    if os.path.isdir(_full):
        for _so in sorted(os.listdir(_full)):
            if _so.endswith(".so") or ".so." in _so:
                try:
                    ctypes.CDLL(os.path.join(_full, _so), mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass

from faster_whisper import WhisperModel


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
        compute_type = "float16" if device == "cuda" else "int8"
        logger.info("Cargando faster-whisper model='%s' device='%s' compute='%s'...",
                     model_name, device, compute_type)
        self.model = WhisperModel(model_name, device=device, compute_type=compute_type)
        self._loaded = True
        logger.info("faster-whisper cargado en GPU ✓")

    def transcribe(self, audio_bytes: bytes, language: str = None, initial_prompt: str = "") -> tuple[str, str]:
        """Transcribe audio bytes (WAV 16kHz mono) a texto. Returns (text, detected_language)."""
        audio_np = self._bytes_to_numpy(audio_bytes)
        if audio_np.size == 0:
            return "", ""

        # Filtrar chunks de silencio (RMS muy bajo)
        rms = np.sqrt(np.mean(audio_np ** 2))
        logger.debug("Chunk RMS=%.4f size=%d", rms, audio_np.size)
        if rms < 0.01:
            logger.debug("Chunk descartado por silencio (RMS=%.4f)", rms)
            return "", ""

        # Usar las últimas palabras como contexto para Whisper
        prompt = initial_prompt.strip()
        if len(prompt) > 200:
            prompt = " ".join(prompt.split()[-20:])

        kwargs = dict(
            task="transcribe",
            condition_on_previous_text=False,
            no_speech_threshold=0.5,
            log_prob_threshold=-0.8,
            compression_ratio_threshold=2.4,
            initial_prompt=prompt if prompt else None,
            beam_size=1,
            best_of=1,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
        )
        if language:
            kwargs["language"] = language

        segments, info = self.model.transcribe(audio_np, **kwargs)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        detected_lang = info.language if info else ""

        # Filtrar transcripciones basura (muy cortas o repetitivas)
        if len(text) < 2:
            return "", ""
        words = text.split()
        if len(words) > 0:
            unique_ratio = len(set(words)) / len(words)
            if unique_ratio < 0.4 and len(words) > 2:
                logger.debug("Chunk descartado por repetitivo: %s", text[:60])
                return "", ""

        # Filtrar solo garbage obvio
        GARBAGE_PATTERNS = {"music", "[music]", "!!!!", "..."}
        if text.lower().strip() in GARBAGE_PATTERNS:
            logger.debug("Chunk descartado por garbage: %s", text[:60])
            return "", ""

        # Filtrar texto con caracteres no-latinos (CJK, Korean, etc.)
        latin_chars = sum(1 for c in text if c.isascii() or c in "áéíóúñüÁÉÍÓÚÑÜ¿¡")
        if len(text) > 0 and latin_chars / len(text) < 0.8:
            logger.warning("Chunk descartado por caracteres no-latinos: %s", text[:60])
            return "", ""

        logger.info("Whisper: lang=%s text=%s", detected_lang, text[:80])
        return text, detected_lang

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
