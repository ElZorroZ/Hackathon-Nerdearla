import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { RoomMetrics, SystemMetrics, MetricsPayload } from "./types";
import { Icon } from "./components/Icon";
import { MetricCard } from "./components/MetricCard";
import { SystemMetricsCard } from "./components/SystemMetricsCard";
import { GlossaryManager } from "./components/GlossaryManager";

export function AdminApp() {
  const [metrics, setMetrics] = useState<{
    rooms: RoomMetrics[];
    system: SystemMetrics;
  }>({ rooms: [], system: { uptime_seconds: 0, total_errors: 0, total_rooms: 0 } });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/admin`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const data: MetricsPayload = JSON.parse(e.data);
      if (data.type === "metrics") {
        setMetrics({ rooms: data.rooms, system: data.system });
      }
    };

    api.getMetrics().then((data) =>
      setMetrics({ rooms: data.rooms, system: data.system })
    );

    return () => ws.close();
  }, []);

  const handlePause = async (room: string) => api.pauseRoom(room);
  const handleResume = async (room: string) => api.resumeRoom(room);
  const handleClear = async (room: string) => api.clearRoom(room);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[#0d0d1a] border-b border-gray-800/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center">
              <Icon name="dashboard" className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">LiveSubs Admin</h1>
              <p className="text-xs text-gray-500">
                Dashboard de producción · Nerdearla
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
              href="/"
              className="flex items-center gap-1 text-gray-400 hover:text-gray-200 transition-colors text-sm"
            >
              <Icon name="back" className="w-4 h-4" />
              Cliente
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 space-y-6">
        <section>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            Sistema
          </h2>
          <SystemMetricsCard sys={metrics.system} />
        </section>

        <section>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            Salas
          </h2>
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

        <section>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            Configuración
          </h2>
          <GlossaryManager />
        </section>
      </main>

      <footer className="bg-[#0d0d1a] border-t border-gray-800/50 px-6 py-3 text-center">
        <p className="text-xs text-gray-600">
          LiveSubs Admin · Whisper + Gemma 2B · 100% local
        </p>
      </footer>
    </div>
  );
}
