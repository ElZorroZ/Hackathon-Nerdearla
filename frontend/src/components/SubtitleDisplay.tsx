import { useEffect, useRef } from "react";
import type { SubtitleEntry } from "../types";
import { Icon } from "./Icon";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SubtitleDisplay({
  subtitles,
  lang,
}: {
  subtitles: SubtitleEntry[];
  lang: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [subtitles]);

  if (subtitles.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center text-gray-600 text-sm"
      >
        <div className="text-center">
          <Icon name="radio" className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Esperando subtítulos...</p>
          <p className="text-xs mt-1">Conectado a la sala</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
    >
      {subtitles.map((s, i) => {
        const showOriginal = lang === "original" || lang === "en";
        const showTranslated = lang !== "original" && s.translated;
        const isLatest = i === subtitles.length - 1;
        return (
          <div
            key={s.index || i}
            className={`subtitle-enter ${
              isLatest ? "border-l-2 border-indigo-500 pl-3" : "pl-4"
            }`}
          >
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <span className="font-mono">{formatTime(s.timestamp)}</span>
              {s.whisper_ms && (
                <span className="text-gray-600">· {s.whisper_ms}ms</span>
              )}
            </div>
            {showOriginal && (
              <p className="text-gray-400 text-sm leading-relaxed">
                {s.original}
              </p>
            )}
            {showTranslated && (
              <p className="text-gray-100 text-base leading-relaxed font-medium">
                {s.translated}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
