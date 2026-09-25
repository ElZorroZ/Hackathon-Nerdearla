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
        className="flex items-center gap-2 bg-secondary hover:bg-accent border border-border px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground transition-all text-sm"
      >
        <Icon name="download" className="w-3.5 h-3.5" />
        <span className="hidden md:inline">Exportar</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[120px]">
          {["srt", "vtt", "txt"].map((fmt) => (
            <button
              key={fmt}
              onClick={() => handleDownload(fmt)}
              className="block w-full text-left px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground uppercase first:rounded-t-lg last:rounded-b-lg"
            >
              .{fmt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
