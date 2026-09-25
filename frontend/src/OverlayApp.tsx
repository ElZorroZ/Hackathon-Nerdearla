import { useEffect, useRef, useState } from "react";

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

  const [lines, setLines] = useState<ActiveLine[]>([]);
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
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const data: SubtitlePayload = JSON.parse(event.data);
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

          setLines((prev) => {
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
  }, [room, showOriginal]);

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
