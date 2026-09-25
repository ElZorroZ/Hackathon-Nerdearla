"""Whisper Engine - Singleton en GPU para transcripción de audio (faster-whisper)."""

import ctypes
import io
import logging
import os
import subprocess
import sys
import tempfile
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

    def transcribe(self, audio_bytes: bytes, language: str = None, initial_prompt: str = "") -> tuple[str, str, float, float]:
        """Transcribe audio bytes (WAV 16kHz mono) a texto. Returns (text, detected_language, avg_logprob, no_speech_prob)."""
        audio_np = self._bytes_to_numpy(audio_bytes)
        if audio_np.size == 0:
            return "", "", 0.0, 1.0

        # Filtrar chunks de silencio (RMS muy bajo)
        rms = np.sqrt(np.mean(audio_np ** 2))
        logger.debug("Chunk RMS=%.4f size=%d", rms, audio_np.size)
        if rms < 0.01:
            logger.debug("Chunk descartado por silencio (RMS=%.4f)", rms)
            return "", "", 0.0, 1.0

        # Usar las últimas palabras como contexto para Whisper
        prompt = initial_prompt.strip()
        if len(prompt) > 200:
            prompt = " ".join(prompt.split()[-20:])

        kwargs = dict(
            task="transcribe",
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4,
            initial_prompt=prompt if prompt else None,
            beam_size=5,
            best_of=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=700, speech_pad_ms=400),
        )
        if language:
            kwargs["language"] = language

        segments, info = self.model.transcribe(audio_np, **kwargs)
        seg_list = list(segments)
        # Filtrar segmentos con alto no_speech_prob (alucinaciones en silencio)
        # faster-whisper deberia hacerlo con no_speech_threshold, pero a veces
        # pasan segmentos con no_speech alto que igual producen texto.
        NO_SPEECH_FILTER = 0.6
        filtered_segs = [s for s in seg_list if s.no_speech_prob < NO_SPEECH_FILTER]
        text = " ".join(seg.text.strip() for seg in filtered_segs).strip()
        detected_lang = info.language if info else ""
        avg_logprob = sum(s.avg_logprob for s in filtered_segs) / len(filtered_segs) if filtered_segs else 0.0
        no_speech_prob = max((s.no_speech_prob for s in seg_list), default=0.0)

        # Si todos los segmentos fueron filtrados por no_speech, descartar
        if not text or not filtered_segs:
            logger.debug("Chunk descartado: todos los segmentos son no_speech (prob=%.2f)", no_speech_prob)
            return "", "", avg_logprob, no_speech_prob

        # Filtrar transcripciones basura (muy cortas o repetitivas)
        if len(text) < 2:
            return "", "", avg_logprob, no_speech_prob
        words = text.split()
        if len(words) > 0:
            unique_ratio = len({w.lower().strip(".,;:!?") for w in words}) / len(words)
            # Solo descartar alucinaciones de Whisper: muchas palabras (>6) con
            # casi ninguna única (<0.25). Repeticiones cortas legítimas como
            # "hola hola hola" pasan sin problema.
            if unique_ratio < 0.25 and len(words) > 6:
                logger.debug("Chunk descartado por repetitivo: %s", text[:60])
                return "", "", avg_logprob, no_speech_prob

        # Filtrar garbage obvio + alucinaciones clásicas de YouTube ( Whisper las
        # genera cuando procesa silencio o música de cierre de video )
        GARBAGE_PATTERNS = {
            "music", "[music]", "!!!!", "...",
        }
        YOUTUBE_HALLUCINATIONS = {
            "gracias", "¡gracias!", "gracias por ver el video",
            "gracias por ver el video!", "¡gracias por ver el video!",
            "¡suscríbete!", "suscríbete", "¡suscribete!", "suscribete",
            "¡suscríbete al canal!", "suscríbete al canal",
            "like and subscribe", "subscribe", "¡subscribe!",
            "adiós", "chau", "¡adiós!", "bye",
            "¡mierda!", "mierda",
        }
        text_lower = text.lower().strip().rstrip(".!¡¿?")
        if text_lower in GARBAGE_PATTERNS or text.lower().strip() in GARBAGE_PATTERNS:
            logger.debug("Chunk descartado por garbage: %s", text[:60])
            return "", "", avg_logprob, no_speech_prob
        if text_lower in YOUTUBE_HALLUCINATIONS or text.lower().strip() in YOUTUBE_HALLUCINATIONS:
            logger.debug("Chunk descartado por alucinación de YouTube: %s", text[:60])
            return "", "", avg_logprob, no_speech_prob

        # Filtrar texto con caracteres no-latinos (CJK, Korean, etc.)
        latin_chars = sum(1 for c in text if c.isascii() or c in "áéíóúñüÁÉÍÓÚÑÜ¿¡")
        if len(text) > 0 and latin_chars / len(text) < 0.8:
            logger.warning("Chunk descartado por caracteres no-latinos: %s", text[:60])
            return "", "", avg_logprob, no_speech_prob

        logger.info("Whisper: lang=%s logprob=%.2f no_speech=%.2f text=%s", detected_lang, avg_logprob, no_speech_prob, text[:80])
        return text, detected_lang, avg_logprob, no_speech_prob

    @staticmethod
    def _bytes_to_numpy(audio_bytes: bytes) -> np.ndarray:
        """Convierte audio (WAV, webm, mp3, etc.) a numpy array float32 16kHz mono."""
        try:
            # Si ya es WAV (RIFF), parsear directo
            if audio_bytes[:4] == b"RIFF":
                wf = wave.open(io.BytesIO(audio_bytes), "rb")
                frames = wf.readframes(wf.getnframes())
                wf.close()
                audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                return audio

            # Si no es WAV, convertir con ffmpeg a WAV 16kHz mono
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as f_in:
                f_in.write(audio_bytes)
                f_in.flush()
                result = subprocess.run(
                    [
                        "ffmpeg", "-i", f_in.name,
                        "-f", "wav", "-acodec", "pcm_s16le",
                        "-ar", "16000", "-ac", "1",
                        "-hide_banner", "-loglevel", "error",
                        "pipe:1",
                    ],
                    capture_output=True,
                )
                if result.returncode != 0 or not result.stdout:
                    logger.warning("ffmpeg error: %s", result.stderr.decode()[:200])
                    return np.array([], dtype=np.float32)

                wf = wave.open(io.BytesIO(result.stdout), "rb")
                frames = wf.readframes(wf.getnframes())
                wf.close()
                audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                return audio
        except Exception as e:
            logger.warning("Error parseando audio: %s", e)
            return np.array([], dtype=np.float32)
