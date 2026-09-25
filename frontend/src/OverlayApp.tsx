import { useEffect, useRef, useState } from "react";

interface SubtitlePayload {
  room: string;
  original: string;
  translated: string;
  translations?: Record<string, string>;
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
  index?: number;
}

const FONT_SIZES: Record<string, string> = {
  small: "1.5rem",
  medium: "2.25rem",
  large: "3rem",
  xlarge: "3.75rem",
};

const THEMES: Record<string, { bg: string; text: string; shadow: string }> = {
  dark: { bg: "rgba(0, 0, 0, 0.75)", text: "#ffffff", shadow: "0 2px 8px rgba(0,0,0,0.9)" },
  light: { bg: "rgba(255, 255, 255, 0.85)", text: "#1a1a1a", shadow: "0 1px 4px rgba(0,0,0,0.3)" },
  minimal: { bg: "transparent", text: "#ffffff", shadow: "0 2px 6px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)" },
};

export function OverlayApp() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room") || "sala-1";
  const lang = params.get("lang") || "es";
  const theme = params.get("theme") || "dark";
  const chroma = params.get("chroma");
  const fontSize = params.get("fontSize") || "medium";
  const align = params.get("align") || "center";
  const showOriginal = params.get("showOriginal") === "true";
  // Show a small connection status indicator by default so the page isn't
  // perceived as blank/broken. Pass ?status=false to hide it for OBS production.
  const showStatus = params.get("status") !== "false";

  const [lines, setLines] = useState<ActiveLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number>(0);
  const lineIdRef = useRef(0);

  const themeStyle = THEMES[theme] || THEMES.dark;
  const fontRem = FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const pageBg = chroma ? chroma : "transparent";

  useEffect(() => {
    let mounted = true;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws/${room}`;
      const ws = new WebSocket(wsUrl, ["ngrok-skip-browser-warning"]);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current = 0;
        setConnected(true);
        setReconnecting(false);
        // Pedir al backend la traducción al idioma del query param (?lang=pt)
        if (lang && lang !== "original") {
          try {
            ws.send(JSON.stringify({ type: "lang", lang }));
          } catch {
            // ignore
          }
        }
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const data: SubtitlePayload = JSON.parse(event.data);
          if (data.type === "metrics") return;

          // Filter: only display subtitles for THIS room
          if (data.room && data.room !== room) return;

          // Preferir la traducción al idioma pedido por query param
          const translated = data.translations?.[lang] || data.translated || "";
          const original = data.original || "";
          if (!translated && !original) return;

          const id = lineIdRef.current++;
          const newLine: ActiveLine = {
            text: translated,
            original: showOriginal && original && original !== translated ? original : undefined,
            id,
            index: data.index,
          };

          setLines((prev) => {
            // Si llega un update con el mismo index (traducción background),
            // reemplazar la línea en vez de duplicarla
            if (data.index !== undefined) {
              const existing = prev.findIndex((l) => l.index === data.index);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = newLine;
                return next;
              }
            }
            const next = [...prev, newLine];
            // Keep max 2 lines
            return next.slice(-2);
          });

          // Auto-clear after 8 seconds
          setTimeout(() => {
            if (!mounted) return;
            setLines((prev) => prev.filter((l) => l.id !== id));
          }, 8000);
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setConnected(false);
        setReconnecting(true);
        const delay = Math.min(1000 * Math.pow(1.5, reconnectRef.current), 10000);
        reconnectRef.current++;
        setTimeout(() => {
          if (mounted) connect();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [room, lang, showOriginal]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: pageBg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: align === "left" ? "flex-start" : "center",
        padding: "0 5% 8%",
        margin: 0,
        overflow: "hidden",
        fontFamily: "'Inter', 'Roboto', system-ui, sans-serif",
      }}
    >
      {/* Connection status indicator — hidden when ?status=false for OBS production */}
      {showStatus && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.85rem",
            fontWeight: 600,
            color: connected ? "#22c55e" : reconnecting ? "#f59e0b" : "#ef4444",
            background: "rgba(0, 0, 0, 0.55)",
            padding: "4px 10px",
            borderRadius: 8,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "#22c55e" : reconnecting ? "#f59e0b" : "#ef4444",
              animation: "overlayPulse 2s infinite",
            }}
          />
          {connected ? "EN VIVO" : reconnecting ? "RECONECTANDO..." : "DESCONECTADO"}
          <span style={{ opacity: 0.6, fontWeight: 400 }}>· {room}</span>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.35em",
          maxWidth: "90%",
          textAlign: align as "left" | "center",
        }}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              animation: "overlayFadeIn 0.3s ease-out",
            }}
          >
            {line.original && (
              <div
                style={{
                  fontSize: `calc(${fontRem} * 0.7)`,
                  fontWeight: 500,
                  color: themeStyle.text,
                  background: themeStyle.bg,
                  padding: "0.15em 0.6em",
                  borderRadius: "0.3em",
                  display: "inline-block",
                  marginBottom: "0.15em",
                  textShadow: themeStyle.shadow,
                  lineHeight: 1.3,
                  opacity: 0.85,
                }}
              >
                {line.original}
              </div>
            )}
            <div
              style={{
                fontSize: fontRem,
                fontWeight: 700,
                color: themeStyle.text,
                background: themeStyle.bg,
                padding: "0.2em 0.7em",
                borderRadius: "0.35em",
                display: "inline-block",
                textShadow: themeStyle.shadow,
                lineHeight: 1.25,
              }}
            >
              {line.text}
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes overlayFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes overlayPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        html, body, #root {
          background: transparent !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
