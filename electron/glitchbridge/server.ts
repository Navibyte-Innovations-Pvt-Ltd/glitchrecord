// WebSocket server running inside GlitchRecord Electron main process.
// Chrome extension connects here for real-time recording sync.
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { WebSocketServer, WebSocket } from "ws";
import type { Session, WsMsg, RecordingMeta, CaptureEvent, TesterIdentity } from "./types";
import { validateToken, getRepos, generateScript, uploadSession, setTesterSessionRepo } from "./api";
import { loadAuth } from "./auth";

function getSessionCachePath() {
  return path.join(app.getPath("userData"), "glitchgrab-last-session.json");
}

// ── Unified debug log ─────────────────────────────────────────
// Both the Chrome extension (via WS "log" messages) and GlitchRecord itself
// append here, so the whole capture pipeline is inspectable in one file:
//   <userData>/glitchgrab-debug.log
// Dev userData is ~/Library/Application Support/GlitchRecord-dev on macOS.
function getDebugLogPath() {
  return path.join(app.getPath("userData"), "glitchgrab-debug.log");
}

let debugLogResetDone = false;
export function appendDebugLog(source: "ext" | "rec" | "editor", text: string) {
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

// 7337 in prod; overridable so tests don't collide with a running GlitchRecord.
const PORT = Number(process.env.GLITCHBRIDGE_PORT) || 7337;

// After the first profile uploads on stop, hold the session open briefly so any
// OTHER Chrome profiles recording the same session can upload and merge in before
// we sort + generate the script. Single-profile recordings just pay this delay once.
const MERGE_WINDOW_MS = Number(process.env.GLITCHBRIDGE_MERGE_MS) || 1500;

// After stop, if no profile bulk-uploads, finalize from live-streamed events.
// Must exceed MERGE_WINDOW_MS so a real upload's merge-timer always wins the race.
const STOP_FALLBACK_MS = Number(process.env.GLITCHBRIDGE_STOP_FALLBACK_MS) || 3000;

const sessions = new Map<string, Session>();
const chromeClients = new Set<WebSocket>();

let wss: WebSocketServer | null = null;
let currentUser: { id: string; name: string; token: string } | null = null;
let currentSession: Session | null = null;
let recordingActive = false; // true between recording start and stop

// Last tester identity the extension sent (login can happen before or after
// Record is pressed — this survives until the next recording:start, when it's
// stamped onto the new Session). Cleared on tester:logout (#297).
let currentTesterIdentity: TesterIdentity | null = null;

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
let scriptReadyCb: ((sessionId: string, script: string) => void) | null = null;

// Merge window closed (or stop fallback fired) → fold in any live-streamed events
// from profiles that never bulk-uploaded (idle secondary profiles whose MV3 worker
// died / missed the stop), sort the combined timeline, then upload + generate the
// script ONCE. Module-scoped so both the upload merge-timer and the stop fallback
// can trigger it. Runs at most once per session (finalized guard).
async function finalizeSession(session: Session) {
  if (session.finalized) return;
  session.finalized = true;
  if (session.mergeTimer) clearTimeout(session.mergeTimer);
  session.mergeTimer = undefined;

  // Carry profiles that streamed events live but never sent a bulk events:upload
  // (their service worker was asleep at recording:stop and missed the broadcast).
  // The live stream already reached us in real time, so their events aren't lost.
  const uploaded = session.uploadedClients ?? new Set<string>();
  if (session.liveByClient) {
    for (const [cid, evs] of session.liveByClient) {
      if (uploaded.has(cid) || evs.length === 0) continue;
      session.events.push(...evs);
      appendDebugLog("rec", `finalize: recovered ${evs.length} live events from non-uploading profile ${cid}`);
    }
  }

  // Interleave profiles in real time order so the script reads as one flow.
  session.events.sort((a, b) => a.t - b.t);
  persistSession(session);
  const profiles = new Set([...(session.uploadedClients ?? []), ...(session.liveByClient?.keys() ?? [])]).size || 1;
  appendDebugLog("rec", `finalize ${session.id}: ${session.events.length} events from ${profiles} profile(s)`);
  eventsReadyCb?.(session.id, session.events.length);

  if (!currentUser) {
    console.log(`[GlitchBridge] ${session.events.length} events saved locally (not logged in)`);
    appendDebugLog("rec", `${session.events.length} events saved locally (not logged in)`);
    return;
  }

  const dbSessionId = await uploadSession({ events: session.events, meta: session.meta });
  if (!dbSessionId) {
    broadcastChrome({ type: "error", message: "Failed to save capture session" });
    return;
  }
  const result = await generateScript({ token: currentUser.token, sessionId: dbSessionId });
  if ("script" in result) {
    session.script = result.script;
    broadcastChrome({ type: "script:ready", sessionId: session.id, script: result.script });
    scriptReadyCb?.(session.id, result.script);
  }
}

export function startBridgeServer(callbacks: {
  onScriptReady: (sessionId: string, script: string) => void;
  onIssueCreated: (sessionId: string, issueUrl: string) => void;
  onLiveEvent?: (event: CaptureEvent) => void;
  onEventsReady?: (sessionId: string, count: number) => void;
}) {
  liveEventCb = callbacks.onLiveEvent ?? null;
  eventsReadyCb = callbacks.onEventsReady ?? null;
  scriptReadyCb = callbacks.onScriptReady;
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
          startedAt: currentSession.createdAt, // authoritative shared timeline origin — survives SW death
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

      // Live event stream from Chrome ext → forward to renderer feed AND buffer
      // per profile. The buffer is the safety net for an idle secondary profile
      // whose service worker dies / misses the stop and never bulk-uploads: its
      // events already arrived here live, so finalizeSession can recover them.
      if (msg.type === "event:live") {
        liveEventCb?.(msg.event);
        if (currentSession && recordingActive) {
          const cid = msg.event.client ?? "default";
          currentSession.liveByClient ??= new Map<string, CaptureEvent[]>();
          const arr = currentSession.liveByClient.get(cid) ?? [];
          arr.push(msg.event);
          currentSession.liveByClient.set(cid, arr);
        }
        return;
      }

      // Tester logged into the extension (or reconnected) — remember their
      // identity so it can be stamped onto the next recording session (#297).
      if (msg.type === "tester:identity") {
        currentTesterIdentity = { name: msg.name, email: msg.email, sessionId: msg.sessionId };
        if (currentSession) currentSession.tester = currentTesterIdentity;
        appendDebugLog("rec", `tester:identity — ${msg.name}`);
        return;
      }

      if (msg.type === "tester:logout") {
        currentTesterIdentity = null;
        if (currentSession) currentSession.tester = undefined;
        appendDebugLog("rec", "tester:logout");
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

        // Already fully processed (sorted + script generated) → ignore stragglers.
        if (session.finalized) {
          appendDebugLog("rec", `events:upload ignored — session ${session.id} already finalized`);
          return;
        }

        // Per-profile dedup vs merge. The SAME profile uploads twice on a
        // double-stop (HUD button + universal hook both fire recording:stop) —
        // ignore the second by clientId. A DIFFERENT profile (multi-profile
        // capture: admin in one Chrome profile, student in another) carries a
        // distinct clientId — merge its events in.
        const cid = msg.clientId ?? "default";
        session.uploadedClients ??= new Set<string>();
        if (session.uploadedClients.has(cid)) {
          appendDebugLog("rec", `events:upload ignored — profile ${cid} already uploaded to ${session.id}`);
          return;
        }
        session.uploadedClients.add(cid);

        session.events.push(...(msg.events as CaptureEvent[]));
        persistSession(session);
        eventsReadyCb?.(session.id, session.events.length);
        appendDebugLog("rec", `events:upload received ${msg.events.length} from profile ${cid} (total ${session.events.length}) for ${session.id}`);

        // Open / extend the merge window. Other profiles recording the same
        // session may still be uploading; once it goes quiet, finalize once:
        // sort the combined timeline + generate the script.
        if (session.mergeTimer) clearTimeout(session.mergeTimer);
        const s = session;
        session.mergeTimer = setTimeout(() => { void finalizeSession(s); }, MERGE_WINDOW_MS);
      }
    });

    ws.on("close", () => {
      chromeClients.delete(ws);
      console.log(`[GlitchBridge] Disconnected: ${role}`);
    });
  });
}

