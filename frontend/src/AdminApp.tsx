import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api";
import type { RoomMetrics, SystemMetrics, MetricsPayload, RoomInfo } from "./types";
import { Icon } from "./components/Icon";
import { MetricCard } from "./components/MetricCard";
import { SystemMetricsCard } from "./components/SystemMetricsCard";
import { GlossaryManager } from "./components/GlossaryManager";
import { ExportButton } from "./components/ExportButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { RefreshCwIcon, type RefreshCwIconHandle } from "@/components/ui/refresh-cw-icon";
import { MenuIcon, type MenuIconHandle } from "@/components/ui/menu-icon";
import { SummaryModal } from "./components/SummaryModal";
import { AudioQualityWidget } from "./components/AudioQualityWidget";

type AdminView = "dashboard" | "salas" | "glosario";

export function AdminApp() {
  const [view, setView] = useState<AdminView>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [metrics, setMetrics] = useState<{
    rooms: RoomMetrics[];
    system: SystemMetrics;
  }>({ rooms: [], system: { uptime_seconds: 0, total_errors: 0, total_rooms: 0 } });
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const refreshIconRef = useRef<RefreshCwIconHandle>(null);
  const menuIconRef = useRef<MenuIconHandle>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomLang, setNewRoomLang] = useState("ES");
  const [recording, setRecording] = useState(false);
  const [recordRoom, setRecordRoom] = useState("");
  const [recordLang, setRecordLang] = useState("es");
  const [uploading, setUploading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordIntervalRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const pcmBufferRef = useRef<Float32Array[]>([]);

  const fetchRooms = () => {
    api.getRooms().then((data) => {
      setRooms(data.rooms || []);
      if (data.rooms.length > 0 && !recordRoom) setRecordRoom(data.rooms[0].id);
    });
  };

  const connectWs = useCallback(() => {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/admin`, ["ngrok-skip-browser-warning"]);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false);
    };
    ws.onclose = () => {
      setConnected(false);
      setReconnecting(true);
      // Auto-reconnect after 2s
      setTimeout(() => {
        if (wsRef.current === ws) {
          connectWs();
        }
      }, 2000);
    };
    ws.onmessage = (e) => {
      const data: MetricsPayload = JSON.parse(e.data);
      if (data.type === "metrics") {
        setMetrics({ rooms: data.rooms, system: data.system });
      }
    };
  }, []);

  useEffect(() => {
    fetchRooms();
    connectWs();

    api.getMetrics().then((data) =>
      setMetrics({ rooms: data.rooms, system: data.system })
    );

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connectWs]);

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) return;
    await api.createRoom(newRoomName.trim(), newRoomLang);
    setNewRoomName("");
    fetchRooms();
  };

  const handleDeleteRoom = async (roomId: string) => {
    await api.deleteRoom(roomId);
    fetchRooms();
  };

  const handleFlushRoom = async (roomId: string) => {
    try {
      await fetch(`/api/rooms/${roomId}/flush`, {
        method: "POST",
        headers: { "ngrok-skip-browser-warning": "1" },
      });
    } catch {
      // ignore
    }
  };

  const handleLangChange = async (lang: string) => {
    setRecordLang(lang);
    if (recordRoom) {
      await api.setRoomLang(recordRoom, lang);
    }
  };

  const handleRefresh = async () => {
    refreshIconRef.current?.startAnimation();
    try {
      const [roomsData, metricsData] = await Promise.all([
        api.getRooms(),
        api.getMetrics(),
      ]);
      setRooms(roomsData.rooms || []);
      setMetrics({ rooms: metricsData.rooms, system: metricsData.system });
    } catch {
      // ignore
    }
    setTimeout(() => refreshIconRef.current?.stopAnimation(), 1000);
  };

  const handleMenuClick = () => {
    menuIconRef.current?.startAnimation();
    setSidebarOpen(!sidebarOpen);
    setTimeout(() => menuIconRef.current?.stopAnimation(), 400);
  };

  const handlePause = async (room: string) => api.pauseRoom(room);
  const handleResume = async (room: string) => api.resumeRoom(room);
  const handleClear = async (room: string) => api.clearRoom(room);

  // Encode Float32 PCM to WAV 16kHz mono
  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    // Resample to 16kHz
    const targetRate = 16000;
    const ratio = sampleRate / targetRate;
    const targetLength = Math.round(samples.length / ratio);
    const resampled = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, samples.length - 1);
      const frac = srcIdx - idx0;
      resampled[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac;
    }

    // Convert to 16-bit PCM
    const pcm16 = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Build WAV header + data
    const buffer = new ArrayBuffer(44 + pcm16.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcm16.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, pcm16.length * 2, true);

    const bytes = new Uint8Array(buffer);
    const pcmBytes = new Uint8Array(pcm16.buffer);
    bytes.set(pcmBytes, 44);

    return new Blob([buffer], { type: "audio/wav" });
  };

  // Mic recording: capture audio via AudioContext, send WAV chunks
  const startRecording = async () => {
    if (!recordRoom) return;

    // Liberar stream anterior si existe
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // Use ScriptProcessorNode to capture raw PCM
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!recordingRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        // Copy the buffer (it gets reused)
        pcmBufferRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      // Connect through a muted gain node to avoid feedback/echo cancellation
      const mutedGain = audioCtx.createGain();
      mutedGain.gain.value = 0;
      processor.connect(mutedGain);
      mutedGain.connect(audioCtx.destination);

      recordingRef.current = true;
      pcmBufferRef.current = [];
      setRecording(true);

      // Every 3s, flush the PCM buffer as a WAV file
      recordIntervalRef.current = window.setInterval(async () => {
        if (!recordingRef.current || pcmBufferRef.current.length === 0) return;

        const chunks = pcmBufferRef.current;
        pcmBufferRef.current = [];

        // Concatenate all chunks
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        if (merged.length < 1600) return; // skip very short chunks (<0.1s)

        const wavBlob = encodeWav(merged, audioCtx.sampleRate);
        const formData = new FormData();
        formData.append("file", wavBlob, "chunk.wav");
        try {
          await fetch(`/api/audio/${recordRoom}`, {
            method: "POST",
            body: formData,
            headers: { "ngrok-skip-browser-warning": "1" },
          });
        } catch {
          // ignore network errors
        }
      }, 3000);
    } catch (err: any) {
      let msg = "No se pudo acceder al micrófono.\n\n";
      if (err?.name === "NotReadableError") {
        msg += "El micrófono está siendo usado por otra aplicación o no está disponible.\n";
        msg += "Cerrá otras apps que usen audio (Zoom, Discord, OBS) e intentá de nuevo.";
      } else if (err?.name === "NotAllowedError") {
        msg += "Permiso denegado. Habilitá el micrófono en el navegador.";
      } else if (err?.name === "NotFoundError") {
        msg += "No se encontró ningún micrófono conectado.";
      } else {
        msg += "Error: " + (err?.name || err?.message || String(err));
      }
      alert(msg);
    }
  };

  const stopRecording = () => {
    recordingRef.current = false;
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    pcmBufferRef.current = [];
    setRecording(false);
  };

  // File upload: send audio file in chunks to simulate streaming
  const handleFileUpload = async (file: File) => {
    if (!recordRoom) {
      alert("Seleccioná una sala primero");
      return;
    }
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Send in 3-second chunks (~48KB at 16kHz 16-bit mono)
      const chunkSize = 96000; // ~3s at 16kHz 16-bit
      const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
        const chunk = arrayBuffer.slice(start, end);
        const blob = new Blob([chunk], { type: file.type || "audio/wav" });
        const formData = new FormData();
        formData.append("file", blob, `chunk_${i}.${file.name.split(".").pop() || "wav"}`);
        try {
          await fetch(`/api/audio/${recordRoom}`, {
            method: "POST",
            body: formData,
            headers: { "ngrok-skip-browser-warning": "1" },
          });
        } catch {
          // ignore network errors, continue sending
        }
        // Small delay between chunks to simulate real-time
        if (i < totalChunks - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch (err) {
      alert("Error al procesar el archivo: " + err);
    }
    setUploading(false);
  };

  const selectedRoomMetrics = metrics.rooms.find((r) => r.room_id === recordRoom);

  const navItems: { id: AdminView; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "salas", label: "Salas", icon: "radio" },
    { id: "glosario", label: "Glosario", icon: "book" },
  ];

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-60" : "w-16"
        } shrink-0 border-r border-border bg-card flex flex-col transition-all duration-200`}
      >
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shrink-0">
            <Icon name="dashboard" className="w-4 h-4 text-white" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white truncate">LiveSubs</h1>
              <p className="text-[10px] text-muted-foreground truncate">Admin Panel</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 space-y-1 px-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                view === item.id
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
              title={item.label}
            >
              <Icon name={item.icon as any} className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-2 border-t border-border space-y-1">
          <button
            onClick={handleMenuClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title={sidebarOpen ? "Contraer" : "Expandir"}
          >
            <MenuIcon ref={menuIconRef} size={18} isAnimated={false} className="shrink-0" />
            {sidebarOpen && <span>Contraer</span>}
          </button>
          <a
            href="/"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title="Cliente"
          >
            <Icon name="monitor" className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span>Cliente</span>}
          </a>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-white">
              {view === "dashboard" && "Dashboard"}
              {view === "salas" && "Gestión de Salas"}
              {view === "glosario" && "Glosario"}
            </h2>
            <button
              onClick={handleRefresh}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Refrescar"
            >
              <RefreshCwIcon ref={refreshIconRef} size={16} isAnimated={false} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div
              className={`w-2 h-2 rounded-full ${
                connected
                  ? "bg-emerald-400 pulse-dot"
                  : reconnecting
                    ? "bg-yellow-400 pulse-dot"
                    : "bg-muted-foreground"
              }`}
            />
            <span
              className={
                connected
                  ? "text-emerald-400"
                  : reconnecting
                    ? "text-yellow-400"
                    : "text-muted-foreground"
              }
            >
              {connected ? "Conectado" : reconnecting ? "Reconectando..." : "Desconectado"}
            </span>
          </div>
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-6">
          {view === "dashboard" && (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Room selector + Recording controls */}
              <section className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
                  Sala de Captura
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-56">
                    <Select value={recordRoom} onValueChange={setRecordRoom}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar sala" />
                      </SelectTrigger>
                      <SelectContent>
                        {rooms.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name || r.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-36">
                    <Select value={recordLang} onValueChange={handleLangChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Idioma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="pt">Português</SelectItem>
                        <SelectItem value="fr">Français</SelectItem>
                        <SelectItem value="it">Italiano</SelectItem>
                        <SelectItem value="de">Deutsch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {recording ? (
                    <Button variant="destructive" onClick={stopRecording}>
                      <span className="w-2 h-2 rounded-full bg-white mr-1" />
                      Detener
                    </Button>
                  ) : (
                    <Button onClick={startRecording} disabled={!recordRoom || uploading}>
                      <Icon name="mic" className="w-4 h-4" />
                      Capturar Micrófono
                    </Button>
                  )}
                  {recording && (
                    <span className="text-xs text-red-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 pulse-dot" />
                      Grabando...
                    </span>
                  )}
                </div>

                {/* File upload */}
                <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".mp3,.wav,.m4a,.ogg,.webm"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                        e.target.value = "";
                      }}
                    />
                    <span className="inline-flex items-center gap-2 bg-secondary hover:bg-accent border border-border px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground transition-all text-sm cursor-pointer">
                      <Icon name="download" className="w-4 h-4" />
                      Probar con Archivo
                    </span>
                  </label>
                  {uploading && (
                    <span className="text-xs text-yellow-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 pulse-dot" />
                      Subiendo...
                    </span>
                  )}
                </div>
              </section>

              {/* System metrics */}
              <section>
                <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                  Sistema
                </h3>
                <SystemMetricsCard sys={metrics.system} />
              </section>

              {/* Selected room metrics */}
              {selectedRoomMetrics && (
                <section>
                  <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                    Métricas: {selectedRoomMetrics.room_id}
                  </h3>
                  <div className="flex items-center gap-3 mb-3">
                    <AudioQualityWidget room={selectedRoomMetrics} />
                    <button
                      onClick={() => setShowSummary(true)}
                      disabled={!recordRoom}
                      className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg text-sm text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ✨ Generar Resumen con IA
                    </button>
                  </div>
                  <div className="max-w-sm">
                    <MetricCard
                      room={selectedRoomMetrics}
                      onPause={handlePause}
                      onResume={handleResume}
                      onClear={handleClear}
                    />
                  </div>
                </section>
              )}

              {/* All room metrics grid */}
              <section>
                <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                  Todas las Salas
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {metrics.rooms.map((room) => (
                    <MetricCard
                      key={room.room_id}
                      room={room}
                      onPause={handlePause}
                      onResume={handleResume}
                      onClear={handleClear}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          {view === "salas" && (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Create room */}
              <section className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h3 className="text-xs text-muted-foreground uppercase tracking-wider">
                  Crear Sala
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
                  <Input
                    type="text"
                    placeholder="Nombre de la sala (ej: Escenario Principal)"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    className="flex-1 min-w-[200px]"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
                  />
                  <div className="w-28">
                    <Select value={newRoomLang} onValueChange={setNewRoomLang}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ES">Español</SelectItem>
                        <SelectItem value="EN">English</SelectItem>
                        <SelectItem value="PT">Português</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleCreateRoom}>
                    <Icon name="plus" className="w-4 h-4" />
                    Crear
                  </Button>
                </div>
              </section>

              {/* Room list */}
              <section>
                <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                  Salas Activas ({rooms.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {rooms.map((room) => (
                    <div key={room.id} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{room.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{room.id}</p>
                        </div>
                        {room.lang && (
                          <span className="text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded shrink-0">
                            {room.lang}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        <a
                          href={`/overlay?room=${room.id}&theme=dark&fontSize=large`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <Icon name="monitor" className="w-3 h-3" />
                          Overlay
                        </a>
                        <span className="text-muted-foreground">·</span>
                        <a
                          href={`/stage?room=${room.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <Icon name="radio" className="w-3 h-3" />
                          Stage
                        </a>
                        <span className="text-muted-foreground">·</span>
                        <a
                          href={`/?room=${room.id}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          Ver
                        </a>
                        <span className="text-muted-foreground">·</span>
                        <button
                          onClick={() => handleFlushRoom(room.id)}
                          className="text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
                        >
                          <Icon name="activity" className="w-3 h-3" />
                          Flush
                        </button>
                        <span className="text-muted-foreground">·</span>
                        <ExportButton room={room.id} />
                        <span className="text-muted-foreground">·</span>
                        <button
                          onClick={() => handleDeleteRoom(room.id)}
                          className="text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                          <Icon name="trash" className="w-3 h-3" />
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {view === "glosario" && (
            <div className="max-w-3xl mx-auto">
              <GlossaryManager />
            </div>
          )}
        </main>
      </div>

      {showSummary && recordRoom && (
        <SummaryModal room={recordRoom} onClose={() => setShowSummary(false)} />
      )}
    </div>
  );
}
