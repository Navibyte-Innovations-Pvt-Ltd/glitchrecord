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
  finalized?: boolean; // true once upload/script/issue ran — prevents duplicates
  uploadedClients?: Set<string>; // clientIds that already uploaded — dedups double-stop, merges distinct profiles
  mergeTimer?: ReturnType<typeof setTimeout>; // open merge window: late uploads from other profiles merge before processing
  liveByClient?: Map<string, CaptureEvent[]>; // events streamed live per profile — survives SW death + missed stop on idle secondary profiles
  /** Set when the Chrome extension has a tester logged in (#297) — routes the
   *  eventual "Create Issue" through the tester's own gg_ token so the Report
   *  is tagged source=EXTENSION_TESTER instead of the GlitchRecord account's. */
  tester?: TesterIdentity;
}

export interface TesterIdentity {
  token: string;
  name: string;
  email?: string;
  sessionId: string;
}

export interface CaptureEvent {
  type: "click" | "navigate" | "idle" | "input" | "select" | "keydown" | "scroll" | "copy" | "paste" | "note" | "mutate";
  t: number;
  label?: string;
  tag?: string;
  url?: string;
  durationMs?: number;
  preview?: string;
  meta?: Record<string, string | number | boolean>;
  note?: string;
  client?: string; // which Chrome profile produced this event (multi-profile capture)
}

export type WsMsg =
  | { type: "auth"; token: string }
  | { type: "auth:ok"; userId: string; name: string }
  | { type: "auth:fail"; reason: string }
  | { type: "repos"; repos: GlitchRepo[] }
  | { type: "recording:start"; sessionId: string; repoId: string; repoName: string; startedAt: number }
  | { type: "recording:stop"; sessionId: string; meta: RecordingMeta }
  | { type: "events:upload"; sessionId: string; events: CaptureEvent[]; clientId?: string }
  | { type: "tester:identity"; token: string; name: string; email?: string; sessionId: string }
  | { type: "tester:logout" }
  | { type: "event:live"; event: CaptureEvent }
  | { type: "script:ready"; sessionId: string; script: string }
  | { type: "issue:created"; sessionId: string; issueUrl: string; issueNumber: number }
  | { type: "log"; text: string }
  | { type: "error"; message: string };

export interface GlitchUser { id: string; name: string; email: string; image?: string }
export interface GlitchRepo { id: string; name: string; fullName: string }
