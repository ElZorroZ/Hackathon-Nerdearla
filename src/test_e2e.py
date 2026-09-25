"""
Script de prueba end-to-end: envía audio a las salas y recibe subtítulos via WebSocket.

Uso:
    python src/test_e2e.py
"""

import asyncio
import json
import logging
import os
import sys
import time
import wave
import io
import urllib.request
import urllib.error

import numpy as np
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("test_e2e")

SERVER = "http://localhost:8000"
WS_URL = "ws://localhost:8000"
ROOMS = ["sala-1", "sala-2"]
SAMPLES_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "samples")
CHUNK_SECONDS = 3.0
SAMPLE_RATE = 16000


def generate_silence(duration: float = 3.0, sample_rate: int = 16000) -> bytes:
    """Genera WAV de silencio (para probar que el pipeline no crashea)."""
    n = int(sample_rate * duration)
    data = np.zeros(n, dtype=np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(data.tobytes())
    return buf.getvalue()


def load_wav_chunks(wav_path: str, chunk_seconds: float = CHUNK_SECONDS) -> list[bytes]:
    """Lee un WAV y lo divide en chunks de N segundos."""
    chunks = []
    try:
        wf = wave.open(wav_path, "rb")
        sr = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())
        wf.close()

        audio = np.frombuffer(frames, dtype=np.int16)
        if n_channels > 1:
            audio = audio[::n_channels]  # downmix to mono

        chunk_size = int(sr * chunk_seconds)
        total_chunks = len(audio) // chunk_size
        for i in range(total_chunks):
            start = i * chunk_size
            end = start + chunk_size
            chunk_data = audio[start:end]

            buf = io.BytesIO()
            with wave.open(buf, "wb") as wf_out:
                wf_out.setnchannels(1)
                wf_out.setsampwidth(2)
                wf_out.setframerate(SAMPLE_RATE)
                wf_out.writeframes(chunk_data.tobytes())
            chunks.append(buf.getvalue())

        logger.info("Cargado %s: %d chunks de %.1fs (%.1fs total)",
                    os.path.basename(wav_path), len(chunks), chunk_seconds,
                    len(chunks) * chunk_seconds)
    except Exception as e:
        logger.error("Error cargando %s: %s", wav_path, e)
    return chunks


def send_audio(room_id: str, audio_bytes: bytes) -> bool:
    """Envía un chunk de audio al endpoint REST."""
    boundary = "----TestBoundary1234"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n"
    ).encode() + audio_bytes + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{SERVER}/api/audio/{room_id}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except urllib.error.URLError as e:
        logger.error("Error enviando audio a %s: %s", room_id, e)
        return False


async def listen_ws(room_id: str, duration: float = 20.0):
    """Escucha WebSocket de una sala por un tiempo limitado."""
    uri = f"{WS_URL}/ws/{room_id}"
    try:
        async with websockets.connect(uri) as ws:
            logger.info("[%s] WebSocket conectado", room_id)
            start = time.time()
            while time.time() - start < duration:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=duration)
                    data = json.loads(msg)
                    logger.info("[%s] Subtítulo: orig=%s | trad=%s",
                                room_id, data.get("original", "")[:80], data.get("translated", "")[:80])
                except asyncio.TimeoutError:
                    break
            logger.info("[%s] WebSocket cerrado", room_id)
    except Exception as e:
        logger.error("[%s] Error WS: %s", room_id, e)


async def stream_chunks(room_id: str, chunks: list[bytes], delay: float = 3.0):
    """Envía chunks de audio secuencialmente simulando streaming en vivo."""
    for i, chunk in enumerate(chunks):
        ok = send_audio(room_id, chunk)
        logger.info("[%s] Chunk %d/%d: %s", room_id, i + 1, len(chunks), "OK" if ok else "FAIL")
        await asyncio.sleep(delay)


async def run_test():
    logger.info("=== TEST E2E ===")

    # Verificar servidor
    try:
        resp = urllib.request.urlopen(f"{SERVER}/api/rooms", timeout=5)
        data = json.loads(resp.read())
        logger.info("Servidor responde. Salas: %s", data.get("rooms"))
    except Exception as e:
        logger.error("No se pudo conectar al servidor. ¿Está corriendo? %s", e)
        return

    # Cargar audios de prueba
    samples = {}
    for room in ROOMS:
        found = False
        for fname in os.listdir(SAMPLES_DIR) if os.path.isdir(SAMPLES_DIR) else []:
            if fname.endswith(".wav"):
                samples[room] = load_wav_chunks(os.path.join(SAMPLES_DIR, fname), CHUNK_SECONDS)
                found = True
                break
        if not found:
            logger.warning("[%s] No se encontró WAV en %s, usando silencio", room, SAMPLES_DIR)
            samples[room] = [generate_silence(CHUNK_SECONDS)]

    # Lanzar listeners WebSocket en paralelo
    total_duration = max(len(s) for s in samples.values()) * 3.0 + 15
    listeners = [asyncio.create_task(listen_ws(room, duration=total_duration)) for room in ROOMS]

    await asyncio.sleep(1)  # esperar que WS conecten

    # Streaming de audio en paralelo (una tarea por sala)
    streamers = []
    for room in ROOMS:
        streamers.append(asyncio.create_task(stream_chunks(room, samples[room], delay=3.0)))

    await asyncio.gather(*streamers)
    logger.info("Streaming completado. Esperando subtítulos...")

    # Esperar a que terminen los listeners
    await asyncio.gather(*listeners)
    logger.info("=== TEST E2E COMPLETADO ===")


if __name__ == "__main__":
    asyncio.run(run_test())
