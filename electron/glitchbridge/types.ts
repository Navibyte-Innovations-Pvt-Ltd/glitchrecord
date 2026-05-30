export interface ClipRange { startMs: number; endMs: number }

export interface RecordingMeta {
  originalDurationMs: number;
  finalDurationMs: number;
  keptRanges: ClipRange[];
  cutRanges: ClipRange[];
  exportStartedAt: number;
}

export interface Session {
  id: string;
  userId: string;
  repoId: string;
  repoName: string;
  events: CaptureEvent[];
  meta: RecordingMeta | null;
  script: string | null;
  issueUrl: string | null;
  createdAt: number;
}

export interface CaptureEvent {
  type: "click" | "navigate" | "idle";
  t: number;
  label?: string;
  tag?: string;
  url?: string;
  durationMs?: number;
}

export type WsMsg =
  | { type: "auth"; token: string }
  | { type: "auth:ok"; userId: string; name: string }
  | { type: "auth:fail"; reason: string }
  | { type: "repos"; repos: GlitchRepo[] }
  | { type: "recording:start"; sessionId: string; repoId: string; repoName: string }
  | { type: "recording:stop"; sessionId: string; meta: RecordingMeta }
  | { type: "events:upload"; sessionId: string; events: CaptureEvent[] }
  | { type: "script:ready"; sessionId: string; script: string }
  | { type: "issue:created"; sessionId: string; issueUrl: string; issueNumber: number }
  | { type: "error"; message: string };

export interface GlitchUser { id: string; name: string; email: string; image?: string }
export interface GlitchRepo { id: string; name: string; fullName: string }
