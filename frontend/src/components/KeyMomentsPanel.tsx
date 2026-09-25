import { useState, useEffect } from "react";
import { api } from "../api";
import type { KeyMoment } from "../types";
import { Icon } from "./Icon";

interface KeyMomentsPanelProps {
  room: string;
  onJumpToSubtitle: (index: number) => void;
}

export function KeyMomentsPanel({ room, onJumpToSubtitle }: KeyMomentsPanelProps) {
  const [moments, setMoments] = useState<KeyMoment[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (room) {
      api.getKeyMoments(room).then((data) => {
        setMoments(data.moments || []);
      });
    }
  }, [room]);

  // Listen for key_moment WS messages
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "key_moment" && detail.room_id === room) {
        setMoments((prev) => [
          ...prev,
          {
            timestamp: detail.timestamp,
            time_str: detail.time_str,
            title: detail.title,
            subtitle_index: detail.subtitle_index,
          },
        ]);
      }
    };
    window.addEventListener("key_moment", handler);
    return () => window.removeEventListener("key_moment", handler);
  }, [room]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">📍</span>
          <span className="text-xs font-semibold text-foreground">Línea de Tiempo</span>
          {moments.length > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
              {moments.length}
            </span>
          )}
        </div>
        <Icon name="back" className={`w-3 h-3 text-muted-foreground transition-transform ${open ? "rotate-90" : "-rotate-90"}`} />
      </button>

      {open && (
        <div className="border-t border-border max-h-48 overflow-y-auto">
          {moments.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                Los hitos aparecerán automáticamente cada ~300 palabras.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {moments.map((m, i) => (
                <button
                  key={i}
                  onClick={() => onJumpToSubtitle(m.subtitle_index)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-secondary/50 transition-colors text-left group"
                >
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {m.time_str}
                  </span>
                  <span className="text-xs text-foreground truncate group-hover:text-primary transition-colors">
                    {m.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
