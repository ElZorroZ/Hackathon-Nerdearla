"""Traductor Gemma via Ollama con soporte de glosario técnico."""

import logging
import os
from typing import Optional

import ollama

from src.config import GEMMA_MODEL, TARGET_LANG, OLLAMA_HOST

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
    ):
        self.model = model
        self.target_lang = target_lang
        # Timeout generoso: la traducción corre en background (no bloquea
        # Whisper) y Ollama encola requests por modelo — con varias salas
        # cada request puede esperar a la anterior.
        timeout = float(os.environ.get("OLLAMA_TIMEOUT", "30.0"))
        self.client = ollama.Client(host=f"http://{host}", timeout=timeout)
        logger.info("GemmaTranslator inicializado: model=%s host=%s", model, host)

    def translate(self, text: str, target_lang: Optional[str] = None) -> str:
        """Traduce texto al idioma objetivo usando Gemma con glosario inyectado."""
        if not text.strip():
            return ""

        lang = target_lang or self.target_lang
        target = self.LANG_NAMES.get(lang, "English")

        # Si el texto ya está en el idioma objetivo, no traducir
        if self._is_already_target_lang(text, lang):
            return text

        prompt = (
            f"You are an expert technical translator for IT conferences "
            f"like Nerdearla. Translate to {target}. "
            f"Keep proper technology names (WebSocket, API, GPU, etc).\n"
            f"Output ONLY the translation.\n"
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
                    # CPU only: no competir con Whisper por la GPU
                    "num_gpu": 0,
                },
            )
            result = response.get("response", "").strip()
            if not result:
                return text
            return result
        except Exception as e:
            logger.warning("Gemma translate falló (usando original): %s", e)
            return text

    def _is_already_target_lang(self, text: str, lang: Optional[str] = None) -> bool:
        """Heurística estricta: si el texto ya está en el idioma objetivo, saltar traducción."""
        if (lang or self.target_lang) == "es":
            spanish_markers = [
                " que ", " de ", " la ", " el ", " los ", " las ", " y ", " en ",
                " un ", " una ", " por ", " con ", " para ", " no ", " sí ",
                " gracias", " hola", " bienvenido", " chicos", " somos ",
                " hoy ", " vamos ", " cuando ", " como ", " porque ",
            ]
            text_lower = f" {text.lower()} "
            matches = sum(1 for m in spanish_markers if m in text_lower)
            words = len(text.split())
            if words >= 3 and matches >= 2 and matches / max(words, 1) > 0.2:
                return True
        return False

    def summarize(self, text: str, lang: str = "es") -> str:
        """Genera un resumen ejecutivo con Gemma 2B."""
        if not text.strip():
            return "Sin contenido para resumir."

        lang_name = self.LANG_NAMES.get(lang, self.LANG_NAMES.get(self.target_lang, "Spanish"))
        prompt = (
            f"Actúa como un asistente técnico de conferencias. "
            f"Genera un resumen ejecutivo breve de la siguiente charla en exactamente "
            f"3 puntos clave (bullet points) y una lista de 5 palabras clave (keywords). "
            f"Responde en {lang_name}.\n\nTexto: {text[:3000]}"
        )

        try:
            response = self.client.generate(
                model=self.model,
                prompt=prompt,
                options={
                    "temperature": 0.3,
                    "num_predict": 256,
                    "stop": ["\n\n\n"],
                    "num_gpu": 0,
                },
            )
            return response.get("response", "").strip()
        except Exception as e:
            logger.error("Error en Gemma summary: %s", e)
            return f"Error generando resumen: {e}"

    def extract_key_moment(self, text: str, lang: str = "es") -> str:
        """Extrae un título corto (3-5 palabras) del tema actual."""
        if not text.strip():
            return ""

        lang_name = self.LANG_NAMES.get(lang, self.LANG_NAMES.get(self.target_lang, "Spanish"))
        prompt = (
            f"Give a very short title (3 to 5 words) summarizing the topic of this text. "
            f"Respond in {lang_name}. Output ONLY the title, nothing else.\n\n"
            f"Text: {text[:500]}"
        )

        try:
            response = self.client.generate(
                model=self.model,
                prompt=prompt,
                options={
                    "temperature": 0.2,
                    "num_predict": 20,
                    "stop": ["\n", "Text:", "Title:"],
                    "num_gpu": 0,
                },
            )
            title = response.get("response", "").strip()
            # Clean up: remove quotes, extra whitespace
            title = title.strip('"\'').strip()
            if len(title) > 60:
                title = title[:57] + "..."
            return title
        except Exception as e:
            logger.error("Error en Gemma key_moment: %s", e)
            return ""
