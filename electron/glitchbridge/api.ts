// Glitchgrab API client — called from Electron main process
import { app } from "electron";
import type { GlitchUser, GlitchRepo } from "./types";

// Dev (unpackaged) → localhost; packaged build → production
export const BASE =
	process.env.GLITCHGRAB_API_URL ??
	(app.isPackaged ? "https://glitchgrab.dev" : "http://localhost:3000");

export async function validateToken(token: string): Promise<GlitchUser | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { success: boolean; data: GlitchUser };
    return data.success ? data.data : null;
  } catch { return null; }
}

export async function getRepos(token: string): Promise<GlitchRepo[]> {
  try {
    const res = await fetch(`${BASE}/api/v1/repos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      success: boolean;
      data: { ownRepos: Array<{ id: string; fullName: string }> };
    };
    if (!data.success) return [];
    // Safety net: dedupe by fullName so the selector never shows a repo twice.
    const seen = new Set<string>();
    return data.data.ownRepos
      .filter((r) => (seen.has(r.fullName) ? false : (seen.add(r.fullName), true)))
      .map((r) => ({ id: r.id, name: r.fullName, fullName: r.fullName }));
  } catch { return []; }
}

export async function createIssue(params: {
  token: string;
  repoId: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number } | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/glitchrecord/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        repoId: params.repoId,
        title: params.title,
        body: params.body,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { success: boolean; data: { issueUrl: string; issueNumber: number } };
    return data.success ? { url: data.data.issueUrl, number: data.data.issueNumber } : null;
  } catch { return null; }
}

// Create a DB capture session with the events, returns its id (cuid)
export async function uploadSession(params: {
  events: unknown[];
  meta: unknown;
}): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/capture-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: params.events, meta: params.meta }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { success: boolean; data?: { sessionId: string } };
    return data.success ? (data.data?.sessionId ?? null) : null;
  } catch { return null; }
}

export async function generateScript(params: {
  token: string;
  sessionId: string;
  lang?: string;
  gender?: string;
  durationSec?: number;
  zooms?: Array<{ startMs: number; endMs: number; depth?: number; cx?: number; cy?: number }>;
  noteAnswers?: Array<{ label: string; answer: string }>;
}): Promise<{ script: string } | { error: string }> {
  try {
    const res = await fetch(`${BASE}/api/v1/capture-sessions/${params.sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        lang: params.lang,
        gender: params.gender,
        durationSec: params.durationSec,
        zooms: params.zooms,
        noteAnswers: params.noteAnswers,
      }),
    });
    const data = await res.json().catch(() => null) as
      | { success: boolean; data?: { script: string }; error?: string }
      | null;
    if (!res.ok || !data?.success || !data.data?.script) {
      // Surface the real reason (e.g. "Insufficient Balance") instead of a null.
      return { error: data?.error || `Script API ${res.status}` };
    }
    return { script: data.data.script };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
  }
}

// Per-note clarifying questions (3 grounded options each + free text) for the
// shift-marked spots, so the user can say what to explain before generating.
export async function getNoteQuestions(params: {
  token: string;
  sessionId: string;
  // PASS 2: a screenshot per still-unclear group (id → data URL). When present
  // the API re-judges those groups WITH the picture and returns only the ones
  // vision still can't resolve. Omit for PASS 1 (text-only).
  frames?: Array<{ id: string; dataUrl: string }>;
}): Promise<
  | { questions: Array<{ id: string; tMs: number; label: string; question: string; options: string[] }> }
  | { error: string }
> {
  try {
    const res = await fetch(`${BASE}/api/v1/capture-sessions/${params.sessionId}/note-questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: params.frames && params.frames.length > 0 ? JSON.stringify({ frames: params.frames }) : undefined,
    });
    const data = (await res.json().catch(() => null)) as
      | { success: boolean; data?: { questions: Array<{ id: string; tMs: number; label: string; question: string; options: string[] }> }; error?: string }
      | null;
    if (!res.ok || !data?.success || !data.data) {
      return { error: data?.error || `Note questions API ${res.status}` };
    }
    return { questions: data.data.questions };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
  }
}

// Conversationally refine an existing script. Returns the full revised script.
export async function refineScript(params: {
  token: string;
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  currentScript?: string;
  lang?: string;
  gender?: string;
  durationSec?: number;
  zooms?: Array<{ startMs: number; endMs: number; depth?: number; cx?: number; cy?: number }>;
}): Promise<{ reply: string; script: string | null } | { error: string }> {
  try {
    const res = await fetch(`${BASE}/api/v1/capture-sessions/${params.sessionId}/refine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        messages: params.messages,
        currentScript: params.currentScript,
        lang: params.lang,
        gender: params.gender,
        durationSec: params.durationSec,
        zooms: params.zooms,
      }),
    });
    const data = await res.json().catch(() => null) as
      | { success: boolean; data?: { reply: string; script: string | null }; error?: string }
      | null;
    if (!res.ok || !data?.success || !data.data) {
      return { error: data?.error || `Refine API ${res.status}` };
    }
    return { reply: data.data.reply, script: data.data.script };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
  }
}
