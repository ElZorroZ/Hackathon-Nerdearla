"""Gestor de glosario técnico configurable en tiempo real."""

import json
import os
import threading
import logging

from src.config import GLOSSARY_PATH

logger = logging.getLogger("glossary")


class GlossaryManager:
    """Gestiona un glosario de términos técnicos para traducción."""

    def __init__(self, path: str = GLOSSARY_PATH):
        self._path = path
        self._terms: dict[str, str] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if os.path.exists(self._path):
            try:
                with open(self._path, "r", encoding="utf-8") as f:
                    self._terms = json.load(f)
                logger.info("Glosario cargado: %d términos", len(self._terms))
            except Exception as e:
                logger.warning("Error cargando glosario: %s", e)
                self._terms = {}
        else:
            self._terms = self._default_glossary()
            self._save()

    def _save(self):
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self._terms, f, ensure_ascii=False, indent=2)

    def _default_glossary(self) -> dict[str, str]:
        return {
            "WebSocket": "WebSocket",
            "API": "API",
            "GPU": "GPU",
            "CPU": "CPU",
            "VRAM": "VRAM",
            "machine learning": "aprendizaje automático",
            "deep learning": "aprendizaje profundo",
            "deploy": "desplegar",
            "framework": "framework",
            "open source": "código abierto",
            "backend": "backend",
            "frontend": "frontend",
            "streaming": "streaming",
            "latency": "latencia",
            "throughput": "rendimiento",
        }

    def get_all(self) -> dict[str, str]:
        with self._lock:
            return dict(self._terms)

    def add_term(self, original: str, translation: str) -> bool:
        with self._lock:
            self._terms[original] = translation
            self._save()
            logger.info("Término agregado: %s -> %s", original, translation)
            return True

    def update_term(self, original: str, translation: str) -> bool:
        with self._lock:
            if original not in self._terms:
                return False
            self._terms[original] = translation
            self._save()
            return True

    def delete_term(self, original: str) -> bool:
        with self._lock:
            if original not in self._terms:
                return False
            del self._terms[original]
            self._save()
            return True

    def build_prompt_context(self) -> str:
        """Construye el texto del glosario para inyectar en el prompt de Gemma."""
        with self._lock:
            if not self._terms:
                return ""
            terms_str = ", ".join(f'"{k}" = "{v}"' for k, v in self._terms.items())
            return terms_str
