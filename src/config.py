"""Configuración central del proyecto."""

import os
import subprocess


# Whisper
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")

# Gemma / Ollama
GEMMA_MODEL = os.environ.get("GEMMA_MODEL", "gemma2:2b")
TARGET_LANG = os.environ.get("TARGET_LANG", "es")

# Audio
CHUNK_DURATION = float(os.environ.get("CHUNK_DURATION", "3.0"))
SAMPLE_RATE = int(os.environ.get("SAMPLE_RATE", "16000"))
CHUNK_OVERLAP = float(os.environ.get("CHUNK_OVERLAP", "0.5"))  # solapamiento entre chunks en segundos

# Salas
DEFAULT_ROOMS = ["sala-1", "sala-2"]

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
GLOSSARY_PATH = os.path.join(ASSETS_DIR, "glossary.json")


def detect_ollama_host() -> str:
    """Detecta el host de Ollama. Si estamos en WSL, usa la IP del host Windows."""
    env_host = os.environ.get("OLLAMA_HOST")
    if env_host:
        return env_host
    try:
        with open("/proc/version", "r") as f:
            if "microsoft" in f.read().lower():
                result = subprocess.run(
                    ["ip", "route", "show", "default"],
                    capture_output=True, text=True, timeout=3,
                )
                for line in result.stdout.splitlines():
                    if "default via" in line:
                        return line.split()[2] + ":11434"
    except Exception:
        pass
    return "127.0.0.1:11434"


OLLAMA_HOST = detect_ollama_host()
