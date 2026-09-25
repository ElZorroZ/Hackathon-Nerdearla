"""Collector de métricas en tiempo real para el dashboard de admin."""

import threading
import time
from typing import Optional

from src.models import RoomMetrics


class MetricsCollector:
    """Recolecta y expone métricas de rendimiento por sala."""

    def __init__(self):
        self._rooms: dict[str, RoomMetrics] = {}
        self._lock = threading.Lock()
        self._total_errors: int = 0
        self._start_time: float = time.time()

    def register_room(self, room_id: str):
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = RoomMetrics(room_id=room_id)

    def record_subtitle(self, room_id: str, whisper_ms: float, gemma_ms: float, avg_logprob: float = 0.0, no_speech_prob: float = 0.0):
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = RoomMetrics(room_id=room_id)
            m = self._rooms[room_id]
            m.total_subtitles += 1
            m.update_latency(whisper_ms, gemma_ms)
            m.update_audio_quality(avg_logprob, no_speech_prob)
            m.status = "active"

    def record_error(self, room_id: str, error: str):
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = RoomMetrics(room_id=room_id)
            self._rooms[room_id].status = "error"
            self._rooms[room_id].last_error = str(error)
            self._total_errors += 1

    def set_listeners(self, room_id: str, count: int):
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = RoomMetrics(room_id=room_id)
            self._rooms[room_id].listeners = count

    def set_status(self, room_id: str, status: str):
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = RoomMetrics(room_id=room_id)
            self._rooms[room_id].status = status

    def get_room_metrics(self, room_id: str) -> Optional[RoomMetrics]:
        with self._lock:
            return self._rooms.get(room_id)

    def get_all_metrics(self) -> list[dict]:
        with self._lock:
            return [
                {
                    "room_id": m.room_id,
                    "status": m.status,
                    "listeners": m.listeners,
                    "total_subtitles": m.total_subtitles,
                    "avg_whisper_ms": round(m.avg_whisper_ms, 1),
                    "avg_gemma_ms": round(m.avg_gemma_ms, 1),
                    "last_whisper_ms": round(m.last_whisper_ms, 1),
                    "last_gemma_ms": round(m.last_gemma_ms, 1),
                    "last_error": m.last_error,
                    "audio_quality": m.audio_quality,
                    "avg_logprob": round(m.avg_logprob, 3),
                    "no_speech_prob": round(m.no_speech_prob, 3),
                }
                for m in self._rooms.values()
            ]

    def get_system_metrics(self) -> dict:
        uptime = time.time() - self._start_time
        return {
            "uptime_seconds": round(uptime, 1),
            "total_errors": self._total_errors,
            "total_rooms": len(self._rooms),
        }
