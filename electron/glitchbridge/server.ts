// WebSocket server running inside GlitchRecord Electron main process.
// Chrome extension connects here for real-time recording sync.
import { WebSocketServer, WebSocket } from "ws";
import type { Session, WsMsg, RecordingMeta, CaptureEvent } from "./types";
import { validateToken, getRepos, createIssue, generateScript } from "./api";

const PORT = 7337;

const sessions = new Map<string, Session>();
const chromeClients = new Set<WebSocket>();

let wss: WebSocketServer | null = null;
let currentUser: { id: string; name: string; token: string } | null = null;
let currentSession: Session | null = null;

function send(ws: WebSocket, msg: WsMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastChrome(msg: WsMsg) {
  const payload = JSON.stringify(msg);
  for (const ws of chromeClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export function startBridgeServer(callbacks: {
  onScriptReady: (sessionId: string, script: string) => void;
  onIssueCreated: (sessionId: string, issueUrl: string) => void;
}) {
  if (wss) return;

  wss = new WebSocketServer({ port: PORT });
  console.log(`[GlitchBridge] WS server on ws://localhost:${PORT}`);

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const role = url.searchParams.get("role") ?? "unknown";
    console.log(`[GlitchBridge] Connected: ${role}`);

    if (role === "chrome") chromeClients.add(ws);

    ws.on("message", async (raw) => {
      let msg: WsMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

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

      // Chrome ext uploads events
      if (msg.type === "events:upload" && currentUser) {
        const session = sessions.get(msg.sessionId);
        if (!session) return;
        session.events.push(...(msg.events as CaptureEvent[]));

        // Upload to Glitchgrab + generate script
        const script = await generateScript({
          token: currentUser.token,
          sessionId: msg.sessionId,
        });
        if (script) {
          session.script = script;
          broadcastChrome({ type: "script:ready", sessionId: msg.sessionId, script });
          callbacks.onScriptReady(msg.sessionId, script);

          // Create GitHub issue
          const issue = await createIssue({
            token: currentUser.token,
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
    });

    ws.on("close", () => {
      chromeClients.delete(ws);
      console.log(`[GlitchBridge] Disconnected: ${role}`);
    });
  });

  wss.on("error", (err) => console.error("[GlitchBridge] Error:", err));
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
  broadcastChrome({ type: "recording:start", sessionId, repoId, repoName });
  console.log(`[GlitchBridge] Recording started: ${sessionId} → ${repoName}`);
  return sessionId;
}

// Called when user presses Stop + edit cuts are collected
export function broadcastRecordingStop(sessionId: string, meta: RecordingMeta) {
  const session = sessions.get(sessionId);
  if (session) session.meta = meta;
  broadcastChrome({ type: "recording:stop", sessionId, meta });
  console.log(`[GlitchBridge] Recording stopped: ${sessionId}`);
}

export function getCurrentUser() { return currentUser; }
export function getCurrentSession() { return currentSession; }

function buildIssueBody(session: Session): string {
  const duration = session.meta
    ? `${Math.round(session.meta.finalDurationMs / 1000)}s (${session.meta.cutRanges.length} cuts)`
    : "unknown";
  return `## GlitchRecord Session\n\n**Repo:** ${session.repoName}\n**Duration:** ${duration}\n**Events:** ${session.events.length}\n\n## Script\n\n${session.script ?? "Not generated."}\n\n## Events\n\n<details><summary>Raw events (${session.events.length})</summary>\n\n\`\`\`json\n${JSON.stringify(session.events, null, 2)}\n\`\`\`\n\n</details>\n\n---\n*Generated by [GlitchRecord](https://github.com/Navibyte-Innovations-Pvt-Ltd/glitchrecord)*`;
}
