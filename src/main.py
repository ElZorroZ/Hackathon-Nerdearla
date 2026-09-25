"""
Backend FastAPI con WebSockets para subtítulos en vivo.

Endpoints:
  GET  /                  - Frontend web
  GET  /api/rooms         - Lista de salas disponibles
  POST /api/audio/{room}  - Subir chunk de audio (WAV 16kHz mono)
  WS   /ws/{room}         - WebSocket para recibir subtítulos en tiempo real

Uso:
  uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Dict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import os

from src.engine import WhisperEngine, GemmaTranslator, RoomManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROOMS = ["sala-1", "sala-2"]
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

# ---------------------------------------------------------------------------
# Globals (initialized on startup)
# ---------------------------------------------------------------------------

manager: RoomManager = None
ws_connections: Dict[str, Set[WebSocket]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager
    logger.info("Inicializando motor Whisper + Gemma...")
    whisper_engine = WhisperEngine()
    translator = GemmaTranslator(target_lang="es")
    manager = RoomManager(whisper_engine, translator)
    for room_id in ROOMS:
        manager.add_room(room_id)
        ws_connections[room_id] = set()
    manager.start()
    logger.info("Motor listo. Salas: %s", ROOMS)

    # Background task: poll results and push to WebSocket clients
    asyncio.create_task(_result_broadcaster())

    yield

    manager.stop()
    logger.info("Motor detenido.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="LiveSubs - Subtítulos en vivo", lifespan=lifespan)


@app.get("/api/rooms")
async def get_rooms():
    return {"rooms": ROOMS}


@app.post("/api/audio/{room_id}")
async def receive_audio(room_id: str, file: UploadFile = File(...)):
    if room_id not in ROOMS:
        return JSONResponse(
            status_code=404,
            content={"error": f"Sala '{room_id}' no existe. Disponibles: {ROOMS}"},
        )
    audio_bytes = await file.read()
    manager.submit_audio(room_id, audio_bytes)
    return {"status": "ok", "room": room_id, "bytes": len(audio_bytes)}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(ws: WebSocket, room_id: str):
    if room_id not in ROOMS:
        await ws.close(code=4004, reason=f"Sala '{room_id}' no existe")
        return

    await ws.accept()
    ws_connections[room_id].add(ws)
    logger.info("Cliente conectado a %s (total: %d)", room_id, len(ws_connections[room_id]))

    try:
        while True:
            await ws.receive_text()  # keep alive; ignoramos mensajes del cliente
    except WebSocketDisconnect:
        pass
    finally:
        ws_connections[room_id].discard(ws)
        logger.info("Cliente desconectado de %s (total: %d)", room_id, len(ws_connections[room_id]))


async def _result_broadcaster():
    """Poll results from RoomManager and push to WebSocket clients."""
    while True:
        for room_id in ROOMS:
            result = manager.get_result(room_id, timeout=0.01)
            if result and room_id in ws_connections:
                payload = json.dumps({
                    "room": result.room_id,
                    "original": result.original,
                    "translated": result.translated,
                    "timestamp": result.timestamp,
                }, ensure_ascii=False)
                dead = set()
                for ws in ws_connections[room_id]:
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        dead.add(ws)
                ws_connections[room_id] -= dead
        await asyncio.sleep(0.05)


# ---------------------------------------------------------------------------
# Frontend (serves from frontend/ directory if exists, else inline HTML)
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend no encontrado. Crear frontend/index.html</h1>")


if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
