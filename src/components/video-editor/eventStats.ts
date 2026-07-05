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
// lead-in (before the extension caught up) and long idle pauses. A screenshot is
// grabbed at each so the AI can narrate what's on screen where events are silent.
export const LEAD_IN_MIN_MS = 6000; // ignore a trivial lead-in
export const SILENT_GAP_MIN_MS = 10000; // a pause this long between events = worth a frame
export const MAX_SILENT_FRAMES = 8; // cost cap on vision frames per generate

export function computeSilentGaps(events: StatEvent[]): Array<{ tMs: number; kind: "lead-in" | "idle" }> {
	if (events.length === 0) return [];
	const sorted = [...events].sort((a, b) => a.t - b.t);
	const gaps: Array<{ tMs: number; kind: "lead-in" | "idle"; span: number }> = [];
	const firstT = sorted[0].t;
	if (firstT > LEAD_IN_MIN_MS) gaps.push({ tMs: Math.round(firstT / 2), kind: "lead-in", span: firstT });
	for (let i = 0; i < sorted.length - 1; i++) {
		const span = sorted[i + 1].t - sorted[i].t;
		if (span > SILENT_GAP_MIN_MS)
			gaps.push({ tMs: sorted[i].t + Math.round(span / 2), kind: "idle", span });
	}
	// Keep the lead-in + the largest pauses, capped; then restore timeline order.
	return gaps
		.sort((a, b) => (a.kind === "lead-in" ? -1 : b.kind === "lead-in" ? 1 : b.span - a.span))
		.slice(0, MAX_SILENT_FRAMES)
		.sort((a, b) => a.tMs - b.tMs)
		.map(({ tMs, kind }) => ({ tMs, kind }));
}
