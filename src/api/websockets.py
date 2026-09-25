"""WebSocket handlers para subtítulos en vivo y dashboard de admin."""

import asyncio
import json
import logging
import time
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("api.ws")

router = APIRouter()


class WSConnectionManager:
    """Gestiona conexiones WebSocket por sala y admin."""

    def __init__(self):
        self.room_connections: Dict[str, Set[WebSocket]] = {}
        self.admin_connections: Set[WebSocket] = set()

    def register_room(self, room_id: str):
        if room_id not in self.room_connections:
            self.room_connections[room_id] = set()

    def listener_count(self, room_id: str) -> int:
        return len(self.room_connections.get(room_id, set()))

    async def broadcast_to_room(self, room_id: str, message: dict):
        if room_id not in self.room_connections:
            return
        payload = json.dumps(message, ensure_ascii=False)
        dead = set()
        for ws in self.room_connections[room_id]:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        self.room_connections[room_id] -= dead

    async def broadcast_to_admins(self, message: dict):
        if not self.admin_connections:
            return
        payload = json.dumps(message, ensure_ascii=False)
        dead = set()
        for ws in self.admin_connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        self.admin_connections -= dead


def init_ws_routes(ws_manager: WSConnectionManager, rooms: list[str], on_room_lang=None):
    """Registra los endpoints WebSocket.

    on_room_lang: callable(room_id, lang) que se invoca cuando un cliente
    elige un idioma destino (para que RoomManager traduzca a ese idioma).
    """

    # IMPORTANT: /ws/admin must be registered BEFORE /ws/{room_id}
    # otherwise FastAPI matches "admin" as a room_id and rejects with 403.

    @router.websocket("/ws/admin")
    async def admin_ws(ws: WebSocket):
        offered = ws.headers.get("sec-websocket-protocol", "")
        subproto = "ngrok-skip-browser-warning" if "ngrok-skip-browser-warning" in offered else None
        await ws.accept(subprotocol=subproto)
        ws_manager.admin_connections.add(ws)

        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            ws_manager.admin_connections.discard(ws)
            logger.info("Admin desconectado (total: %d)", len(ws_manager.admin_connections))

    @router.websocket("/ws/{room_id}")
    async def room_ws(ws: WebSocket, room_id: str):
        if room_id not in rooms:
            await ws.close(code=4004, reason=f"Sala '{room_id}' no existe")
            return

        # Aceptar con o sin subprotocolo
        offered = ws.headers.get("sec-websocket-protocol", "")
        subproto = "ngrok-skip-browser-warning" if "ngrok-skip-browser-warning" in offered else None
        await ws.accept(subprotocol=subproto)
        ws_manager.register_room(room_id)
        ws_manager.room_connections[room_id].add(ws)
        logger.info("Cliente conectado a %s (total: %d)", room_id, ws_manager.listener_count(room_id))

        try:
            while True:
                raw = await ws.receive_text()
                # Parse incoming client messages (reactions, etc.)
                try:
                    msg = json.loads(raw)
                    if msg.get("type") == "reaction":
                        # Broadcast reaction to all clients in this room
                        reaction_msg = {
                            "type": "reaction",
                            "emoji": msg.get("emoji", ""),
                            "room": room_id,
                            "timestamp": time.time(),
                        }
                        await ws_manager.broadcast_to_room(room_id, reaction_msg)
                    elif msg.get("type") == "lang" and on_room_lang:
                        # Cliente pide un idioma destino para esta sala
                        lang = msg.get("lang")
                        if lang:
                            on_room_lang(room_id, lang)
                except (json.JSONDecodeError, KeyError):
                    pass  # Ignore non-JSON or malformed messages
        except WebSocketDisconnect:
            pass
        finally:
            ws_manager.room_connections[room_id].discard(ws)
            logger.info("Cliente desconectado de %s (total: %d)", room_id, ws_manager.listener_count(room_id))
