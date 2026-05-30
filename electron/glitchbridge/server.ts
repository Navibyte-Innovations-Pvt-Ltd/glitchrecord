// WebSocket server running inside GlitchRecord Electron main process.
// Chrome extension connects here for real-time recording sync.
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { WebSocketServer, WebSocket } from "ws";
import type { Session, WsMsg, RecordingMeta, CaptureEvent } from "./types";
import { validateToken, getRepos, createIssue, generateScript, uploadSession } from "./api";
import { loadAuth } from "./auth";

function getSessionCachePath() {
  return path.join(app.getPath("userData"), "glitchgrab-last-session.json");
}

// ── Unified debug log ─────────────────────────────────────────
// Both the Chrome extension (via WS "log" messages) and GlitchRecord itself
// append here, so the whole capture pipeline is inspectable in one file:
//   <userData>/glitchgrab-debug.log
// Dev userData is ~/Library/Application Support/Recordly-dev on macOS.
function getDebugLogPath() {
  return path.join(app.getPath("userData"), "glitchgrab-debug.log");
}

let debugLogResetDone = false;
export function appendDebugLog(source: "ext" | "rec", text: string) {
  try {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${source}] ${text}\n`;
    const file = getDebugLogPath();
    // Truncate once per app launch so the file doesn't grow forever.
    if (!debugLogResetDone) {
      fs.writeFileSync(file, `=== GlitchGrab debug log — session opened ${ts} ===\n`, "utf8");
      debugLogResetDone = true;
    }
    fs.appendFileSync(file, line, "utf8");
  } catch { /* logging must never throw */ }
}

function persistSession(session: Session) {
  try {
    fs.writeFileSync(
      getSessionCachePath(),
      JSON.stringify({ events: session.events, sessionId: session.id }),
      "utf8",
    );
  } catch { /* non-critical */ }
}

export function loadPersistedSession(): { events: CaptureEvent[]; sessionId: string | null } {
  try {
    const raw = fs.readFileSync(getSessionCachePath(), "utf8");
    const data = JSON.parse(raw) as { events?: CaptureEvent[]; sessionId?: string };
    return { events: Array.isArray(data.events) ? data.events : [], sessionId: data.sessionId ?? null };
  } catch {
    return { events: [], sessionId: null };
  }
}

const PORT = 7337;

const sessions = new Map<string, Session>();
const chromeClients = new Set<WebSocket>();

let wss: WebSocketServer | null = null;
let currentUser: { id: string; name: string; token: string } | null = null;
let currentSession: Session | null = null;
let recordingActive = false; // true between recording start and stop

// Load token from disk (set during GlitchRecord login) so the bridge is
// authenticated without needing a WS auth handshake.
export function refreshCurrentUserFromStorage() {
  const auth = loadAuth();
  if (auth) {
    currentUser = { id: auth.userId, name: auth.name, token: auth.token };
  } else {
    currentUser = null;
  }
}

function send(ws: WebSocket, msg: WsMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastChrome(msg: WsMsg) {
  const payload = JSON.stringify(msg);
  for (const ws of chromeClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

let liveEventCb: ((event: CaptureEvent) => void) | null = null;
let eventsReadyCb: ((sessionId: string, count: number) => void) | null = null;

export function startBridgeServer(callbacks: {
  onScriptReady: (sessionId: string, script: string) => void;
  onIssueCreated: (sessionId: string, issueUrl: string) => void;
  onLiveEvent?: (event: CaptureEvent) => void;
  onEventsReady?: (sessionId: string, count: number) => void;
}) {
  liveEventCb = callbacks.onLiveEvent ?? null;
  eventsReadyCb = callbacks.onEventsReady ?? null;
  if (wss) return;

  refreshCurrentUserFromStorage(); // pick up stored login token

  wss = new WebSocketServer({ port: PORT });
  console.log(`[GlitchBridge] WS server on ws://localhost:${PORT}`);

  // EADDRINUSE = stale instance from a previous dev reload still holds the port.
  // Retry binding a few times before giving up.
  let retries = 0;
  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && retries < 5) {
      retries++;
      console.warn(`[GlitchBridge] Port ${PORT} busy, retry ${retries}/5 in 1s...`);
      wss = null;
      setTimeout(() => startBridgeServer(callbacks), 1000);
      return;
    }
    console.error("[GlitchBridge] Error:", err);
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const role = url.searchParams.get("role") ?? "unknown";
    console.log(`[GlitchBridge] Connected: ${role}`);
    appendDebugLog("rec", `WS client connected: ${role}`);

    if (role === "chrome") {
      chromeClients.add(ws);
      // Start-before-connect resync: if a recording is already active when the
      // extension (re)connects, replay recording:start so it begins capturing.
      if (currentSession && recordingActive) {
        send(ws, {
          type: "recording:start",
          sessionId: currentSession.id,
          repoId: currentSession.repoId,
          repoName: currentSession.repoName,
        });
        appendDebugLog("rec", `Resynced recording:start to reconnected chrome (${currentSession.id})`);
      }
    }

    ws.on("message", async (raw) => {
      let msg: WsMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Debug log line forwarded from the Chrome extension
      if (msg.type === "log") {
        appendDebugLog("ext", msg.text);
        return;
      }

      // Live event stream from Chrome ext → forward to renderer feed
      if (msg.type === "event:live") {
        liveEventCb?.(msg.event);
        return;
      }

      // Auth
      if (msg.type === "auth") {
        const user = await validateToken(msg.token);
        if (!user) { send(ws, { type: "auth:fail", reason: "Invalid token" }); return; }
        currentUser = { ...user, token: msg.token };
        send(ws, { type: "auth:ok", userId: user.id, name: user.name });
        // Send repos immediately
        const repos = await getRepos(msg.token);
        send(ws, { type: "repos", repos });
        return;
      }

      // Chrome ext uploads events — always accept, auth only needed for issue creation
      if (msg.type === "events:upload") {
        // Fall back to the current session if the id doesn't match (bridge restart,
        // HTTP-signal start, etc.) so events are never silently dropped.
        let session = sessions.get(msg.sessionId);
        if (!session && currentSession) {
          appendDebugLog("rec", `events:upload unknown id ${msg.sessionId} → using current session ${currentSession.id}`);
          session = currentSession;
        }
        if (!session) {
          appendDebugLog("rec", `events:upload DROPPED — no session for ${msg.sessionId}`);
          send(ws, { type: "error", message: "Unknown session — events dropped" });
          return;
        }
        session.events.push(...(msg.events as CaptureEvent[]));
        persistSession(session);
        eventsReadyCb?.(session.id, session.events.length);
        appendDebugLog("rec", `events:upload received ${msg.events.length} (total ${session.events.length}) for ${session.id}`);

        // Idempotency: a session is finalized once. Double-stop (HUD + universal
        // hook both fire recording:stop) must not re-run upload/script/issue,
        // which would create duplicate GitHub issues.
        if (session.finalized) {
          appendDebugLog("rec", `events:upload ignored — session ${session.id} already finalized`);
          return;
        }
        session.finalized = true;

        // Skip DB upload + issue creation when not logged in
        if (!currentUser) {
          console.log(`[GlitchBridge] ${session.events.length} events saved locally (not logged in)`);
          appendDebugLog("rec", `${session.events.length} events saved locally (not logged in)`);
          return;
        }

        // 1. Persist events to a DB capture session (in-memory bridge id ≠ DB id)
        const dbSessionId = await uploadSession({
          events: session.events,
          meta: session.meta,
        });
        if (!dbSessionId) {
          broadcastChrome({ type: "error", message: "Failed to save capture session" });
          return;
        }

        // 2. Generate script from the DB session
        const script = await generateScript({
          token: currentUser.token,
          sessionId: dbSessionId,
        });
        if (script) {
          session.script = script;
          broadcastChrome({ type: "script:ready", sessionId: msg.sessionId, script });
          callbacks.onScriptReady(msg.sessionId, script);

          // 3. Create GitHub issue in the selected repo (skip if no repo selected)
          if (session.repoId) {
            const issue = await createIssue({
              token: currentUser.token,
              repoId: session.repoId,
              title: `[GlitchRecord] ${session.repoName} — ${new Date().toLocaleDateString()}`,
              body: buildIssueBody(session),
            });
            if (issue) {
              session.issueUrl = issue.url;
              broadcastChrome({ type: "issue:created", sessionId: msg.sessionId, issueUrl: issue.url, issueNumber: issue.number });
              callbacks.onIssueCreated(msg.sessionId, issue.url);
            }
          }
        }
      }
    });

    ws.on("close", () => {
      chromeClients.delete(ws);
      console.log(`[GlitchBridge] Disconnected: ${role}`);
    });
  });
}

