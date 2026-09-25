"""
Descarga audios de prueba desde YouTube en formato WAV 16kHz mono.
Los guarda en assets/samples/ listos para enviar al pipeline.

Uso:
    python src/download_samples.py
    python src/download_samples.py --url "https://youtube.com/watch?v=XXXX" --name charla
"""

import argparse
import os
import subprocess
import sys


SAMPLES = [
    {
        "name": "ted_tech_en",
        "url": "https://www.youtube.com/watch?v=Y2VF8tmLFHw",
        "desc": "TED Talk en inglés (tech)",
    },
    {
        "name": "tech_conf_es",
        "url": "https://www.youtube.com/watch?v=soY1Qy1V4r8",
        "desc": "Conferencia tech en español",
    },
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "samples")


def download_wav(url: str, output_path: str) -> bool:
    """Descarga audio de YouTube como WAV 16kHz mono usando yt-dlp."""
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-x",                          # extraer audio
        "--audio-format", "wav",       # formato WAV
        "--audio-quality", "0",        # mejor calidad
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",  # forzar 16kHz mono
        "-o", output_path,
        "--no-playlist",
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0:
            return True
        else:
            print(f"Error: {result.stderr[:500]}")
            return False
    except subprocess.TimeoutExpired:
        print("Timeout descargando")
        return False


def main():
    parser = argparse.ArgumentParser(description="Descargar audios de prueba desde YouTube")
    parser.add_argument("--url", help="URL de YouTube específica")
    parser.add_argument("--name", help="Nombre del archivo de salida (sin extensión)")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if args.url and args.name:
        samples = [{"name": args.name, "url": args.url, "desc": "Personalizado"}]
    else:
        samples = SAMPLES

    for s in samples:
        out = os.path.join(OUTPUT_DIR, f"{s['name']}.wav")
        print(f"Descargando: {s['desc']}")
        print(f"  URL: {s['url']}")
        print(f"  Output: {out}")
        if os.path.exists(out):
            print(f"  Ya existe, saltando...")
            continue
        ok = download_wav(s["url"], out)
        if ok:
            size = os.path.getsize(out) / (1024 * 1024)
            print(f"  OK ({size:.1f} MB)")
        else:
            print(f"  FALLÓ")

    print(f"\nAudios guardados en: {os.path.abspath(OUTPUT_DIR)}")


if __name__ == "__main__":
    main()
