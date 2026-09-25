"""
Backend FastAPI - LiveSubs

Rutas:
  GET  /                              - Frontend (cliente)
  GET  /admin                          - Frontend (admin dashboard)
  GET  /api/rooms                      - Lista de salas
  POST /api/audio/{room_id}            - Subir chunk de audio
  POST /api/rooms/{room_id}/pause      - Pausar sala
  POST /api/rooms/{room_id}/resume     - Reanudar sala
  POST /api/rooms/{room_id}/clear      - Limpiar buffer
  GET  /api/rooms/{room_id}/export     - Exportar SRT/VTT/TXT
  GET  /api/rooms/{room_id}/subtitles  - Historial de subtítulos
  GET  /api/admin/glossary             - Obtener glosario
  POST /api/admin/glossary             - Agregar término
  PUT  /api/admin/glossary             - Actualizar término
  DELETE /api/admin/glossary           - Eliminar término
  GET  /api/admin/metrics              - Métricas del sistema
  WS   /ws/{room_id}                   - Subtítulos en vivo
  WS   /ws/admin                       - Dashboard de admin en vivo

Uso:
  uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from src.config import DEFAULT_ROOMS, FRONTEND_DIR
from src.engine.whisper_engine import WhisperEngine
from src.engine.translator import GemmaTranslator
from src.engine.room_manager import RoomManager
from src.services.subtitle_store import SubtitleStore
from src.services.glossary_manager import GlossaryManager
from src.services.metrics_collector import MetricsCollector
from src.api.routes_rooms import router as rooms_router, init_room_routes
from src.api.routes_export import router as export_router, init_export_routes
from src.api.routes_glossary import router as glossary_router, init_glossary_routes
from src.api.routes_admin import router as admin_router, init_admin_routes
from src.api.websockets import router as ws_router, WSConnectionManager, init_ws_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")

# Globals
manager: RoomManager = None
ws_manager: WSConnectionManager = None
metrics: MetricsCollector = None
subtitle_store: SubtitleStore = None
glossary: GlossaryManager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager, ws_manager, metrics, subtitle_store, glossary

    logger.info("Inicializando motor Whisper + Gemma...")

    subtitle_store = SubtitleStore(max_entries=500)
    metrics = MetricsCollector()
    glossary = GlossaryManager()

    whisper_engine = WhisperEngine()
    translator = GemmaTranslator(glossary=glossary)
    manager = RoomManager(whisper_engine, translator, subtitle_store, metrics)

    ws_manager = WSConnectionManager()

    for room_id in DEFAULT_ROOMS:
        manager.add_room(room_id, lang="es")
        ws_manager.register_room(room_id)
        metrics.register_room(room_id)

    manager.start()
    logger.info("Motor listo. Salas: %s", DEFAULT_ROOMS)

    # Inicializar routers con dependencias (después de que los globals estén listos)
    init_room_routes(manager, DEFAULT_ROOMS, ws_manager, metrics)
    init_export_routes(subtitle_store, DEFAULT_ROOMS)
    init_glossary_routes(glossary)
    init_admin_routes(metrics)
    init_ws_routes(ws_manager, DEFAULT_ROOMS)

    app.include_router(rooms_router)
    app.include_router(export_router)
    app.include_router(glossary_router)
    app.include_router(admin_router)
    app.include_router(ws_router)

    # Background tasks
    asyncio.create_task(_result_broadcaster())
    asyncio.create_task(_admin_broadcaster())

    yield

    manager.stop()
    logger.info("Motor detenido.")


app = FastAPI(title="LiveSubs - Subtítulos en vivo", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Broadcasters
# ---------------------------------------------------------------------------

async def _result_broadcaster():
    """Poll results from RoomManager and push to WebSocket clients."""
    while True:
        for room_id in DEFAULT_ROOMS:
            result = manager.get_result(room_id, timeout=0.01)
            if result:
                payload = {
                    "room": result.room_id,
                    "original": result.original,
                    "translated": result.translated,
                    "timestamp": result.start_time,
                    "index": result.index,
                    "whisper_ms": round(result.whisper_latency_ms, 1),
                    "gemma_ms": round(result.gemma_latency_ms, 1),
                }
                await ws_manager.broadcast_to_room(room_id, payload)
        await asyncio.sleep(0.05)


async def _admin_broadcaster():
    """Push métricas a admins via WebSocket cada 2s."""
    while True:
        await asyncio.sleep(2.0)
        for room_id in DEFAULT_ROOMS:
            metrics.set_listeners(room_id, ws_manager.listener_count(room_id))
        payload = {
            "type": "metrics",
            "rooms": metrics.get_all_metrics(),
            "system": metrics.get_system_metrics(),
        }
        await ws_manager.broadcast_to_admins(payload)


# ---------------------------------------------------------------------------
# Frontend (sirve build de Vite desde frontend/dist)
# ---------------------------------------------------------------------------

DIST_DIR = os.path.join(FRONTEND_DIR, "dist")


@app.get("/admin", response_class=HTMLResponse)
async def serve_admin():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend no compilado. Ejecutar: cd frontend && npm install && npm run build</h1>")


@app.get("/overlay", response_class=HTMLResponse)
async def serve_overlay():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend no compilado. Ejecutar: cd frontend && npm install && npm run build</h1>")


@app.get("/stage", response_class=HTMLResponse)
async def serve_stage():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend no compilado. Ejecutar: cd frontend && npm install && npm run build</h1>")


@app.get("/mobile", response_class=HTMLResponse)
async def serve_mobile():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend no compilado. Ejecutar: cd frontend && npm install && npm run build</h1>")


@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend no compilado. Ejecutar: cd frontend && npm install && npm run build</h1>")


if os.path.isdir(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")
