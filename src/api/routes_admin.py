"""Rutas de administración - métricas del sistema."""

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter

if TYPE_CHECKING:
    from src.services.metrics_collector import MetricsCollector

logger = logging.getLogger("api.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


def init_admin_routes(metrics: "MetricsCollector"):

    @router.get("/metrics")
    async def get_metrics():
        return {
            "rooms": metrics.get_all_metrics(),
            "system": metrics.get_system_metrics(),
        }

    @router.get("/metrics/rooms")
    async def get_room_metrics():
        return {"rooms": metrics.get_all_metrics()}

    @router.get("/metrics/system")
    async def get_system_metrics():
        return metrics.get_system_metrics()
