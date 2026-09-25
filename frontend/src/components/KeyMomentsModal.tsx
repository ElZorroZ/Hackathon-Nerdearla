import { useState, useEffect } from "react";
import { api } from "../api";
import type { KeyMoment } from "../types";
import { Icon } from "./Icon";

interface KeyMomentsModalProps {
  room: string;
  onClose: () => void;
  onJumpToSubtitle: (index: number) => void;
}

export function KeyMomentsModal({ room, onClose, onJumpToSubtitle }: KeyMomentsModalProps) {
  const [moments, setMoments] = useState<KeyMoment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (room) {
      setLoading(true);
      api.getKeyMoments(room).then((data) => {
        setMoments(data.moments || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [room]);

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

  const handleJump = (index: number) => {
    onJumpToSubtitle(index);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md mx-4 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">Línea de Tiempo</h3>
            {moments.length > 0 && (
              <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {moments.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs text-muted-foreground">Cargando hitos...</p>
            </div>
          ) : moments.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground">
                Los hitos aparecerán automáticamente cada ~300 palabras.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {moments.map((m, i) => (
                <button
                  key={i}
                  onClick={() => handleJump(m.subtitle_index)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/50 transition-colors text-left group"
                >
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16">
                    {m.time_str}
                  </span>
                  <span className="text-xs text-foreground truncate group-hover:text-primary transition-colors flex-1">
                    {m.title}
                  </span>
                  <Icon name="back" className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity rotate-180" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
