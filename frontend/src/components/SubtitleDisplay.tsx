import { useEffect, useRef } from "react";
import type { SubtitleEntry } from "../types";
import { RadioIcon, type RadioIconHandle } from "@/components/ui/radio-icon";
import { WifiOffIcon, type WifiOffIconHandle } from "@/components/ui/wifi-off-icon";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const FONT_CLASS: Record<string, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

const LANG_BADGE: Record<string, string> = {
  es: "ES",
  pt: "PT",
  en: "EN",
};

export function SubtitleDisplay({
  subtitles,
  lang,
  fontSize = "md",
  autoScroll = true,
  connected = true,
}: {
  subtitles: SubtitleEntry[];
  lang: string;
  fontSize?: string;
  autoScroll?: boolean;
  connected?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const radioRef = useRef<RadioIconHandle>(null);
  const wifiOffRef = useRef<WifiOffIconHandle>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [subtitles, autoScroll]);

  useEffect(() => {
    radioRef.current?.startAnimation();
  }, []);

  useEffect(() => {
    if (!connected) {
      wifiOffRef.current?.startAnimation();
    }
  }, [connected]);

  if (!connected && subtitles.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center text-muted-foreground text-sm"
      >
        <div className="text-center">
          <WifiOffIcon
            ref={wifiOffRef}
            size={56}
            className="mx-auto mb-3 text-red-400 opacity-80"
            isAnimated={false}
          />
          <p className="text-red-400">Desconectado</p>
          <p className="text-xs mt-1">Esperando reconexión...</p>
        </div>
      </div>
    );
  }

  if (subtitles.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center text-muted-foreground text-sm"
      >
        <div className="text-center">
          <RadioIcon
            ref={radioRef}
            size={56}
            className="mx-auto mb-3 text-primary opacity-60"
            isAnimated={true}
          />
          <p>Esperando subtítulos...</p>
          <p className="text-xs mt-1">Conectado a la sala</p>
        </div>
      </div>
    );
  }

  const fontClass = FONT_CLASS[fontSize] || FONT_CLASS.md;
  const showOriginal = lang === "original";
  const showTranslated = lang !== "original";
  const langBadge = LANG_BADGE[lang];

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4 space-y-2 sm:space-y-3 scroll-smooth"
    >
      {subtitles.map((s, i) => {
        const isLatest = i === subtitles.length - 1;
        return (
          <div
            key={s.index || i}
            id={`sub-${s.index}`}
            className={`subtitle-enter rounded-lg px-3 py-2 transition-all ${
              isLatest
                ? "bg-secondary/60 border-l-2 border-primary"
                : "border-l-2 border-transparent opacity-60"
            }`}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span className="font-mono">{formatTime(s.timestamp)}</span>
              {s.whisper_ms > 0 && (
                <span className="text-muted-foreground">· {Math.round(s.whisper_ms)}ms</span>
              )}
              {showTranslated && langBadge && isLatest && (
                <span className="ml-auto text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                  {langBadge}
                </span>
              )}
            </div>
            {showOriginal && (
              <p className={`text-muted-foreground leading-relaxed ${fontClass}`}>
                {s.original}
              </p>
            )}
            {showTranslated && (
              <p className={`text-foreground leading-relaxed font-medium ${fontClass}`}>
                {s.translated}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
