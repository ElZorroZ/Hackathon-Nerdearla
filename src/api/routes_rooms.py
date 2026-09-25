"""Rutas de salas - listado, creación, audio, control."""

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

if TYPE_CHECKING:
    from src.engine.room_manager import RoomManager
    from src.api.websockets import WSConnectionManager
    from src.services.metrics_collector import MetricsCollector

from src.config import CHUNK_DURATION

logger = logging.getLogger("api.rooms")

router = APIRouter(prefix="/api", tags=["rooms"])


class CreateRoomRequest(BaseModel):
    name: str
    lang: str = "ES"


def init_room_routes(
    manager: "RoomManager",
    rooms: list[str],
    ws_manager: "WSConnectionManager",
    metrics: "MetricsCollector",
):
    """Inyecta dependencias en el router."""

    # Mapeo de nombres legibles
    room_names: dict[str, str] = {}
    room_langs: dict[str, str] = {}

    @router.get("/rooms")
    async def get_rooms():
        result = []
        for r in rooms:
            result.append({
                "id": r,
                "name": room_names.get(r, r),
                "lang": room_langs.get(r, ""),
            })
        return {"rooms": result}

    @router.post("/rooms")
    async def create_room(req: CreateRoomRequest):
        # Generar room_id a partir del nombre (slug)
        import re
        slug = re.sub(r'[^a-zA-Z0-9]+', '-', req.name.lower()).strip('-')
        if not slug:
            slug = "sala"
        # Evitar duplicados
        base = slug
        n = 2
        while slug in rooms:
            slug = f"{base}-{n}"
            n += 1

        rooms.append(slug)
        room_names[slug] = req.name
        room_langs[slug] = req.lang
        manager.add_room(slug, lang=req.lang.lower())
        ws_manager.register_room(slug)
        metrics.register_room(slug)
        logger.info("Sala creada: %s (%s, lang=%s)", slug, req.name, req.lang)
        return {"status": "created", "room": slug, "name": req.name, "lang": req.lang}

    @router.delete("/rooms/{room_id}")
    async def delete_room(room_id: str):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        rooms.remove(room_id)
        room_names.pop(room_id, None)
        room_langs.pop(room_id, None)
        logger.info("Sala eliminada: %s", room_id)
        return {"status": "deleted", "room": room_id}

    @router.put("/rooms/{room_id}/language")
    async def set_room_language(room_id: str, lang: str = "es"):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        room_langs[room_id] = lang.upper()
        manager.set_room_lang(room_id, lang.lower())
        logger.info("Sala %s: idioma actualizado a %s", room_id, lang)
        return {"status": "ok", "room": room_id, "lang": lang}

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

    @router.get("/rooms/{room_id}/language")
    async def get_room_language(room_id: str):
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        lang = manager.get_room_lang(room_id)
        return {"room": room_id, "lang": lang}

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

    @router.post("/rooms/{room_id}/flush")
    async def flush_room(room_id: str):
        """Zero-Lag: vacía la cola de audio pendiente de una sala."""
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        ok = manager.clear_room(room_id)
        return {"status": "flushed" if ok else "not_found", "room": room_id}

    @router.get("/rooms/{room_id}/latency")
    async def get_latency(room_id: str):
        """Retorna la latencia estimada de la cola de audio."""
        if room_id not in rooms:
            raise HTTPException(status_code=404, detail="Sala no existe")
        pending = manager.audio_queues.get(room_id)
        queue_size = pending.qsize() if pending else 0
        est_latency = queue_size * CHUNK_DURATION
        mode = "ultra-low" if est_latency < 1.0 else "low" if est_latency < 3.0 else "lagged"
        return {
            "room": room_id,
            "queue_size": queue_size,
            "estimated_latency_s": round(est_latency, 2),
            "mode": mode,
        }
