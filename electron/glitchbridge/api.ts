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
}): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/capture-sessions/${params.sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { success: boolean; data: { script: string } };
    return data.success ? data.data.script : null;
  } catch { return null; }
}
