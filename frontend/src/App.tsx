import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { SubtitleEntry } from "./types";
import { Icon } from "./components/Icon";
import { RoomSelector } from "./components/RoomSelector";
import { LangSelector } from "./components/LangSelector";
import { ExportButton } from "./components/ExportButton";
import { SubtitleDisplay } from "./components/SubtitleDisplay";

export function App() {
  const [rooms, setRooms] = useState<string[]>([]);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [lang, setLang] = useState("es");
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    api.getRooms().then((data) => {
      setRooms(data.rooms || []);
      if (data.rooms.length > 0) setSelectedRoom(data.rooms[0]);
    });
  }, []);

  useEffect(() => {
    if (!selectedRoom) return;
    setSubtitles([]);

    const ws = new WebSocket(`ws://${window.location.host}/ws/${selectedRoom}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setSubtitles((prev) => [...prev, data].slice(-200));
    };

    return () => ws.close();
  }, [selectedRoom]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[#0d0d1a] border-b border-gray-800/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center">
              <Icon name="mic" className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">LiveSubs</h1>
              <p className="text-xs text-gray-500">
                Subtítulos en vivo · Nerdearla
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div
              className={`flex items-center gap-2 text-xs ${
                connected ? "text-green-400" : "text-gray-500"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-green-400 pulse-dot" : "bg-gray-600"
                }`}
              />
              {connected ? "Conectado" : "Desconectado"}
            </div>
            <a
              href="/admin"
              className="flex items-center gap-1 text-gray-400 hover:text-gray-200 transition-colors text-sm"
            >
              <Icon name="settings" className="w-4 h-4" />
              Admin
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <RoomSelector
            rooms={rooms}
            selected={selectedRoom}
            onSelect={setSelectedRoom}
          />
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Icon name="globe" className="w-4 h-4 text-gray-500" />
              <LangSelector value={lang} onChange={setLang} />
            </div>
            <ExportButton room={selectedRoom} />
          </div>
        </div>

        <div className="flex-1 bg-[#0d0d1a] border border-gray-800/50 rounded-xl overflow-hidden flex flex-col min-h-[400px]">
          <SubtitleDisplay subtitles={subtitles} lang={lang} />
        </div>
      </main>

      <footer className="bg-[#0d0d1a] border-t border-gray-800/50 px-6 py-3 text-center">
        <p className="text-xs text-gray-600">
          LiveSubs · Whisper + Gemma 2B · 100% local
        </p>
      </footer>
    </div>
  );
}
