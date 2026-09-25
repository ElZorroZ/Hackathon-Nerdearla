"""
Streaming de micrófono en vivo al backend de LiveSubs.

Uso:
    python src/stream_mic.py
    python src/stream_mic.py --room sala-1
"""

import argparse
import io
import logging
import queue
import sys
import time
import urllib.request
import wave

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("stream_mic")

try:
    import sounddevice as sd
except ImportError:
    logger.error("sounddevice no instalado. Ejecutar: pip install sounddevice")
    sys.exit(1)

from src.config import CHUNK_DURATION, SAMPLE_RATE, DEFAULT_ROOMS

SERVER = "http://localhost:8000"


def send_audio(room_id: str, audio_bytes: bytes) -> bool:
    boundary = "----MicBoundary"
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
    except Exception as e:
        logger.error("Error enviando audio: %s", e)
        return False


def main():
    parser = argparse.ArgumentParser(description="Stream micrófono a LiveSubs")
    parser.add_argument("--room", default=DEFAULT_ROOMS[0], help="Sala destino")
    parser.add_argument("--device", type=int, default=None, help="Device ID de micrófono")
    args = parser.parse_args()

    logger.info("Conectando a sala: %s", args.room)
    logger.info("Sample rate: %d, Chunk: %.1fs", SAMPLE_RATE, CHUNK_DURATION)

    q: queue.Queue = queue.Queue()
    chunk_samples = int(SAMPLE_RATE * CHUNK_DURATION)
    buffer = np.zeros(0, dtype=np.float32)

    def on_audio(indata, frames, time_info, status):
        if status:
            logger.warning("Audio status: %s", status)
        q.put(indata.copy())

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
        blocksize=1024,
        device=args.device,
        callback=on_audio,
    ):
        logger.info("Micrófono abierto. Presioná Ctrl+C para detener.")
        try:
            while True:
                data = q.get()
                buffer = np.concatenate([buffer, data.flatten()])

                while len(buffer) >= chunk_samples:
                    chunk = buffer[:chunk_samples]
                    buffer = buffer[chunk_samples:]

                    audio_int16 = (chunk * 32767).astype(np.int16)
                    buf = io.BytesIO()
                    with wave.open(buf, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(SAMPLE_RATE)
                        wf.writeframes(audio_int16.tobytes())

                    ok = send_audio(args.room, buf.getvalue())
                    if ok:
                        logger.info("Chunk enviado a %s (%.1fs)", args.room, CHUNK_DURATION)

        except KeyboardInterrupt:
            logger.info("Detenido.")


if __name__ == "__main__":
    main()
