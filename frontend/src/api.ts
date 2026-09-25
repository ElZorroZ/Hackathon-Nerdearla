import type { RoomsResponse, GlossaryResponse, GlossaryTerm } from "./types";

const API_BASE = "";

export const api = {
  getRooms: async (): Promise<RoomsResponse> => {
    const resp = await fetch(`${API_BASE}/api/rooms`);
    return resp.json();
  },

  exportSubs: async (room: string, fmt: string): Promise<string> => {
    const resp = await fetch(`${API_BASE}/api/rooms/${room}/export?format=${fmt}`);
    return resp.text();
  },

  getSubtitles: async (room: string) => {
    const resp = await fetch(`${API_BASE}/api/rooms/${room}/subtitles`);
    return resp.json();
  },

  getGlossary: async (): Promise<GlossaryResponse> => {
    const resp = await fetch(`${API_BASE}/api/admin/glossary`);
    return resp.json();
  },

  addTerm: async (original: string, translation: string): Promise<unknown> => {
    const resp = await fetch(`${API_BASE}/api/admin/glossary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original, translation }),
    });
    return resp.json();
  },

  updateTerm: async (original: string, translation: string): Promise<unknown> => {
    const resp = await fetch(`${API_BASE}/api/admin/glossary`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original, translation }),
    });
    return resp.json();
  },

  deleteTerm: async (original: string): Promise<unknown> => {
    const resp = await fetch(`${API_BASE}/api/admin/glossary`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original }),
    });
    return resp.json();
  },

  pauseRoom: async (room: string): Promise<unknown> => {
    const resp = await fetch(`${API_BASE}/api/rooms/${room}/pause`, { method: "POST" });
    return resp.json();
  },

  resumeRoom: async (room: string): Promise<unknown> => {
    const resp = await fetch(`${API_BASE}/api/rooms/${room}/resume`, { method: "POST" });
    return resp.json();
  },

  clearRoom: async (room: string): Promise<unknown> => {
    const resp = await fetch(`${API_BASE}/api/rooms/${room}/clear`, { method: "POST" });
    return resp.json();
  },

  getMetrics: async () => {
    const resp = await fetch(`${API_BASE}/api/admin/metrics`);
    return resp.json();
  },

  downloadExport: async (room: string, fmt: string): Promise<void> => {
    const content = await api.exportSubs(room, fmt);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${room}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
