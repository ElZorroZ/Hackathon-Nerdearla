export interface SubtitleEntry {
  room: string;
  original: string;
  translated: string;
  timestamp: number;
  index: number;
  whisper_ms: number;
  gemma_ms: number;
  type?: string;
}

export interface RoomMetrics {
  room_id: string;
  status: "active" | "paused" | "error";
  listeners: number;
  total_subtitles: number;
  avg_whisper_ms: number;
  avg_gemma_ms: number;
  last_whisper_ms: number;
  last_gemma_ms: number;
  last_error: string | null;
  audio_quality: "good" | "warning" | "critical";
  avg_logprob: number;
  no_speech_prob: number;
}

export interface SystemMetrics {
  uptime_seconds: number;
  total_errors: number;
  total_rooms: number;
}

export interface MetricsPayload {
  type: "metrics";
  rooms: RoomMetrics[];
  system: SystemMetrics;
}

export interface RoomInfo {
  id: string;
  name: string;
  lang: string;
}

export interface RoomsResponse {
  rooms: RoomInfo[];
}

export interface GlossaryResponse {
  terms: Record<string, string>;
}

export interface GlossaryTerm {
  original: string;
  translation: string;
}

export interface KeyMoment {
  timestamp: number;
  time_str: string;
  title: string;
  subtitle_index: number;
}

export interface SummaryResponse {
  room: string;
  summary: string;
}

export interface KeyMomentsResponse {
  room: string;
  moments: KeyMoment[];
}

export interface ReactionEvent {
  type: "reaction";
  emoji: string;
  room: string;
  timestamp: number;
}
