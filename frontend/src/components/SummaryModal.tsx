import { useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

interface SummaryModalProps {
  room: string;
  onClose: () => void;
}

export function SummaryModal({ room, onClose }: SummaryModalProps) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await api.getSummary(room);
      setSummary(resp.summary);
    } catch (e: any) {
      const err = await e?.response?.json?.();
      setError(err?.detail || "Error generando resumen");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
  };

  const handleDownload = () => {
    const blob = new Blob([summary], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${room}-resumen.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <h3 className="text-sm font-bold text-white">Resumen Ejecutivo con IA</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!summary && !loading && !error && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-4">
                Genera un resumen ejecutivo de la charla usando IA (Gemma 2B).
                Incluye 3 puntos clave y 5 palabras clave.
              </p>
              <button
                onClick={handleGenerate}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                ✨ Generar Resumen
              </button>
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm text-muted-foreground">Generando resumen...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-sm text-red-400 mb-3">{error}</p>
              <button
                onClick={handleGenerate}
                className="px-4 py-2 bg-secondary border border-border rounded-lg text-sm hover:bg-accent transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}

          {summary && (
            <>
              <div className="bg-secondary/50 rounded-lg p-4 max-h-72 overflow-y-auto">
                <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                  {summary}
                </pre>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  📋 Copiar
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  💾 Descargar
                </button>
                <button
                  onClick={handleGenerate}
                  className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  🔄 Regenerar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