export function stopBridgeServer() {
  wss?.close();
  wss = null;
}

// Called from Electron renderer via IPC when user presses Record
export function broadcastRecordingStart(repoId: string, repoName: string): string {
  const sessionId = crypto.randomUUID();
  const session: Session = {
    id: sessionId,
    userId: currentUser?.id ?? "",
    repoId, repoName,
    events: [], meta: null, script: null, issueUrl: null,
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  currentSession = session;
  recordingActive = true;
  broadcastChrome({ type: "recording:start", sessionId, repoId, repoName });
  console.log(`[GlitchBridge] Recording started: ${sessionId} → ${repoName}`);
  appendDebugLog("rec", `Recording started: ${sessionId} → ${repoName} (chromeClients=${chromeClients.size})`);
  return sessionId;
}

// Called when user presses Stop + edit cuts are collected.
// Idempotent: the second of a double-stop (HUD + universal hook) is a no-op.
export function broadcastRecordingStop(sessionId: string, meta: RecordingMeta) {
  if (!recordingActive) return;
  recordingActive = false;
  const session = sessions.get(sessionId) ?? currentSession ?? undefined;
  // Only set meta if it has real content — empty {} would overwrite good cut data.
  if (session && meta && Array.isArray((meta as RecordingMeta).cutRanges)) {
    session.meta = meta;
  }
  broadcastChrome({ type: "recording:stop", sessionId, meta });
  console.log(`[GlitchBridge] Recording stopped: ${sessionId}`);
  appendDebugLog("rec", `Recording stopped: ${sessionId} (events=${session?.events.length ?? 0})`);
}

export function getCurrentUser() { return currentUser; }
export function getCurrentSession() { return currentSession; }

// ── IPC-callable helpers (used by main process handlers) ─────
export function getAuthStatus() {
  const auth = loadAuth();
  return {
    loggedIn: !!auth,
    name: auth?.name ?? null,
    userId: auth?.userId ?? null,
    selectedRepoId: auth?.selectedRepoId ?? null,
    selectedRepoName: auth?.selectedRepoName ?? null,
  };
}

export async function fetchUserRepos() {
  refreshCurrentUserFromStorage();
  if (!currentUser) return [];
  return getRepos(currentUser.token);
}

function buildIssueBody(session: Session): string {
  // Guard on SHAPE, not truthiness — an empty {} meta is truthy but has no
  // finalDurationMs/cutRanges, which would throw and abort issue creation.
  const m = session.meta;
  const duration =
    m && typeof m.finalDurationMs === "number" && Array.isArray(m.cutRanges)
      ? `${Math.round(m.finalDurationMs / 1000)}s (${m.cutRanges.length} cuts)`
      : "unknown";
  return `## GlitchRecord Session\n\n**Repo:** ${session.repoName}\n**Duration:** ${duration}\n**Events:** ${session.events.length}\n\n## Script\n\n${session.script ?? "Not generated."}\n\n## Events\n\n<details><summary>Raw events (${session.events.length})</summary>\n\n\`\`\`json\n${JSON.stringify(session.events, null, 2)}\n\`\`\`\n\n</details>\n\n---\n*Generated by [GlitchRecord](https://github.com/Navibyte-Innovations-Pvt-Ltd/glitchrecord)*`;
}
