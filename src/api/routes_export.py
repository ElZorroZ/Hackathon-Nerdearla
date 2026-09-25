"""Rutas de exportación SRT/VTT/TXT."""

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

if TYPE_CHECKING:
    from src.services.subtitle_store import SubtitleStore

logger = logging.getLogger("api.export")

router = APIRouter(prefix="/api/rooms", tags=["export"])


def init_export_routes(store: "SubtitleStore", rooms: list[str]):

    @router.get("/{room_id}/export")
    async def export_subtitles(room_id: str, format: str = "txt"):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")

        format = format.lower().strip()
        if format == "srt":
            content = store.export_srt(room_id)
            return PlainTextResponse(
                content,
                media_type="text/plain",
                headers={"Content-Disposition": f"attachment; filename={room_id}.srt"},
            )
        elif format == "vtt":
            content = store.export_vtt(room_id)
            return PlainTextResponse(
                content,
                media_type="text/vtt",
                headers={"Content-Disposition": f"attachment; filename={room_id}.vtt"},
            )
        elif format == "txt":
            content = store.export_txt(room_id)
            return PlainTextResponse(
                content,
                media_type="text/plain",
                headers={"Content-Disposition": f"attachment; filename={room_id}.txt"},
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Formato no soportado. Usar: srt, vtt, txt",
            )

    @router.get("/{room_id}/subtitles")
    async def get_subtitles(room_id: str):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        entries = store.get_all(room_id)
        return {
            "room": room_id,
            "count": len(entries),
            "subtitles": [
                {
                    "index": e.index,
                    "original": e.original,
                    "translated": e.translated,
                    "start_time": e.start_time,
                    "end_time": e.end_time,
                }
                for e in entries
            ],
        }
