"""Almacén de subtítulos por sala con soporte de exportación SRT/VTT/TXT."""

import threading
from collections import deque
from typing import Optional

from src.models import SubtitleEntry


class SubtitleStore:
    """Mantiene el historial de subtítulos por sala en memoria."""

    def __init__(self, max_entries: int = 500):
        self._stores: dict[str, deque] = {}
        self._lock = threading.Lock()
        self._max = max_entries
        self._counters: dict[str, int] = {}

    def register_room(self, room_id: str):
        with self._lock:
            if room_id not in self._stores:
                self._stores[room_id] = deque(maxlen=self._max)
                self._counters[room_id] = 0

    def add(self, entry: SubtitleEntry):
        with self._lock:
            if entry.room_id not in self._stores:
                self._stores[entry.room_id] = deque(maxlen=self._max)
                self._counters[entry.room_id] = 0
            self._counters[entry.room_id] += 1
            entry.index = self._counters[entry.room_id]
            self._stores[entry.room_id].append(entry)

    def get_all(self, room_id: str) -> list[SubtitleEntry]:
        with self._lock:
            if room_id not in self._stores:
                return []
            return list(self._stores[room_id])

    def clear(self, room_id: str):
        with self._lock:
            if room_id in self._stores:
                self._stores[room_id].clear()
                self._counters[room_id] = 0

    def count(self, room_id: str) -> int:
        with self._lock:
            return len(self._stores.get(room_id, []))

    # --- Exportación ---

    def export_srt(self, room_id: str) -> str:
        entries = self.get_all(room_id)
        lines = []
        for e in entries:
            lines.append(str(e.index))
            lines.append(f"{_format_srt_time(e.start_time)} --> {_format_srt_time(e.end_time)}")
            lines.append(e.translated if e.translated else e.original)
            lines.append("")
        return "\n".join(lines)

    def export_vtt(self, room_id: str) -> str:
        entries = self.get_all(room_id)
        lines = ["WEBVTT", ""]
        for e in entries:
            lines.append(f"{_format_vtt_time(e.start_time)} --> {_format_vtt_time(e.end_time)}")
            lines.append(e.translated if e.translated else e.original)
            lines.append("")
        return "\n".join(lines)

    def export_txt(self, room_id: str) -> str:
        entries = self.get_all(room_id)
        lines = []
        for e in entries:
            lines.append(f"[{e.original}]")
            if e.translated:
                lines.append(e.translated)
            lines.append("")
        return "\n".join(lines)


def _format_srt_time(ts: float) -> str:
    """Convierte timestamp Unix a formato SRT: HH:MM:SS,mmm"""
    import datetime
    dt = datetime.datetime.fromtimestamp(ts)
    return dt.strftime("%H:%M:%S") + f",{int((ts % 1) * 1000):03d}"


def _format_vtt_time(ts: float) -> str:
    """Convierte timestamp Unix a formato VTT: HH:MM:SS.mmm"""
    import datetime
    dt = datetime.datetime.fromtimestamp(ts)
    return dt.strftime("%H:%M:%S") + f".{int((ts % 1) * 1000):03d}"
