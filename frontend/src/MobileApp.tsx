import { useState, useRef } from "react";
import { useResilientWebSocket } from "./hooks/useResilientWebSocket";

interface SubtitlePayload {
  room: string;
  original: string;
  translated: string;
  timestamp: number;
  index: number;
  whisper_ms: number;
  gemma_ms: number;
  type?: string;
}

export function MobileApp() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room") || "sala-1";

  const [subtitles, setSubtitles] = useState<SubtitlePayload[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws/${room}`;

  const { connected, reconnecting } = useResilientWebSocket(wsUrl, {
    onMessage: (data: SubtitlePayload) => {
      if (data.type === "metrics") return;
      setSubtitles((prev) => [...prev, data].slice(-50));
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 50);
    },
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a14",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "#22c55e" : reconnecting ? "#f59e0b" : "#ef4444",
            }}
          />
          <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            {connected ? "EN VIVO" : reconnecting ? "RECONECTANDO..." : "OFFLINE"}
          </span>
        </div>
        <span style={{ fontSize: "0.75rem", color: "#475569" }}>Sala: {room}</span>
      </div>

      {/* Subtitles */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {subtitles.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#475569",
              fontSize: "0.9rem",
            }}
          >
            Esperando subtítulos...
          </div>
        )}
        {subtitles.map((s, i) => (
          <div
            key={s.index || i}
            style={{
              animation: "mobileFadeIn 0.3s ease-out",
              padding: "10px 14px",
              borderRadius: 10,
              background: i === subtitles.length - 1 ? "#1e293b" : "#0f172a",
              borderLeft: i === subtitles.length - 1 ? "3px solid #6366f1" : "3px solid transparent",
            }}
          >
            <p style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>
              {new Date(s.timestamp * 1000).toLocaleTimeString()}
            </p>
            <p style={{ fontSize: "1.1rem", fontWeight: 600, lineHeight: 1.4 }}>
              {s.translated || s.original}
            </p>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes mobileFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
