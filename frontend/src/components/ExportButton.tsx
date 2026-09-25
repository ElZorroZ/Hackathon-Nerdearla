import { useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

export function ExportButton({ room }: { room: string }) {
  const [open, setOpen] = useState(false);

  const handleDownload = async (fmt: string) => {
    await api.downloadExport(room, fmt);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-[#1a1a2e] hover:bg-[#252540] px-3 py-2 rounded-lg text-gray-300 transition-all"
      >
        <Icon name="download" className="w-4 h-4" />
        <span className="text-sm">Exportar</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl z-50 min-w-[120px]">
          {["srt", "vtt", "txt"].map((fmt) => (
            <button
              key={fmt}
              onClick={() => handleDownload(fmt)}
              className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-indigo-600/20 uppercase first:rounded-t-lg last:rounded-b-lg"
            >
              .{fmt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
