# Zorvex Live

**Subtitulado y traduccion en vivo, 100% local, para conferencias open source.**

Transcripcion y traduccion simultanea (ES / EN / PT) procesada integramente en hardware local, sin depender de APIs comerciales pagas y sin que el audio abandone la sala.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.141-teal.svg)
![CUDA](https://img.shields.io/badge/CUDA-RTX%20Optimized-76B900.svg)
![Ollama](https://img.shields.io/badge/Ollama-gemma2%3A2b-black.svg)

---

## El problema

En Nerdearla tratamos de que el evento sea lo mas accesible posible. Por eso, desde hace varios anos ofrecemos transcripcion simultanea al español.

Hoy resolvemos eso con herramientas comerciales: una para transcripcion español -> español y otra para traduccion en vivo ingles -> español. Este esquema funciono bien, con sus limitaciones, pero este ano tenemos **mas de 30 sesiones en ingles, muchas en simultaneo**, y la solucion que tenemos ya no escala: es cara, depende de operacion manual y no se puede replicar facilmente en otros eventos.

Casi todas las conferencias tienen el mismo problema y ninguna tiene una solucion para resolverlo. El objetivo no es reemplazar a los interpretes humanos en todos los contextos, sino tener **la mejor solucion abierta** para que las conferencias open source sean accesibles.

### Por que las soluciones existentes no alcanzan

| Limitacion | Impacto en Nerdearla |
|---|---|
| **Costo por minuto** (servicios pagos) | 30 salas en paralelo durante varios dias hace el costo prohibitivo |
| **Audio enviado a terceros** | Privacidad comprometida; los speakers no siempre aceptan que su voz salga del recinto |
| **Operacion manual** | Cada sala necesita un operador dedicado; no escala a 30+ sesiones simultaneas |
| **Latencia alta** | Subtitulos desincronizados con la charla, experiencia degradada |
| **No replicable** | Soluciones propietarias atadas a un vendor; otros eventos no pueden reutilizarlas |

### La propuesta de Zorvex Live

Correr todo el pipeline de inferencia en hardware propio: el audio entra, se transcribe, se traduce y se emite como subtitulo en vivo. **Cero dependencia de APIs externas, cero costo por minuto, privacidad total.** Y al ser open source con licencia MIT, cualquier evento puede replicarlo.

---

## Caracteristicas clave

| Feature | Descripcion |
|---|---|
| **Transcripcion en vivo** | Whisper `large-v3` en GPU con faster-whisper, chunks de 3s con solapamiento para no cortar palabras |
| **Traduccion simultanea** | Gemma 2 (2B) via Ollama, traduciendo a ES / EN / PT en paralelo segun el idioma que pida cada cliente |
| **Multi-idioma por demanda** | Cada cliente pide su idioma via WebSocket; el backend traduce a todos los solicitados + el default |
| **Multicanal** | Procesamiento round-robin de multiples salas sobre una unica instancia de Whisper |
| **Zero-Lag** | Politica de flush de cola: si el procesamiento se atrasa (>=3 chunks), descarta audio viejo y prioriza el tiempo real |
| **Dedup de overlap** | Detecta y corta el texto duplicado entre chunks consecutivos por el solapamiento de 0.5s |
| **Overlay transparente para OBS** | Vista `/overlay` lista para capturar como Browser Source en OBS Studio o vMix (lower third), con chroma key opcional |
| **Vista de escenario** | Vista `/stage` con QR grande para que la audiencia se conecte desde el celular |
| **Vista mobile** | Vista `/mobile` minimalista optimizada para celulares, target del QR de escenario |
| **Reacciones en vivo** | Emojis flotantes estilo Twitch/YouTube Live, sincronizados por WebSocket entre todos los clientes |
| **Key Moments** | Extraccion automatica de temas clave cada ~300 palabras con Gemma, para navegar la charla despues |
| **Resumen ejecutivo** | Endpoint que genera 3 bullets + 5 keywords de la charla completa con Gemma |
| **Resiliente** | WebSockets con reconexion automatica, heartbeat y cache local de subtitulos en el cliente (localStorage) |
| **PWA** | Manifest + Service Worker: instalable en el celular, funciona offline con cache de subtitulos |
| **Exportable** | Historial descargable en SRT, VTT o TXT por sala |
| **Metricas en vivo** | Latencia de Whisper/Gemma, calidad de audio (logprob, no_speech), listeners por sala, uso de sistema |
| **Pausa/Resume** | Pausar el procesamiento de una sala sin perder el contexto; reanudar cuando se quiera |
| **ngrok-ready** | Headers y subprotocolo `ngrok-skip-browser-warning` para tunelizacion sin friccion |

---

## Arquitectura (MVP local)

```
  Microfono / vMix / OBS / Archivo
          |
          v
  [ Admin App -- Web Audio API -- chunks de 3s ]
          |
          v            HTTP POST /api/audio/{room}
   +------------------------------+
   |         FastAPI              |
   |   RoomManager (round-robin)  |
   +------------------------------+
          |                    |
          v                    v
   faster-whisper        Gemma 2 (Ollama)
   large-v3 / CUDA       gemma2:2b local
   (transcripcion)       (traduccion ES/EN/PT)
          |                    |
          +---------+----------+
                    v
            WebSocket /ws/{room}
                    |
       +------------+------------+
       |            |            |
       v            v            v
   Cliente web   Stage view   Overlay OBS
   (subtitulos)  (QR + texto)  (transparente)
       |
       v
   Mobile (via QR)
```

Todo corre en una sola maquina. Hardware de prueba del MVP:

- NVIDIA RTX 3060 Laptop GPU (6 GB VRAM)
- Ryzen 7, 16 GB RAM
- WSL2 / Ubuntu 24.04

### Pipeline de inferencia

1. **Captura**: el panel admin captura audio del microfono via Web Audio API (o sube un archivo), lo trocea en chunks de 3s con solapamiento de 0.5s, y los envia via `POST /api/audio/{room}`.
2. **Cola por sala**: `RoomManager` mantiene una cola por sala. Politica **Zero-Lag**: si acumula >=3 chunks, descarta los viejos y procesa el mas reciente.
3. **Transcripcion**: `WhisperEngine` (singleton en GPU) transcribe cada chunk con `faster-whisper` (large-v3, float16, beam_size=5, VAD filter). Usa las ultimas ~20 palabras como `initial_prompt` para mantener contexto.
4. **Dedup**: corta el texto del inicio del chunk nuevo que ya estaba al final del anterior (por el solapamiento).
5. **Traduccion**: `GemmaTranslator` traduce a todos los idiomas que pidieron los clientes + `TARGET_LANG`. Si el texto ya esta en el idioma destino, lo salta (heuristica).
6. **Broadcast**: el resultado se envia por WebSocket a todos los clientes de la sala, con `translations` (dict multi-idioma), latencias y metadata.

---

## Escalabilidad a produccion

El MVP procesa 2 salas en una GPU de consumo. Para cubrir las **30 salas simultaneas de Nerdearla**, la arquitectura migra a un modelo orientado a eventos con escalado horizontal:

```
                    +---------------------+
  30 escenarios --> |  Ingesta de audio   |
   (OBS/vMix/NDI)   |  Edge ingest nodes  |
                    +----------+----------+
                               |
                               v
                    +---------------------+
                    |  Message Queue      |
                    |  Redis Pub/Sub o    |
                    |  RabbitMQ           |
                    |  (1 topic x sala)   |
                    +----------+----------+
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
        +----------+     +----------+     +----------+
        | Worker 1 |     | Worker 2 | ... | Worker N |
        | Pod GPU  |     | Pod GPU  |     | Pod GPU  |
        | T4 / L4  |     | T4 / L4  |     | T4 / L4  |
        | Whisper  |     | Whisper  |     | Whisper  |
        +----+-----+     +----+-----+     +----+-----+
             |                |                |
             +----------------+----------------+
                               |
                               v
                    +---------------------+
                    |  Translation tier   |   (Gemma en CPU/GPU
                    |  Ollama replicas    |    o vLLM batch)
                    +----------+----------+
                               |
                               v
                    +---------------------+
                    |  WebSocket cluster  |
                    |  (pub/sub fan-out   |
                    |   via Redis)        |
                    +----------+----------+
                               |
                    Miles de clientes web,
                    overlays y apps moviles
```

Puntos clave del diseno:

- **Desacople total**: la ingesta nunca espera a la inferencia. La cola absorbe picos y los workers procesan a su ritmo.
- **Un worker por sala activa**: cada Pod con GPU T4/L4 corre Whisper dedicado; autoscaling por profundidad de cola.
- **Traduccion como tier separado**: Gemma es liviano y se paraleliza en CPU o con vLLM en batch, sin competir por VRAM con Whisper.
- **Fan-out sin tocar inferencia**: el cluster de WebSockets distribuye a miles de clientes; los workers nunca ven a los consumidores.
- **El pipeline del MVP ya es compatible**: `RoomManager` ya modela salas independientes, colas por sala y broadcast por WebSocket. Migrar es cambiar `queue.Queue` en memoria por topics de Redis y una instancia de `RoomManager` por workers stateless.

---

## Quickstart

### Requisitos previos

| Requisito | Version | Notas |
|---|---|---|
| Python | 3.10+ | Con `venv` |
| Ollama | latest | [ollama.com](https://ollama.com) |
| FFmpeg | cualquiera | En el PATH (`apt install ffmpeg`) |
| NVIDIA GPU + CUDA 12 | Recomendado | Sin GPU funciona en CPU (`int8`), mas lento |
| Node.js | 18+ | Solo para rebuild del frontend |

### 1. Modelo de traduccion

```bash
ollama pull gemma2:2b
ollama serve   # debe quedar corriendo en background
```

### 2. Backend

```bash
git clone https://github.com/ElZorroZ/Hackathon-Nerdearla.git
cd Hackathon-Nerdearla

python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

# Levantar el servidor (sirve API + WebSockets + frontend compilado)
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

### 3. Probar con audios de muestra

El repositorio incluye audios de prueba en `assets/samples/` (`sala1_sample.wav` en español, `sala2_sample.wav` en ingles). Para hacer streaming de un audio completo a una sala:

```bash
# Sala 1 - audio en español
python -m src.stream_sample --room sala-1 --wav assets/samples/sala1_sample.wav

# Sala 2 - audio en ingles
python -m src.stream_sample --room sala-2 --wav assets/samples/sala2_sample.wav
```

Esto trocea el WAV en chunks de 3s con solapamiento y los envia secuencialmente simulando streaming en vivo. Mientras corre, abri el overlay o el cliente web para ver los subtitulos.

Tambien podes subir audio desde el panel admin (`/admin`): grabando del microfono o subiendo un archivo `.mp3`/`.wav`/`.m4a`/`.ogg`.

### 4. Frontend (solo si modificas la UI)

```bash
cd frontend
npm install
npm run build      # genera frontend/dist que FastAPI sirve estaticamente
npm run dev        # alternativa: dev server con proxy a :8000
```

### 5. Vistas

| URL | Uso |
|---|---|
| `/` | Cliente de audiencia (subtitulos + reacciones + selector de idioma) |
| `/?room=sala-2` | Cliente directo a una sala (es lo que codifica el QR) |
| `/admin` | Panel de administracion (salas, metricas, captura de audio) |
| `/stage?room=sala-1` | Pantalla de escenario con QR grande |
| `/overlay?room=sala-1` | Lower third transparente para OBS/vMix |
| `/mobile?room=sala-1` | Vista minimalista para celulares (target del QR) |

---

## Overlay para OBS / vMix

La vista `/overlay` esta disenada para capturarse como **Browser Source** en OBS Studio o vMix, flotando transparente sobre la escena.

### URL base

```
http://localhost:8000/overlay?room=sala-1
```

### Parametros

| Parametro | Valores | Default | Descripcion |
|---|---|---|---|
| `room` | ID de sala | `sala-1` | Sala a la que conectarse |
| `theme` | `dark`, `light`, `minimal` | `dark` | Estilo visual del subtitulo |
| `fontSize` | `small`, `medium`, `large`, `xlarge` | `medium` | Tamano de fuente |
| `lang` | `es`, `en`, `pt`, `original` | `es` | Idioma de traduccion a mostrar |
| `align` | `center`, `left` | `center` | Alineacion horizontal |
| `showOriginal` | `true`, `false` | `false` | Mostrar texto original arriba de la traduccion |
| `chroma` | color hex (`#00ff00`) | transparente | Fondo solido para chroma key |
| `status` | `true`, `false` | `true` | Indicador de conexion (EN VIVO / RECONECTANDO). Usar `false` para produccion en OBS |

### Ejemplo para produccion (sin indicador de estado)

```
http://localhost:8000/overlay?room=sala-1&theme=dark&fontSize=large&status=false
```

### Configuracion en OBS

1. **Sources -> + -> Browser**
2. URL: la del overlay (ver arriba)
3. Width: 1920, Height: 1080
4. El fondo es transparente; los subtitulos aparecen abajo centrados

---

## API REST

### Salas

| Metodo | Endpoint | Descripcion |
|---|---|---|
| `GET` | `/api/rooms` | Lista salas (id, name, lang) |
| `POST` | `/api/rooms` | Crea sala (body: `{name, lang}`) |
| `DELETE` | `/api/rooms/{room_id}` | Elimina sala |
| `PUT` | `/api/rooms/{room_id}/language?lang=en` | Cambia idioma fuente |
| `GET` | `/api/rooms/{room_id}/language` | Devuelve idioma de la sala |
| `POST` | `/api/audio/{room_id}` | Recibe chunk de audio (multipart `file`) |
| `POST` | `/api/rooms/{room_id}/pause` | Pausa procesamiento |
| `POST` | `/api/rooms/{room_id}/resume` | Reanuda procesamiento |
| `POST` | `/api/rooms/{room_id}/clear` | Vaciar cola + historial |
| `POST` | `/api/rooms/{room_id}/flush` | Zero-Lag: vaciar cola de audio pendiente |
| `GET` | `/api/rooms/{room_id}/latency` | Latencia estimada de cola |
| `POST` | `/api/rooms/{room_id}/summary` | Resumen ejecutivo (3 bullets + 5 keywords) |
| `GET` | `/api/rooms/{room_id}/key-moments` | Lista key moments de la sala |

### Export

| Metodo | Endpoint | Descripcion |
|---|---|---|
| `GET` | `/api/rooms/{room_id}/export?format=srt` | Descarga SRT |
| `GET` | `/api/rooms/{room_id}/export?format=vtt` | Descarga VTT |
| `GET` | `/api/rooms/{room_id}/export?format=txt` | Descarga TXT plano |
| `GET` | `/api/rooms/{room_id}/subtitles` | Historial completo en JSON |

### Metricas (admin)

| Metodo | Endpoint | Descripcion |
|---|---|---|
| `GET` | `/api/admin/metrics` | Metricas de salas + sistema |
| `GET` | `/api/admin/metrics/rooms` | Solo metricas por sala |
| `GET` | `/api/admin/metrics/system` | Solo metricas de sistema |

### WebSocket

| Endpoint | Descripcion |
|---|---|
| `ws://host/ws/{room_id}` | Subtitulos en vivo + reacciones + key moments |
| `ws://host/ws/admin` | Broadcast de metricas a admins (cada 2s) |

**Mensajes cliente -> servidor** (via `/ws/{room_id}`):

```jsonc
{ "type": "lang", "lang": "en" }       // pedir traduccion a un idioma
{ "type": "reaction", "emoji": "🔥" }  // enviar reaccion
```

**Mensajes servidor -> cliente**:

```jsonc
{
  "room": "sala-1",
  "original": "Hello world",
  "translated": "Hola mundo",
  "translations": { "es": "Hola mundo", "pt": "Ola mundo" },
  "timestamp": 1695600000.0,
  "index": 42,
  "whisper_ms": 850.3,
  "gemma_ms": 120.5
}
{ "type": "metrics", "rooms": {...}, "system": {...} }  // solo /ws/admin
{ "type": "key_moment", "title": "...", "timestamp": ... }
```

---

## Estructura del repositorio

```
Hackathon-Nerdearla/
|
|-- src/
|   |-- main.py                  # FastAPI app, lifespan, broadcasters
|   |-- config.py                # Config central (modelos, salas, audio)
|   |-- models.py                # Dataclasses: SubtitleEntry, AudioChunk, KeyMoment
|   |-- run_test.py              # Test de integracion del pipeline
|   |-- test_e2e.py              # Test end-to-end (audio + WS)
|   |-- stream_sample.py         # Streaming de un WAV a una sala (test)
|   |-- download_samples.py      # Descarga audios de prueba a /samples
|   |
|   |-- engine/
|   |   |-- whisper_engine.py    # Singleton faster-whisper en GPU
|   |   |-- translator.py        # Gemma via Ollama (multi-idioma + resumen + key moments)
|   |   |-- room_manager.py      # Colas round-robin, zero-lag, dedup, key moments
|   |
|   |-- api/
|   |   |-- routes_rooms.py      # REST: salas, audio, pausa/resume, flush, summary
|   |   |-- routes_admin.py      # REST: metricas del sistema
|   |   |-- routes_export.py     # SRT / VTT / TXT + historial JSON
|   |   |-- websockets.py        # WS manager, rooms, admin, reacciones
|   |
|   |-- services/
|       |-- subtitle_store.py    # Historial por sala + exportadores
|       |-- metrics_collector.py # Latencias, calidad de audio, errores
|
|-- frontend/
|   |-- src/
|   |   |-- main.tsx             # Router por path (/ /admin /overlay /stage /mobile)
|   |   |-- App.tsx             # Cliente de audiencia
|   |   |-- AdminApp.tsx        # Panel admin (captura audio, metricas, salas)
|   |   |-- StageApp.tsx         # Vista de escenario (QR)
|   |   |-- OverlayApp.tsx      # Overlay transparente para OBS
|   |   |-- MobileApp.tsx       # Vista minimalista para celulares
|   |   |-- api.ts              # Cliente REST
|   |   |-- types.ts            # Tipos TypeScript
|   |   |-- hooks/
|   |   |   |-- useResilientWebSocket.ts  # WS con heartbeat + reconexion
|   |   |-- components/         # SubtitleDisplay, ReactionsBar, ExportButton, ui/
|
|-- assets/
|   |-- samples/                # Audios de prueba (sala1_sample.wav, sala2_sample.wav)
|-- docs/                       # Documentacion adicional
|-- requirements.txt
|-- LICENSE
`-- README.md
```

---

## Variables de entorno

Toda la configuracion es sobreescribible via env (ver `src/config.py`):

| Variable | Default | Descripcion |
|---|---|---|
| `WHISPER_MODEL` | `large-v3` | Modelo faster-whisper |
| `WHISPER_DEVICE` | `cuda` | `cuda` (float16) o `cpu` (int8) |
| `GEMMA_MODEL` | `gemma2:2b` | Modelo Ollama de traduccion |
| `TARGET_LANG` | `es` | Idioma destino por defecto |
| `OLLAMA_HOST` | autodetectado | Host de Ollama (detecta WSL -> IP del host Windows) |
| `CHUNK_DURATION` | `3.0` | Segundos por chunk de audio |
| `SAMPLE_RATE` | `16000` | Hz del audio de entrada |
| `CHUNK_OVERLAP` | `0.5` | Solapamiento entre chunks (s) |

---

## Scripts de test

| Script | Uso |
|---|---|
| `python -m src.run_test` | Test de integracion del pipeline (Gemma + Whisper) |
| `python src/test_e2e.py` | Test end-to-end: envia audio y recibe subtitulos via WS |
| `python -m src.stream_sample --room sala-1 --wav assets/samples/sala1_sample.wav` | Streaming de un WAV completo a una sala |
| `python -m src.download_samples` | Descarga audios de prueba a `samples/` |

---

## Licencia

MIT License -- aprobada por la OSI. Ver [LICENSE](LICENSE).

Desarrollado para la Vibeathon de Nerdearla.
