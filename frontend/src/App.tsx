import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api";
import type { SubtitleEntry, RoomInfo } from "./types";
import { Icon } from "./components/Icon";
import { SubtitleDisplay } from "./components/SubtitleDisplay";
import { PauseIcon, type PauseIconHandle } from "@/components/ui/pause-icon";
import { PlayIcon, type PlayIconHandle } from "@/components/ui/play-icon";
import { WifiSyncIcon, type WifiSyncIconHandle } from "@/components/ui/wifi-sync-icon";
import { SummaryModal } from "./components/SummaryModal";
import { KeyMomentsPanel } from "./components/KeyMomentsPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/motion/combobox";
import { useResilientWebSocket } from "./hooks/useResilientWebSocket";

export function App() {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [lang, setLang] = useState("original");
  const [fontSize, setFontSize] = useState("md");
  const [autoScroll, setAutoScroll] = useState(true);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const subtitleListRef = useRef<HTMLDivElement>(null);

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = selectedRoom ? `${proto}//${window.location.host}/ws/${selectedRoom}` : null;

  // Load cached subtitles from localStorage on room change
  useEffect(() => {
    if (!selectedRoom) return;
    try {
      const cached = localStorage.getItem(`subs_${selectedRoom}`);
      if (cached) {
        const parsed: SubtitleEntry[] = JSON.parse(cached);
        setSubtitles(parsed);
      } else {
        setSubtitles([]);
      }
    } catch {
      setSubtitles([]);
    }
  }, [selectedRoom]);

  const handleWsMessage = useCallback((data: SubtitleEntry) => {
    if (data.type === "metrics") return;
    if (data.type === "key_moment") {
      window.dispatchEvent(new CustomEvent("key_moment", { detail: data }));
      return;
    }
    setSubtitles((prev: SubtitleEntry[]) => {
      const next = [...prev, data].slice(-200);
      // Persist to localStorage for offline resilience
      try {
        localStorage.setItem(`subs_${data.room || selectedRoom}`, JSON.stringify(next));
      } catch {
        // localStorage may be full, ignore
      }
      return next;
    });
  }, [selectedRoom]);

  const { connected, reconnecting, flush } = useResilientWebSocket(wsUrl, {
    onMessage: handleWsMessage,
  });

  const pauseRef = useRef<PauseIconHandle>(null);
  const playRef = useRef<PlayIconHandle>(null);
  const wifiSyncRef = useRef<WifiSyncIconHandle>(null);

  useEffect(() => {
    if (autoScroll) pauseRef.current?.startAnimation();
    else playRef.current?.startAnimation();
  }, [autoScroll]);

  useEffect(() => {
    if (reconnecting) {
      wifiSyncRef.current?.startAnimation();
    } else {
      wifiSyncRef.current?.stopAnimation();
    }
  }, [reconnecting]);

  useEffect(() => {
    api.getRooms().then((data) => {
      setRooms(data.rooms || []);
      if (data.rooms.length > 0) setSelectedRoom(data.rooms[0].id);
    });
  }, []);

  const roomCount = rooms.length;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* Header with room tabs + pause + OBS overlay */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#4A90E2] to-[#64748B] rounded-xl flex items-center justify-center shadow-lg shadow-[#4A90E2]/20">
                <Icon name="mic" className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight">Zorvex Live</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1.5 text-xs text-[#38A169] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#38A169] pulse-dot" />
                    EN VIVO
                  </span>
                  <span className="text-xs text-muted-foreground">· {roomCount} Salas</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Connection status */}
              <div className="flex items-center gap-2 text-xs bg-secondary border border-border px-3 py-1.5 rounded-lg">
                {reconnecting ? (
                  <WifiSyncIcon ref={wifiSyncRef} size={14} isAnimated={false} className="text-yellow-400" />
                ) : (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      connected
                        ? "bg-emerald-400"
                        : "bg-red-400"
                    }`}
                  />
                )}
                <span
                  className={
                    connected
                      ? "text-emerald-400"
                      : reconnecting
                        ? "text-yellow-400"
                        : "text-red-400"
                  }
                >
                  {connected
                    ? "Online"
                    : reconnecting
                      ? "Reconectando..."
                      : "Desconectado"}
                </span>
              </div>
              <a
                href="/admin"
                className="flex items-center gap-2 bg-secondary hover:bg-accent border border-border px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground transition-all text-sm"
              >
                <Icon name="settings" className="w-4 h-4" />
                <span className="hidden sm:inline">Panel de Producción</span>
              </a>
            </div>
          </div>

        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-5 flex flex-col gap-4 min-h-0 overflow-hidden">
        {/* Toolbar: Combobox room search + lang select + font size select + export */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Room search with @beui/combobox */}
          <div className="w-56">
            <Combobox value={selectedRoom} onValueChange={setSelectedRoom}>
              <ComboboxTrigger>
                <ComboboxValue placeholder="Buscar sala..." />
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput placeholder="Buscar sala..." />
                <ComboboxList>
                  <ComboboxEmpty>Sin resultados</ComboboxEmpty>
                  {rooms.map((room) => (
                    <ComboboxItem
                      key={room.id}
                      value={room.id}
                      textValue={room.name || room.id}
                      keywords={[room.lang || ""]}
                    >
                      <span className="flex items-center gap-2">
                        {room.lang && (
                          <span className="text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                            {room.lang}
                          </span>
                        )}
                        {room.name || room.id}
                      </span>
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          {/* Language select with @beui/select */}
          <div className="w-44">
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger>
                <SelectValue placeholder="Idioma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Idioma Original</SelectItem>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="pt">Português</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font size select with @beui/select */}
          <div className="w-32">
            <Select value={fontSize} onValueChange={setFontSize}>
              <SelectTrigger>
                <SelectValue placeholder="Tamaño" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">Chico</SelectItem>
                <SelectItem value="md">Mediano</SelectItem>
                <SelectItem value="lg">Grande</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sync button */}
          <button
            id="sync-btn"
            onClick={() => {
              flush();
              const btn = document.getElementById('sync-btn');
              if (btn) {
                btn.classList.add('animate-spin');
                setTimeout(() => btn.classList.remove('animate-spin'), 800);
              }
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all shrink-0 bg-secondary border-border text-foreground hover:text-primary hover:border-primary/50"
            title="Sincronizar"
          >
            <Icon name="sync" className="w-3.5 h-3.5" />
          </button>

          {/* Pause / Resume auto-scroll */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all shrink-0 ${
              autoScroll
                ? "bg-secondary border-border text-foreground"
                : "bg-secondary border-border text-muted-foreground"
            }`}
            title={autoScroll ? "Pausar auto-scroll" : "Reanudar auto-scroll"}
          >
            {autoScroll ? (
              <PauseIcon ref={pauseRef} size={14} isAnimated={false} />
            ) : (
              <PlayIcon ref={playRef} size={14} isAnimated={false} />
            )}
          </button>

          {/* AI Summary button */}
          <button
            onClick={() => setShowSummary(true)}
            disabled={!selectedRoom}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-all shrink-0 bg-primary/10 border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Generar Resumen con IA"
          >
            ✨
          </button>
        </div>

        {/* Key Moments Timeline */}
        {selectedRoom && (
          <KeyMomentsPanel
            room={selectedRoom}
            onJumpToSubtitle={(index) => {
              const el = document.getElementById(`sub-${index}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add("ring-2", "ring-primary", "transition-all");
                setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
              }
            }}
          />
        )}

        {/* Subtitle Display */}
        <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col min-h-0">
          {/* Connection bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
            <span className="text-xs text-muted-foreground font-mono">
              {subtitles.length} subtítulos
            </span>
          </div>

          <SubtitleDisplay
            subtitles={subtitles}
            lang={lang}
            fontSize={fontSize}
            autoScroll={autoScroll}
            connected={connected}
          />
        </div>
      </main>

      <footer className="border-t border-border px-6 py-3 text-center">
        <p className="text-xs text-muted-foreground">
          Zorvex Live · Subtítulos en vivo
        </p>
      </footer>

      {showSummary && selectedRoom && (
        <SummaryModal room={selectedRoom} onClose={() => setShowSummary(false)} />
      )}
    </div>
  );
}
