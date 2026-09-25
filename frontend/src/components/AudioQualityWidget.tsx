import type { RoomMetrics } from "../types";

interface AudioQualityWidgetProps {
  room: RoomMetrics | undefined;
}

export function AudioQualityWidget({ room }: AudioQualityWidgetProps) {
  const quality = room?.audio_quality || "good";
  const logprob = room?.avg_logprob ?? 0;
  const noSpeech = room?.no_speech_prob ?? 0;

  const config = {
    good: {
      color: "bg-emerald-400",
      text: "text-emerald-400",
      border: "border-emerald-400/30",
      bg: "bg-emerald-400/10",
      label: "Audio OK",
      icon: "✓",
    },
    warning: {
      color: "bg-yellow-400",
      text: "text-yellow-400",
      border: "border-yellow-400/30",
      bg: "bg-yellow-400/10",
      label: "Ruido detectado",
      icon: "⚠",
    },
    critical: {
      color: "bg-red-400",
      text: "text-red-400",
      border: "border-red-400/30",
      bg: "bg-red-400/10",
      label: "Sin señal",
      icon: "✕",
    },
  };

  const c = config[quality];

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${c.border} ${c.bg}`}>
      {/* Semaphore dots */}
      <div className="flex flex-col gap-1">
        <div className={`w-2 h-2 rounded-full ${quality === "good" ? c.color : "bg-muted-foreground/30"}`} />
        <div className={`w-2 h-2 rounded-full ${quality === "warning" ? c.color : "bg-muted-foreground/30"}`} />
        <div className={`w-2 h-2 rounded-full ${quality === "critical" ? c.color : "bg-muted-foreground/30"}`} />
      </div>

      {/* Status text */}
      <div className="flex flex-col">
        <span className={`text-xs font-semibold ${c.text}`}>
          {c.icon} {c.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          logprob: {logprob.toFixed(2)} · no_speech: {(noSpeech * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
