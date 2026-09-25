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
        glossary_ctx = ""
        if self.glossary:
            glossary_str = self.glossary.build_prompt_context()
            if glossary_str:
                glossary_ctx = (
                    f"\n\nYou are an expert technical translator for IT conferences "
                    f"like Nerdearla. Translate to {target} keeping proper technology "
                    f"names and strictly applying this glossary of terms:\n"
                    f"{glossary_str}\n"
                )

        prompt = (
            f"{glossary_ctx}"
            f"Translate the following text to {target}. "
            f"Output ONLY the translation, no explanations.\n\n"
            f"Text: {text}\n"
            f"Translation:"
        )

        try:
            response = self.client.generate(
                model=self.model,
                prompt=prompt,
                options={
                    "temperature": 0.3,
                    "num_predict": 128,
                    "stop": ["\n\n"],
                },
            )
            return response.get("response", "").strip()
        except Exception as e:
            logger.error("Error en Gemma: %s", e)
            return text
