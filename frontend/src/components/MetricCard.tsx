import type { RoomMetrics } from "../types";
import { api } from "../api";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";

export function MetricCard({
  room,
  onPause,
  onResume,
  onClear,
}: {
  room: RoomMetrics;
  onPause: (room: string) => void;
  onResume: (room: string) => void;
  onClear: (room: string) => void;
}) {
  return (
    <div className="bg-[#11111e] border border-gray-800/50 rounded-xl p-4 fade-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200 capitalize">
          {room.room_id.replace("-", " ")}
        </h3>
        <StatusBadge status={room.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-[#0a0a14] rounded-lg p-2">
          <p className="text-xs text-gray-500 mb-1">Whisper</p>
          <p className="text-lg font-bold text-indigo-400">
            {room.last_whisper_ms}
            <span className="text-xs text-gray-600">ms</span>
          </p>
          <p className="text-xs text-gray-600">avg {room.avg_whisper_ms}ms</p>
        </div>
        <div className="bg-[#0a0a14] rounded-lg p-2">
          <p className="text-xs text-gray-500 mb-1">Gemma</p>
          <p className="text-lg font-bold text-purple-400">
            {room.last_gemma_ms}
            <span className="text-xs text-gray-600">ms</span>
          </p>
          <p className="text-xs text-gray-600">avg {room.avg_gemma_ms}ms</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span className="flex items-center gap-1">
          <Icon name="users" className="w-3 h-3" /> {room.listeners}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="activity" className="w-3 h-3" /> {room.total_subtitles} subs
        </span>
      </div>
      <div className="flex gap-2">
        {room.status === "active" ? (
          <button
            onClick={() => onPause(room.room_id)}
            className="flex-1 flex items-center justify-center gap-1 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-xs py-1.5 rounded-lg transition-all"
          >
            <Icon name="pause" className="w-3 h-3" /> Pausar
          </button>
        ) : (
          <button
            onClick={() => onResume(room.room_id)}
            className="flex-1 flex items-center justify-center gap-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs py-1.5 rounded-lg transition-all"
          >
            <Icon name="play" className="w-3 h-3" /> Reanudar
          </button>
        )}
        <button
          onClick={() => onClear(room.room_id)}
          className="flex-1 flex items-center justify-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs py-1.5 rounded-lg transition-all"
        >
          <Icon name="trash" className="w-3 h-3" /> Limpiar
        </button>
      </div>
      {room.last_error && (
        <p className="text-xs text-red-400/70 mt-2 truncate">
          ⚠ {room.last_error}
        </p>
      )}
    </div>
  );
}
