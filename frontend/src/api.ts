import type { RoomsResponse, GlossaryResponse, GlossaryTerm } from "./types";

const API_BASE = "";

// ngrok free tier: skip browser warning page
const ngrokHeaders: Record<string, string> = {
  "ngrok-skip-browser-warning": "1",
};

function fetchWithNgrok(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...ngrokHeaders, ...(init?.headers || {}) };
  return fetch(`${API_BASE}${url}`, { ...init, headers });
}

export const api = {
  getRooms: async (): Promise<RoomsResponse> => {
    const resp = await fetchWithNgrok("/api/rooms");
    return resp.json();
  },

  createRoom: async (name: string, lang: string): Promise<unknown> => {
    const resp = await fetchWithNgrok("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lang }),
    });
    return resp.json();
  },

  deleteRoom: async (roomId: string): Promise<unknown> => {
    const resp = await fetchWithNgrok(`/api/rooms/${roomId}`, { method: "DELETE" });
    return resp.json();
  },

  exportSubs: async (room: string, fmt: string): Promise<string> => {
    const resp = await fetchWithNgrok(`/api/rooms/${room}/export?format=${fmt}`);
    return resp.text();
  },

  getSubtitles: async (room: string) => {
    const resp = await fetchWithNgrok(`/api/rooms/${room}/subtitles`);
    return resp.json();
  },

  getGlossary: async (): Promise<GlossaryResponse> => {
    const resp = await fetchWithNgrok("/api/admin/glossary");
    return resp.json();
  },

  addTerm: async (original: string, translation: string): Promise<unknown> => {
    const resp = await fetchWithNgrok("/api/admin/glossary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original, translation }),
    });
    return resp.json();
  },

  updateTerm: async (original: string, translation: string): Promise<unknown> => {
    const resp = await fetchWithNgrok("/api/admin/glossary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original, translation }),
    });
    return resp.json();
  },

  deleteTerm: async (original: string): Promise<unknown> => {
    const resp = await fetchWithNgrok("/api/admin/glossary", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original }),
    });
    return resp.json();
  },

  pauseRoom: async (room: string): Promise<unknown> => {
    const resp = await fetchWithNgrok(`/api/rooms/${room}/pause`, { method: "POST" });
    return resp.json();
  },

  resumeRoom: async (room: string): Promise<unknown> => {
    const resp = await fetchWithNgrok(`/api/rooms/${room}/resume`, { method: "POST" });
    return resp.json();
  },

  clearRoom: async (room: string): Promise<unknown> => {
    const resp = await fetchWithNgrok(`/api/rooms/${room}/clear`, { method: "POST" });
    return resp.json();
  },

  setRoomLang: async (room: string, lang: string): Promise<unknown> => {
    const resp = await fetchWithNgrok(`/api/rooms/${room}/language?lang=${lang}`, { method: "PUT" });
    return resp.json();
  },

  getMetrics: async () => {
    const resp = await fetchWithNgrok("/api/admin/metrics");
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
