// Glitchgrab API client — called from Electron main process
import { app } from "electron";
import type { GlitchRepo, GlitchUser } from "./types";

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
		const data = (await res.json()) as { success: boolean; data: GlitchUser };
		return data.success ? data.data : null;
	} catch {
		return null;
	}
}

// Backfills the tester/admin ExtensionSession's repoId once a recording
// actually starts (#297) — auto-login doesn't know a repo up front (a
// dashboard owner may have dozens; a QA tester may be assigned several).
// Requires the GlitchRecord account's own token — the route verifies repoId
// actually belongs to that account before writing (IDOR fix). Best-effort: a
// failure here only affects Tester Activity bookkeeping, not event capture
// or issue creation.
export async function setTesterSessionRepo(params: {
	token: string;
	sessionId: string;
	repoId: string;
}): Promise<void> {
	try {
		await fetch(`${BASE}/api/v1/extension/session/${params.sessionId}/repo`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${params.token}`,
			},
			body: JSON.stringify({ repoId: params.repoId }),
		});
	} catch {
		/* best-effort */
	}
}

export async function getRepos(token: string): Promise<GlitchRepo[]> {
	try {
		const res = await fetch(`${BASE}/api/v1/repos`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return [];
		const data = (await res.json()) as {
			success: boolean;
			data: { ownRepos: Array<{ id: string; fullName: string }> };
		};
		if (!data.success) return [];
		// Safety net: dedupe by fullName so the selector never shows a repo twice.
		const seen = new Set<string>();
		return data.data.ownRepos
			.filter((r) => (seen.has(r.fullName) ? false : (seen.add(r.fullName), true)))
			.map((r) => ({ id: r.id, name: r.fullName, fullName: r.fullName }));
	} catch {
		return [];
	}
}

// The GlitchRecord account's own repo/token is ALWAYS what the issue posts
// through — testerName/testerEmail (#297: manual popup paste OR QA magic-link
// auto-login) are pure attribution. The route creates a Report tagged
// source=EXTENSION_TESTER when they're present, alongside the GitHub issue.
export async function createIssue(params: {
	token: string;
	repoId: string;
	title: string;
	body: string;
	testerName?: string;
	testerEmail?: string;
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
				testerName: params.testerName,
				testerEmail: params.testerEmail,
			}),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			success: boolean;
			data: { issueUrl: string; issueNumber: number };
		};
		return data.success ? { url: data.data.issueUrl, number: data.data.issueNumber } : null;
	} catch {
		return null;
	}
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
		const data = (await res.json()) as { success: boolean; data?: { sessionId: string } };
		return data.success ? (data.data?.sessionId ?? null) : null;
	} catch {
		return null;
	}
}

export async function generateScript(params: {
	token: string;
	sessionId: string;
	lang?: string;
	gender?: string;
	durationSec?: number;
	zooms?: Array<{ startMs: number; endMs: number; depth?: number; cx?: number; cy?: number }>;
	noteAnswers?: Array<{ label: string; answer: string }>;
	// Screenshots of silent stretches (lead-in / idle) so the AI narrates them.
	visualContext?: Array<{ tMs: number; kind: "lead-in" | "idle" | "trailing"; dataUrl: string }>;
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
				visualContext: params.visualContext,
			}),
		});
		const data = (await res.json().catch(() => null)) as {
			success: boolean;
			data?: { script: string };
			error?: string;
		} | null;
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
	| {
			questions: Array<{
				id: string;
				tMs: number;
				label: string;
				question: string;
				options: string[];
			}>;
	  }
	| { error: string }
> {
	try {
		const res = await fetch(
			`${BASE}/api/v1/capture-sessions/${params.sessionId}/note-questions`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${params.token}`,
				},
				body:
					params.frames && params.frames.length > 0
						? JSON.stringify({ frames: params.frames })
						: undefined,
			},
		);
		const data = (await res.json().catch(() => null)) as {
			success: boolean;
			data?: {
				questions: Array<{
					id: string;
					tMs: number;
					label: string;
					question: string;
					options: string[];
				}>;
			};
			error?: string;
		} | null;
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
		const data = (await res.json().catch(() => null)) as {
			success: boolean;
			data?: { reply: string; script: string | null };
			error?: string;
		} | null;
		if (!res.ok || !data?.success || !data.data) {
			return { error: data?.error || `Refine API ${res.status}` };
		}
		return { reply: data.data.reply, script: data.data.script };
	} catch (err) {
		return { error: err instanceof Error ? err.message : "Network error" };
	}
}

