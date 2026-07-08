// Pure helpers for the GlitchGrab event panel — kept out of the component so
// they're unit-testable in lane 1 (see docs/TESTING.md: extract the pure
// function rather than test through the DOM).

export interface StatEvent {
	t: number; // ms from the (shared) recording start
	url?: string;
	client?: string; // which Chrome profile produced this event
}

// Distinct hue per Chrome profile, assigned by first-seen order (P1, P2, …).
export const PROFILE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];

export function hostOf(url?: string): string {
	if (!url) return "";
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

export interface ProfileTime {
	client: string;
	label: string; // friendly hostname (e.g. "testing.localhost:3333")
	activeMs: number; // share of the timeline this profile was the active one
	firstT: number; // first appearance — drives P1/P2 ordering
	count: number;
}

// How long each Chrome profile was "active", by attributing every gap between
// consecutive events to the profile that produced the earlier event. The user
// switches profiles mid-recording; this shows where the time actually went.
// Sums to the full recording span. Ordered by first appearance (P1, P2, …).
export function computeProfileTimes(events: StatEvent[]): ProfileTime[] {
	if (!events.some((e) => e.client)) return [];
	const sorted = [...events].sort((a, b) => a.t - b.t);
	const active = new Map<string, number>();
	const first = new Map<string, number>();
	const count = new Map<string, number>();
	const hostCounts = new Map<string, Map<string, number>>();
	for (let i = 0; i < sorted.length; i++) {
		const e = sorted[i];
		const c = e.client;
		if (!c) continue;
		if (!first.has(c)) first.set(c, e.t);
		count.set(c, (count.get(c) ?? 0) + 1);
		const next = sorted[i + 1];
		active.set(c, (active.get(c) ?? 0) + (next ? Math.max(0, next.t - e.t) : 0));
		const h = hostOf(e.url);
		if (h) {
			const hc = hostCounts.get(c) ?? new Map<string, number>();
			hc.set(h, (hc.get(h) ?? 0) + 1);
			hostCounts.set(c, hc);
		}
	}
	const domHost = (c: string): string => {
		let best = "";
		let bestN = 0;
		for (const [h, n] of hostCounts.get(c) ?? []) if (n > bestN) [best, bestN] = [h, n];
		return best;
	};
	return [...first.keys()]
		.sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0))
		.map((c) => ({
			client: c,
			label: domHost(c) || c.slice(0, 6),
			activeMs: active.get(c) ?? 0,
			firstT: first.get(c) ?? 0,
			count: count.get(c) ?? 0,
		}));
}

// Stretches where the presenter talked with NO captured clicks — the recording's
// lead-in (before the extension caught up), long idle pauses, AND the trailing
// stretch after the LAST event to the actual end of the video (an outro/wrap-up
// with no clicks is otherwise invisible to script-gen — it only sees events, so
// it silently stops narrating right where the last event was, even if the video
// keeps running for minutes more). A screenshot is grabbed at each so the AI can
// narrate what's on screen where events are silent.
export const LEAD_IN_MIN_MS = 6000; // ignore a trivial lead-in
export const SILENT_GAP_MIN_MS = 10000; // a pause this long between events = worth a frame
export const TRAILING_MIN_MS = 6000; // ignore a trivial tail
export const MAX_SILENT_FRAMES = 8; // cost cap on vision frames per generate

export function computeSilentGaps(
	events: StatEvent[],
	videoDurationMs?: number,
): Array<{ tMs: number; kind: "lead-in" | "idle" | "trailing" }> {
	if (events.length === 0) return [];
	const sorted = [...events].sort((a, b) => a.t - b.t);
	const gaps: Array<{ tMs: number; kind: "lead-in" | "idle" | "trailing"; span: number }> = [];
	const firstT = sorted[0].t;
	if (firstT > LEAD_IN_MIN_MS) gaps.push({ tMs: Math.round(firstT / 2), kind: "lead-in", span: firstT });
	for (let i = 0; i < sorted.length - 1; i++) {
		const span = sorted[i + 1].t - sorted[i].t;
		if (span > SILENT_GAP_MIN_MS)
			gaps.push({ tMs: sorted[i].t + Math.round(span / 2), kind: "idle", span });
	}
	const lastT = sorted[sorted.length - 1].t;
	if (videoDurationMs !== undefined && videoDurationMs - lastT > TRAILING_MIN_MS) {
		const span = videoDurationMs - lastT;
		gaps.push({ tMs: lastT + Math.round(span / 2), kind: "trailing", span });
	}
	// Keep the lead-in/trailing endpoints + the largest pauses, capped; then
	// restore timeline order.
	return gaps
		.sort((a, b) => {
			const aEnd = a.kind !== "idle" ? 1 : 0;
			const bEnd = b.kind !== "idle" ? 1 : 0;
			if (aEnd !== bEnd) return bEnd - aEnd; // endpoints (lead-in/trailing) first
			return b.span - a.span;
		})
		.slice(0, MAX_SILENT_FRAMES)
		.sort((a, b) => a.tMs - b.tMs)
		.map(({ tMs, kind }) => ({ tMs, kind }));
}
