import type { SystemMetrics } from "../types";
import { Icon } from "./Icon";

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export function SystemMetricsCard({ sys }: { sys: SystemMetrics }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-[#11111e] border border-gray-800/50 rounded-xl p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <Icon name="clock" className="w-3 h-3" /> Uptime
        </div>
        <p className="text-lg font-bold text-gray-200">
          {formatUptime(sys.uptime_seconds)}
        </p>
      </div>
      <div className="bg-[#11111e] border border-gray-800/50 rounded-xl p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <Icon name="activity" className="w-3 h-3" /> Errores
        </div>
        <p className="text-lg font-bold text-gray-200">{sys.total_errors}</p>
      </div>
      <div className="bg-[#11111e] border border-gray-800/50 rounded-xl p-3">
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
          <Icon name="dashboard" className="w-3 h-3" /> Salas
        </div>
        <p className="text-lg font-bold text-gray-200">{sys.total_rooms}</p>
      </div>
    </div>
  );
}
