import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api";
import type { SubtitleEntry, RoomInfo } from "./types";
import { Icon } from "./components/Icon";
import { SubtitleDisplay } from "./components/SubtitleDisplay";
import { PauseIcon, type PauseIconHandle } from "@/components/ui/pause-icon";
import { PlayIcon, type PlayIconHandle } from "@/components/ui/play-icon";
import { WifiSyncIcon, type WifiSyncIconHandle } from "@/components/ui/wifi-sync-icon";
import { ReactionsBar } from "./components/ReactionsBar";
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
    if (data.type === "reaction") return; // handled by ReactionsBar
    if (data.type === "key_moment") {
      window.dispatchEvent(new CustomEvent("key_moment", { detail: data }));
      return;
    }
    setSubtitles((prev: SubtitleEntry[]) => {
      // Dedupe by index: cached (localStorage) entries can overlap with live feed,
      // and index counters reset on backend restart — replace stale same-index entry
      const filtered = data.index ? prev.filter((s) => s.index !== data.index) : prev;
      const next = [...filtered, data].slice(-200);
      // Persist to localStorage for offline resilience
      try {
        localStorage.setItem(`subs_${data.room || selectedRoom}`, JSON.stringify(next));
      } catch {
        // localStorage may be full, ignore
      }
      return next;
    });
  }, [selectedRoom]);

  const { connected, reconnecting, flush, ws } = useResilientWebSocket(wsUrl, {
    onMessage: handleWsMessage,
  });

  // Notify backend of the selected target language so it translates accordingly.
  // Retry until the socket is OPEN (handles reconnects where ws.current swaps).
  useEffect(() => {
    if (!selectedRoom) return;
    let attempts = 0;
    let timer: number | undefined;
    const send = () => {
      const socket = ws.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "lang", lang }));
        return;
      }
      if (attempts++ < 40) timer = window.setTimeout(send, 250);
    };
    send();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [lang, selectedRoom, connected, ws]);

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
      const urlRoom = new URLSearchParams(window.location.search).get("room");
      if (urlRoom && data.rooms.some((r) => r.id === urlRoom)) {
        setSelectedRoom(urlRoom);
      } else if (data.rooms.length > 0) {
        setSelectedRoom(data.rooms[0].id);
      }
    });
  }, []);

  const roomCount = rooms.length;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* Header with room tabs + pause + OBS overlay */}
      <header className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src="/zorvex-logo.svg" alt="Zorvex Live" className="w-8 h-8 sm:w-10 sm:h-10 shrink-0" />
              <div>
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">Zorvex Live</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  {connected && selectedRoom ? (
                    <span className="flex items-center gap-1.5 text-xs text-[#38A169] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#38A169] pulse-dot" />
                      EN VIVO
                    </span>
                  ) : reconnecting ? (
                    <span className="flex items-center gap-1.5 text-xs text-yellow-400 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 pulse-dot" />
                      Reconectando...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      OFFLINE
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">· {roomCount} Salas</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Connection status */}
              <div className="flex items-center gap-2 text-xs bg-secondary border border-border px-2 py-1.5 sm:px-3 rounded-lg">
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
                className="flex items-center gap-2 bg-secondary hover:bg-accent border border-border px-2 py-2 sm:px-3 rounded-lg text-muted-foreground hover:text-foreground transition-all text-sm"
              >
                <Icon name="settings" className="w-4 h-4" />
                <span className="hidden sm:inline">Panel de Producción</span>
              </a>
            </div>
          </div>

        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-3 py-3 sm:px-6 sm:py-5 flex flex-col gap-3 sm:gap-4 min-h-0 overflow-hidden">
        {/* Toolbar: Combobox room search + lang select + font size select + export */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Room search with @beui/combobox */}
          <div className="w-full sm:w-56">
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
          <div className="w-24 sm:w-32">
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger>
                <SelectValue placeholder="Idioma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Idioma Original</SelectItem>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="pt">Português</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font size select with @beui/select */}
          <div className="w-24 sm:w-32">
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

        </div>

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

      <footer className="border-t border-border px-4 py-2 sm:px-6 sm:py-3 text-center">
      </footer>

      {selectedRoom && (
        <ReactionsBar room={selectedRoom} ws={ws.current} />
      )}
    </div>
  );
}
