"""
Stream de audio de test a una sala del backend Zorvex Live.

Envía un archivo WAV completo en chunks solapados (simulando streaming en vivo)
al endpoint /api/audio/{room_id}.

Uso:
    python -m src.stream_sample --room sala-1 --wav assets/samples/sala1_sample.wav
    python -m src.stream_sample --room sala-2 --wav assets/samples/sala2_sample.wav --lang en
"""

import argparse
import io
import logging
import os
import subprocess
import time
import wave

import numpy as np
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("stream_sample")

SERVER = os.environ.get("ZORVEX_SERVER", "http://localhost:8000")
SAMPLE_RATE = 16000
CHUNK_SECONDS = 3.0
CHUNK_OVERLAP = 0.5  # solapamiento para no cortar palabras


def load_wav_chunks(wav_path: str, chunk_seconds: float = CHUNK_SECONDS,
                    overlap: float = CHUNK_OVERLAP) -> list[bytes]:
    """Lee un WAV (cualquier formato), lo convierte a 16kHz mono con ffmpeg, y lo divide en chunks."""
    # Convertir a 16kHz mono PCM s16le con ffmpeg (maneja cualquier formato de entrada)
    result = subprocess.run(
        [
            "ffmpeg", "-i", wav_path,
            "-f", "wav", "-acodec", "pcm_s16le",
            "-ar", str(SAMPLE_RATE), "-ac", "1",
            "-hide_banner", "-loglevel", "error",
            "pipe:1",
        ],
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        logger.error("ffmpeg error: %s", result.stderr.decode()[:300])
        return []

    wf = wave.open(io.BytesIO(result.stdout), "rb")
    sr = wf.getframerate()
    n_channels = wf.getnchannels()
    frames = wf.readframes(wf.getnframes())
    wf.close()

    audio = np.frombuffer(frames, dtype=np.int16)
    logger.info("Audio convertido: sr=%d channels=%d samples=%d (%.1fs)",
                sr, n_channels, len(audio), len(audio) / sr)

    chunk_size = int(SAMPLE_RATE * chunk_seconds)
    step = int(SAMPLE_RATE * (chunk_seconds - overlap))
    total_chunks = max(1, (len(audio) - chunk_size) // step + 1)

    chunks = []
    for i in range(total_chunks):
        start = i * step
        end = start + chunk_size
        if end > len(audio):
            end = len(audio)
        chunk_data = audio[start:end]
        if len(chunk_data) < SAMPLE_RATE * 0.5:
            break
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf_out:
            wf_out.setnchannels(1)
            wf_out.setsampwidth(2)
            wf_out.setframerate(SAMPLE_RATE)
            wf_out.writeframes(chunk_data.tobytes())
        chunks.append(buf.getvalue())

    total_sec = len(audio) / SAMPLE_RATE
    logger.info("Cargado %s: %d chunks de %.1fs (overlap=%.1fs, total=%.1fs)",
                os.path.basename(wav_path), len(chunks), chunk_seconds, overlap, total_sec)
    return chunks


def send_audio(room_id: str, audio_bytes: bytes) -> bool:
    """Envía un chunk de audio al endpoint REST."""
    url = f"{SERVER}/api/audio/{room_id}"
    files = {"file": ("audio.wav", audio_bytes, "audio/wav")}
    try:
        resp = requests.post(url, files=files, timeout=15)
        return resp.status_code == 200
    except requests.RequestException as e:
        logger.error("Error enviando audio a %s: %s", room_id, e)
        return False


def stream_to_room(room_id: str, wav_path: str, delay: float = 2.5):
    """Envía todos los chunks de un WAV a una sala simulando streaming en vivo."""
    chunks = load_wav_chunks(wav_path)
    logger.info("[%s] Iniciando stream de %d chunks (delay=%.1fs entre chunks)",
                room_id, len(chunks), delay)

    ok = 0
    fail = 0
    for i, chunk in enumerate(chunks, 1):
        if send_audio(room_id, chunk):
            ok += 1
            logger.info("[%s] Chunk %d/%d OK", room_id, i, len(chunks))
        else:
            fail += 1
            logger.warning("[%s] Chunk %d/%d FAIL", room_id, i, len(chunks))
        time.sleep(delay)

    logger.info("[%s] Stream completo: %d OK, %d FAIL", room_id, ok, fail)


def main():
    parser = argparse.ArgumentParser(description="Stream de audio de test a una sala")
    parser.add_argument("--room", required=True, help="ID de la sala (ej: sala-1)")
    parser.add_argument("--wav", required=True, help="Ruta al archivo WAV")
    parser.add_argument("--lang", default=None,
                        help="Setear idioma fuente de la sala antes de streamear (ej: es, en)")
    parser.add_argument("--delay", type=float, default=2.5,
                        help="Segundos entre chunks (default: 2.5)")
    args = parser.parse_args()

    if not os.path.exists(args.wav):
        logger.error("Archivo no encontrado: %s", args.wav)
        return

    # Verificar servidor
    try:
        resp = requests.get(f"{SERVER}/api/rooms", timeout=5)
        rooms = resp.json().get("rooms", [])
        room_ids = [r.get("id") for r in rooms]
        if args.room not in room_ids:
            logger.warning("Sala '%s' no existe. Disponibles: %s", args.room, room_ids)
            logger.warning("Creá la sala desde el panel de admin o usá una existente.")
            return
    except requests.RequestException as e:
        logger.error("No se pudo conectar al servidor %s: %s", SERVER, e)
        return

    # Setear idioma de la sala si se especifico
    if args.lang:
        try:
            resp = requests.put(
                f"{SERVER}/api/rooms/{args.room}/language",
                params={"lang": args.lang},
                timeout=5,
            )
            if resp.status_code == 200:
                logger.info("[%s] Idioma seteado a: %s", args.room, args.lang)
            else:
                logger.warning("[%s] No se pudo setear idioma: %s", args.room, resp.status_code)
        except requests.RequestException as e:
            logger.warning("[%s] Error seteando idioma: %s", args.room, e)

    stream_to_room(args.room, args.wav, delay=args.delay)


if __name__ == "__main__":
    main()
