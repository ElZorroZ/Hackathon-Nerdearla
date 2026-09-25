"""Rutas de salas - listado, audio, control."""

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from src.engine.room_manager import RoomManager

logger = logging.getLogger("api.rooms")

router = APIRouter(prefix="/api", tags=["rooms"])


def init_room_routes(manager: "RoomManager", rooms: list[str]):
    """Inyecta dependencias en el router."""

    @router.get("/rooms")
    async def get_rooms():
        return {"rooms": rooms}

    @router.post("/audio/{room_id}")
    async def receive_audio(room_id: str, file: UploadFile = File(...)):
        if room_id not in rooms:
            raise HTTPException(
                status_code=404,
                detail=f"Sala '{room_id}' no existe. Disponibles: {rooms}",
            )
        audio_bytes = await file.read()
        manager.submit_audio(room_id, audio_bytes)
        return {"status": "ok", "room": room_id, "bytes": len(audio_bytes)}

    @router.post("/rooms/{room_id}/pause")
    async def pause_room(room_id: str):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        ok = manager.pause_room(room_id)
        return {"status": "paused" if ok else "already_paused", "room": room_id}

    @router.post("/rooms/{room_id}/resume")
    async def resume_room(room_id: str):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        ok = manager.resume_room(room_id)
        return {"status": "resumed" if ok else "already_active", "room": room_id}

    @router.post("/rooms/{room_id}/clear")
    async def clear_room(room_id: str):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        ok = manager.clear_room(room_id)
        return {"status": "cleared" if ok else "not_found", "room": room_id}
