"""Whisper Engine - Singleton en GPU para transcripción de audio."""

import io
import logging
import threading
import wave
from typing import Optional

import numpy as np
import whisper

from src.config import WHISPER_MODEL, WHISPER_DEVICE, SAMPLE_RATE

logger = logging.getLogger("whisper_engine")


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

        # Filtrar chunks de silencio (RMS muy bajo)
        rms = np.sqrt(np.mean(audio_np ** 2))
        if rms < 0.01:
            logger.debug("Chunk descartado por silencio (RMS=%.4f)", rms)
            return ""

        result = self.model.transcribe(
            audio_np,
            language=language,
            fp16=True,
            task="transcribe",
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            logprob_threshold=-1.0,
            compression_ratio_threshold=2.4,
            initial_prompt="",
            beam_size=1,
            best_of=1,
        )
        text = result.get("text", "").strip()

        # Filtrar transcripciones basura (muy cortas o repetitivas)
        if len(text) < 2:
            return ""
        words = text.split()
        if len(words) > 0:
            unique_ratio = len(set(words)) / len(words)
            if unique_ratio < 0.3 and len(words) > 4:
                logger.debug("Chunk descartado por repetitivo: %s", text[:60])
                return ""
        return text

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