// ── Report Bug (desktop) ─────────────────────────────────────────────
// The desktop "Report Bug" window deliberately talks to the SAME endpoints as
// the Chrome extension's report window, keyed on an ExtensionSession id. That
// session already encodes "who is reporting" (QA tester vs dashboard owner)
// AND the server-authoritative set of repos they may file against, so there is
// exactly one identity model and one report pipeline to debug — not a
// parallel desktop-only one.
//
// Two ways the app gets a session id:
//   - owner  → mintReporterSession() with the app's own GlitchRecordToken
//   - tester → the glitchrecord://tester-auth deep link, fired by the "Open in
//              GlitchRecord" button on the QA page in *any* browser. This is
//              why desktop reporting works on Firefox/Safari and the
//              Chrome-only extension doesn't.

export async function mintReporterSession(
	token: string,
): Promise<{ sessionId: string; testerName: string } | null> {
	try {
		const res = await fetch(`${BASE}/api/v1/glitchrecord/session`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			success: boolean;
			data?: { sessionId: string; testerName: string };
		};
		return data.success && data.data ? data.data : null;
	} catch {
		return null;
	}
}

export async function getReporterRepos(sessionId: string): Promise<GlitchRepo[]> {
	try {
		const res = await fetch(
			`${BASE}/api/v1/extension/repos?sessionId=${encodeURIComponent(sessionId)}`,
		);
		if (!res.ok) return [];
		const data = (await res.json()) as {
			success: boolean;
			data?: Array<{ id: string; fullName: string; aiAssistEnabled?: boolean }>;
		};
		if (!data.success || !data.data) return [];
		return data.data.map((r) => ({
			id: r.id,
			name: r.fullName,
			fullName: r.fullName,
			aiAssistEnabled: r.aiAssistEnabled === true,
		}));
	} catch {
		return [];
	}
}

/**
 * One turn of the AI report assistant (#330).
 *
 * Same endpoint the SDK and the Chrome extension call, authenticated the same
 * way the desktop report is — with the reporter's ExtensionSession id. The
 * server decides whether the assistant is available for the chosen repo; this
 * side only asks.
 *
 * Never throws. A failure comes back as `degraded`, the dialog closes the
 * assistant and the plain form takes over — filing a bug must not depend on a
 * model being up.
 */
export async function assistReportTurn(params: {
	sessionId: string;
	repoId: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	conversationId: string | null;
	screenshot?: string | null;
	context?: Record<string, unknown> | null;
}): Promise<{
	conversationId: string | null;
	question: string | null;
	report: string | null;
	degraded: string | null;
}> {
	const offline = {
		conversationId: null,
		question: null,
		report: null,
		degraded: "The assistant is unavailable — write your report below and send it as normal.",
	};
	try {
		const res = await fetch(`${BASE}/api/v1/ai/report-chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(params),
		});
		const data = (await res.json().catch(() => null)) as {
			success?: boolean;
			error?: string;
			data?: { conversationId?: string; question?: string | null; report?: string | null };
		} | null;
		if (!res.ok || !data?.success) {
			return { ...offline, degraded: data?.error ?? offline.degraded };
		}
		return {
			conversationId: data.data?.conversationId ?? null,
			question: data.data?.question ?? null,
			report: data.data?.report ?? null,
			degraded: null,
		};
	} catch {
		return offline;
	}
}

export async function submitReport(params: {
	sessionId: string;
	repoId: string;
	type: string;
	description: string;
	metadata?: Record<string, string>;
}): Promise<
	| { ok: true; issueUrl: string; issueNumber: number; title: string }
	| { ok: false; error: string }
> {
	try {
		const res = await fetch(`${BASE}/api/v1/extension/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sessionId: params.sessionId,
				repoId: params.repoId,
				type: params.type,
				description: params.description,
				metadata: params.metadata,
			}),
		});
		const data = (await res.json().catch(() => null)) as {
			success: boolean;
			data?: { issueUrl: string; issueNumber: number; title: string };
			error?: string;
		} | null;
		if (!res.ok || !data?.success || !data.data) {
			return { ok: false, error: data?.error || `Report API ${res.status}` };
		}
		return { ok: true, ...data.data };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : "Network error" };
	}
}

/**
 * Resolves a session id to the identity the SERVER says owns it.
 *
 * Never trust a name carried in the glitchrecord://tester-auth deep link — any
 * local app or web page can fire a custom-protocol URL, so the link's own
 * query string is attacker-controlled. This is what the confirmation prompt
 * displays, and a null return means the link is bogus and must be rejected.
 */
export async function resolveReporterSession(sessionId: string): Promise<{
	testerName: string;
	testerEmail: string | null;
	isTester: boolean;
	repos: Array<{ id: string; fullName: string }>;
} | null> {
	try {
		const res = await fetch(
			`${BASE}/api/v1/extension/session/${encodeURIComponent(sessionId)}`,
		);
		if (!res.ok) return null;
		const data = (await res.json()) as {
			success: boolean;
			data?: {
				testerName: string;
				testerEmail: string | null;
				isTester: boolean;
				repos: Array<{ id: string; fullName: string }>;
			};
		};
		return data.success && data.data ? data.data : null;
	} catch {
		return null;
	}
}
