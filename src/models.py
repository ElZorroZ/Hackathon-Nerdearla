"""Data models compartidos."""

from dataclasses import dataclass, field
from typing import Optional
import time


@dataclass
class AudioChunk:
    room_id: str
    audio_bytes: bytes
    sample_rate: int = 16000


@dataclass
class SubtitleEntry:
    """Entrada de subtítulo con timestamps para exportación SRT/VTT."""
    room_id: str
    original: str
    translated: str
    start_time: float = field(default_factory=time.time)
    end_time: float = 0.0
    whisper_latency_ms: float = 0.0
    gemma_latency_ms: float = 0.0
    index: int = 0
    translations: dict = field(default_factory=dict)  # lang -> texto traducido

    def __post_init__(self):
        if self.end_time == 0.0:
            self.end_time = self.start_time + 3.0


@dataclass
class RoomMetrics:
    """Métricas en tiempo real por sala."""
    room_id: str
    status: str = "active"  # active | paused | error
    listeners: int = 0
    total_subtitles: int = 0
    avg_whisper_ms: float = 0.0
    avg_gemma_ms: float = 0.0
    last_whisper_ms: float = 0.0
    last_gemma_ms: float = 0.0
    last_error: str = ""
    audio_quality: str = "good"  # good | warning | critical
    avg_logprob: float = 0.0
    no_speech_prob: float = 0.0

    def update_latency(self, whisper_ms: float, gemma_ms: float):
        self.last_whisper_ms = whisper_ms
        self.last_gemma_ms = gemma_ms
        alpha = 0.3
        self.avg_whisper_ms = (1 - alpha) * self.avg_whisper_ms + alpha * whisper_ms
        self.avg_gemma_ms = (1 - alpha) * self.avg_gemma_ms + alpha * gemma_ms

    def update_audio_quality(self, avg_logprob: float, no_speech_prob: float):
        self.avg_logprob = avg_logprob
        self.no_speech_prob = no_speech_prob
        if no_speech_prob > 0.85:
            self.audio_quality = "critical"
        elif no_speech_prob > 0.6 or avg_logprob < -0.8:
            self.audio_quality = "warning"
        else:
            self.audio_quality = "good"


@dataclass
class KeyMoment:
    """Hitos de la charla con timestamp y título."""
    room_id: str
    timestamp: float = field(default_factory=time.time)
    title: str = ""
    subtitle_index: int = 0
