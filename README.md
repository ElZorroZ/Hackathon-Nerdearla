# LiveSubs - Subtítulos en vivo con IA local

Transcripción y traducción simultánea en vivo para conferencias, 100% local y open source.

Proyecto para la hackathon [Nerdearla](https://nerdearla.org/).

## Arquitectura

```
┌─────────────┐     ┌──────────────────────────────────────────────┐
│  Navegador  │◄───►│  FastAPI + WebSockets (main.py)               │
│  (Frontend) │ WS │  ┌──────────────────────────────────────────┐ │
└─────────────┘    │  │  RoomManager (round-robin)                 │ │
                   │  │  ┌────────────┐  ┌─────────────────────┐  │ │
  POST /api/audio  │  │  │ Whisper    │  │ Gemma (Ollama)      │  │ │
  (chunk WAV)     ─┼─►│  │ (GPU: 1    │─►│ Traducción EN→ES    │  │ │
                   │  │  │ instancia) │  │ gemma2:2b Q4_0      │  │ │
                   │  │  └────────────┘  └─────────────────────┘  │ │
                   │  └──────────────────────────────────────────┘ │
                   └──────────────────────────────────────────────┘
```

### Pipeline

1. **Audio** → se envían chunks de 3s (WAV 16kHz mono) via `POST /api/audio/{room}`
2. **Whisper** (GPU compartida) → transcribe audio a texto (1 sola instancia en VRAM)
3. **Gemma 2B** (Ollama) → traduce el texto al idioma objetivo
4. **WebSocket** → los subtítulos se envían en tiempo real a los clientes conectados

### Por qué funciona con 6GB VRAM

- **Whisper `base`**: ~140MB en VRAM
- **Gemma 2B Q4_0**: ~1.6GB en VRAM (gestionado por Ollama)
- **Una sola instancia de Whisper** compartida entre todas las salas (round-robin)
- Los chunks de 3s se procesan en milisegundos → el usuario no percibe latencia

## Requisitos

- **GPU**: NVIDIA con ≥6GB VRAM (probado en RTX 3060 Laptop)
- **Ollama**: instalado con `gemma2:2b`
- **Python 3.12+** con venv
- **WSL2** (si Ollama corre en Windows, el backend en WSL detecta la IP automáticamente)

## Instalación

```bash
# 1. Crear entorno virtual
python3 -m venv .venv
source .venv/bin/activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Descargar modelo Gemma en Ollama
ollama pull gemma2:2b

# 4. Si Ollama corre en Windows y el backend en WSL, configurar Ollama:
#    En Windows CMD (como admin):
#      taskkill /f /im ollama.exe
#      set OLLAMA_HOST=0.0.0.0:11434
#      ollama serve
```

## Uso

```bash
# Activar entorno
source .venv/bin/activate

# Test del pipeline (sin servidor)
python src/engine.py --test

# Iniciar servidor
uvicorn src.main:app --host 0.0.0.0 --port 8000

# Test end-to-end (con servidor corriendo)
python src/test_e2e.py
```

Abrir `http://localhost:8000` en el navegador para ver la interfaz de subtítulos.

## API

| Endpoint | Método | Descripción |
|---|---|---|
| `/` | GET | Frontend web |
| `/api/rooms` | GET | Lista de salas disponibles |
| `/api/audio/{room_id}` | POST | Subir chunk de audio (WAV 16kHz mono) |
| `/ws/{room_id}` | WS | WebSocket para recibir subtítulos en tiempo real |

## Escalabilidad a 30 salas (Producción)

### Cuello de botella actual

El modelo de round-robin con una sola instancia de Whisper funciona para 2-5 salas con chunks de 3s. Para 30 salas:

- 30 salas × 1 chunk/3s = 10 chunks/s
- Whisper `base` en GPU: ~0.3s por chunk → 3.3 chunks/s de throughput
- **Gap**: 10 vs 3.3 → latencia acumulada inaceptable

### Arquitectura propuesta para 30 salas

```
                    ┌─────────────────────────────────┐
                    │  Load Balancer (nginx/HAProxy)  │
                    │  - Sticky sessions por room_id  │
                    └──────┬──────────┬──────────┬────┘
                           │          │          │
                    ┌──────▼──┐ ┌─────▼───┐ ┌────▼────┐
                    │ Worker 1 │ │ Worker 2 │ │ Worker 3│
                    │ 10 salas │ │ 10 salas │ │ 10 salas│
                    │ 1 Whisper│ │ 1 Whisper│ │ 1 Whisper│
                    │ 1 Gemma  │ │ 1 Gemma  │ │ 1 Gemma │
                    └──────────┘ └─────────┘ └─────────┘
```

### Cambios necesarios

1. **Múltiples workers**: Cada worker es un proceso independiente con su propia instancia de Whisper + conexión a Ollama. Con 3 workers (10 salas c/u), cada worker procesa ~3.3 chunks/s → match exacto.

2. **Load balancer con routing por room_id**: nginx con `upstream` hash por `room_id` para que todos los chunks de una sala vayan al mismo worker.

3. **Redis pub/sub** entre workers y WebSocket gateway: Los workers publican subtítulos en Redis, un gateway WebSocket los distribuye a los clientes.

4. **Modelo Whisper `small`** (opcional): Si se prioriza calidad, subir a `small` (~480MB VRAM) y usar 4-5 workers.

5. **Ollama con `num_parallel`**: Configurar `OLLAMA_NUM_PARALLEL=2` para permitir traducciones concurrentes.

### Estimación de recursos (30 salas)

| Componente | Por worker | 3 workers total |
|---|---|---|
| Whisper `base` VRAM | ~140MB | ~420MB (3 GPUs o 1 GPU con 6GB+) |
| Gemma 2B VRAM (Ollama) | ~1.6GB | ~1.6GB (compartido si misma GPU) |
| RAM del proceso | ~500MB | ~1.5GB |
| CPU | 1 núcleo | 3 núcleos |

Con una RTX 3060 (6GB): 1 worker con Whisper `base` + Gemma 2B = ~1.7GB VRAM. Para 30 salas se necesitaría una GPU con 8GB+ o múltiples GPUs.

## Estructura del proyecto

```
hackathon-nerdearla/
├── src/
│   ├── engine.py       # Core: Whisper + Gemma + RoomManager
│   ├── main.py         # FastAPI + WebSockets
│   └── test_e2e.py     # Test end-to-end
├── frontend/
│   └── index.html      # Interfaz web (selector de salas + subtítulos)
├── requirements.txt
└── README.md
```

## Stack

- **STT**: [openai-whisper](https://github.com/openai/whisper) (local, GPU)
- **Traducción**: [Gemma 2B](https://ollama.com/library/gemma2) via [Ollama](https://ollama.com)
- **Backend**: [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/)
- **Frontend**: HTML/CSS/JS vanilla + WebSockets

## Equipo

- Thiago Velázquez ([ElZorroZ](https://github.com/ElZorroZ))