export function stopBridgeServer() {
  for (const s of sessions.values()) if (s.mergeTimer) clearTimeout(s.mergeTimer);
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
    tester: currentTesterIdentity ?? undefined,
  };
  sessions.set(sessionId, session);
  currentSession = session;
  recordingActive = true;
  broadcastChrome({ type: "recording:start", sessionId, repoId, repoName, startedAt: session.createdAt });
  console.log(`[GlitchBridge] Recording started: ${sessionId} → ${repoName}`);
  appendDebugLog("rec", `Recording started: ${sessionId} → ${repoName} (chromeClients=${chromeClients.size})`);

  // Backfill the tester/admin ExtensionSession's repoId now that a real repo
  // is known — auto-login didn't know it up front (#297). Needs the account's
  // own token so the route can verify repoId actually belongs to them.
  if (session.tester && currentUser) {
    void setTesterSessionRepo({ token: currentUser.token, sessionId: session.tester.sessionId, repoId });
  }

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

  // Stop-fallback finalize. Profiles that are awake at stop bulk-upload within ms
  // and their merge-timer finalizes first (this becomes a no-op via the finalized
  // guard). But if NO profile uploads — e.g. every awake profile is the primary
  // and the secondary's worker is dead — nothing would ever finalize. Schedule a
  // finalize from accumulated live events so the session still produces a script.
  if (session && !session.finalized) {
    if (session.mergeTimer) clearTimeout(session.mergeTimer);
    session.mergeTimer = setTimeout(() => { void finalizeSession(session); }, STOP_FALLBACK_MS);
  }
}

export function getCurrentUser() { return currentUser; }
export function getCurrentSession() { return currentSession; }

// "New Recording" — wipe the previous session + persisted cache so the editor's
// event panel clears and getCurrentSession()/loadPersistedSession() return empty
// until the next recording starts.
export function resetBridgeSession() {
  if (currentSession?.mergeTimer) clearTimeout(currentSession.mergeTimer);
  currentSession = null;
  recordingActive = false;
  try {
    fs.writeFileSync(getSessionCachePath(), JSON.stringify({ events: [], sessionId: null }), "utf8");
  } catch { /* non-critical */ }
  appendDebugLog("rec", "Session reset (New Recording) — events cleared");
}

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

