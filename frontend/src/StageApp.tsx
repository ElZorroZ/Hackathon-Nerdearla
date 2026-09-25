import { useState, useRef, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
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

interface ActiveLine {
  text: string;
  original?: string;
  id: number;
}

export function StageApp() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room") || "sala-1";
  const showOriginal = params.get("showOriginal") === "true";

  const [lines, setLines] = useState<ActiveLine[]>([]);
  const lineIdRef = useRef(0);

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws/${room}`;

  const { connected, reconnecting } = useResilientWebSocket(wsUrl, {
    onMessage: (data: SubtitlePayload) => {
      if (data.type === "metrics") return;
      const translated = data.translated || "";
      const original = data.original || "";
      if (!translated && !original) return;

      const id = lineIdRef.current++;
      const newLine: ActiveLine = {
        text: translated,
        original: showOriginal && original && original !== translated ? original : undefined,
        id,
      };

      setLines((prev) => [...prev, newLine].slice(-3));

      setTimeout(() => {
        setLines((prev) => prev.filter((l) => l.id !== id));
      }, 10000);
    },
  });

  // QR code points to main index with the room preselected
  const mobileUrl = `${window.location.origin}/?room=${room}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 5% 6%",
        margin: 0,
        overflow: "hidden",
        fontFamily: "'Inter', 'Roboto', system-ui, sans-serif",
      }}
    >
      {/* Connection indicator */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: "0.9rem",
          color: connected ? "#22c55e" : reconnecting ? "#f59e0b" : "#ef4444",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: connected ? "#22c55e" : reconnecting ? "#f59e0b" : "#ef4444",
            animation: "pulse 2s infinite",
          }}
        />
        {connected ? "EN VIVO" : reconnecting ? "RECONECTANDO..." : "DESCONECTADO"}
      </div>

      {/* QR Code for mobile — big & centered when idle, small corner when subtitles play */}
      <div
        style={
          lines.length === 0
            ? {
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "50vmin",
                height: "50vmin",
                background: "#ffffff",
                padding: 24,
                borderRadius: 24,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                boxShadow: "0 0 100px rgba(255,255,255,0.25)",
              }
            : {
                position: "absolute",
                top: 20,
                right: 20,
                background: "#ffffff",
                padding: 12,
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }
        }
      >
        <QRCodeSVG
          value={mobileUrl}
          level="M"
          style={{ width: "100%", height: "auto", flex: 1, minHeight: 0 }}
        />
        <span
          style={{
            fontSize: lines.length === 0 ? "1.5rem" : "0.7rem",
            color: "#333",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          Escaneá para leer
        </span>
      </div>

      {/* Subtitles */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.3em",
          maxWidth: "90%",
          textAlign: "center",
        }}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              animation: "stageFadeIn 0.4s ease-out",
            }}
          >
            {line.original && (
              <div
                style={{
                  fontSize: "2rem",
                  fontWeight: 500,
                  color: "#aaaaaa",
                  marginBottom: "0.1em",
                  lineHeight: 1.3,
                }}
              >
                {line.original}
              </div>
            )}
            <div
              style={{
                fontSize: "4rem",
                fontWeight: 800,
                color: "#ffffff",
                lineHeight: 1.2,
                textShadow: "0 4px 12px rgba(0,0,0,0.8)",
              }}
            >
              {line.text}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes stageFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        html, body, #root {
          background: #000000 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
