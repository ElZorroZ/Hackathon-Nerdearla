"""Traductor Gemma via Ollama con soporte de glosario técnico."""

import logging
from typing import Optional

import ollama

from src.config import GEMMA_MODEL, TARGET_LANG, OLLAMA_HOST
from src.services.glossary_manager import GlossaryManager

logger = logging.getLogger("translator")


class GemmaTranslator:
    """Traducción usando Gemma a través de Ollama."""

    LANG_NAMES = {
        "es": "Spanish",
        "en": "English",
        "pt": "Portuguese",
        "fr": "French",
    }

    def __init__(
        self,
        model: str = GEMMA_MODEL,
        target_lang: str = TARGET_LANG,
        host: str = OLLAMA_HOST,
        glossary: Optional[GlossaryManager] = None,
    ):
        self.model = model
        self.target_lang = target_lang
        self.client = ollama.Client(host=f"http://{host}")
        self.glossary = glossary
        logger.info("GemmaTranslator inicializado: model=%s host=%s", model, host)

    def translate(self, text: str) -> str:
        """Traduce texto al idioma objetivo usando Gemma con glosario inyectado."""
        if not text.strip():
            return ""

        target = self.LANG_NAMES.get(self.target_lang, "English")

        # Si el texto ya está en el idioma objetivo, no traducir
        if self._is_already_target_lang(text):
            return text

        glossary_ctx = ""
        if self.glossary:
            glossary_str = self.glossary.build_prompt_context()
            if glossary_str:
                glossary_ctx = (
                    f"You are an expert technical translator for IT conferences "
                    f"like Nerdearla. Translate to {target}. "
                    f"Keep proper technology names (WebSocket, API, GPU, etc). "
                    f"Strictly apply this glossary:\n{glossary_str}\n\n"
                )

        prompt = (
            f"{glossary_ctx}"
            f"Translate to {target}. Output ONLY the translation.\n"
            f"Text: {text}\n"
            f"Translation:"
        )

        try:
            response = self.client.generate(
                model=self.model,
                prompt=prompt,
                options={
                    "temperature": 0.2,
                    "num_predict": 64,
                    "stop": ["\n\n", "Text:", "Translation:"],
                },
            )
            return response.get("response", "").strip()
        except Exception as e:
            logger.error("Error en Gemma: %s", e)
            return text

    def _is_already_target_lang(self, text: str) -> bool:
        """Heurística simple: si el texto ya está en el idioma objetivo, saltar traducción."""
        if self.target_lang == "es":
            spanish_markers = [
                " que ", " de ", " la ", " el ", " los ", " las ", " y ", " en ",
                " un ", " una ", " por ", " con ", " para ", " no ", " sí ",
                " gracias", " hola", " bienvenido", " chicos",
            ]
            text_lower = f" {text.lower()} "
            matches = sum(1 for m in spanish_markers if m in text_lower)
            words = len(text.split())
            if words > 0 and matches / max(words, 1) > 0.15:
                return True
        return False
