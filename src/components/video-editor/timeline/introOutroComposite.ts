import type { Span } from "dnd-timeline";

/**
 * Composite-timeline math for the unified intro → recording → outro playhead.
 *
 * The editor timeline is laid out in COMPOSITE milliseconds: the intro occupies
 * `[0, leadInMs)`, the recording `[leadInMs, leadInMs + recMs)`, and the outro
 * `[leadInMs + recMs, total)`. Clip/zoom/etc. regions live in recording time, so
 * they are shifted right by `leadInMs` for display and shifted back before any
 * callback fires. This module owns that arithmetic (pure + unit-tested) so the
 * wiring in TimelineEditor stays mechanical. Export is NOT affected — it builds
 * the card frames separately in the main process.
 */

export interface CompositeBands {
	/** Composite ms where the recording band starts (= leadInMs). */
	recStartMs: number;
	/** Composite ms where the recording band ends (= leadInMs + recMs). */
	recEndMs: number;
	/** Total composite length (intro + recording + outro). */
	totalMs: number;
}

export function compositeBands(leadInMs: number, recMs: number, tailMs: number): CompositeBands {
	const lead = Math.max(0, leadInMs);
	const rec = Math.max(0, recMs);
	const tail = Math.max(0, tailMs);
	return { recStartMs: lead, recEndMs: lead + rec, totalMs: lead + rec + tail };
}

export type CompositeBand = "intro" | "recording" | "outro";

export interface CompositeClassification {
	band: CompositeBand;
	/** 0..1 within the intro/outro card (only for those bands). */
	progress?: number;
	/** Recording-time ms (only for the recording band), clamped to [0, recMs]. */
	recordingMs?: number;
}

/** Classify a COMPOSITE ms into its band + the in-band value the UI needs. */
export function classifyCompositeMs(
	ms: number,
	leadInMs: number,
	recMs: number,
	tailMs: number,
): CompositeClassification {
	const { recStartMs, recEndMs } = compositeBands(leadInMs, recMs, tailMs);
	if (leadInMs > 0 && ms < recStartMs) {
		return { band: "intro", progress: clamp01(ms / leadInMs) };
	}
	if (tailMs > 0 && ms > recEndMs) {
		return { band: "outro", progress: clamp01((ms - recEndMs) / tailMs) };
	}
	return { band: "recording", recordingMs: clamp(ms - recStartMs, 0, recMs) };
}

/** Recording ms → composite ms (shift the playhead into the composite frame). */
export function recordingToCompositeMs(recordingMs: number, leadInMs: number): number {
	return recordingMs + Math.max(0, leadInMs);
}

/**
 * Composite ms for a playing intro/outro card at `progress` (0..1). Lets the one
 * playhead sweep ACROSS the card band during playback (intro: 0→leadIn, outro:
 * recEnd→total) instead of freezing at the recording edge.
 */
export function cardProgressToCompositeMs(
	side: "intro" | "outro",
	progress: number,
	leadInMs: number,
	recMs: number,
	tailMs: number,
): number {
	const p = clamp01(progress);
	if (side === "intro") return p * Math.max(0, leadInMs);
	return Math.max(0, leadInMs) + Math.max(0, recMs) + p * Math.max(0, tailMs);
}

/** Shift a region span from recording time into composite time (or back, if negative). */
export function shiftSpan(span: Span, byMs: number): Span {
	return { start: span.start + byMs, end: span.end + byMs };
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

function clamp01(v: number): number {
	return clamp(v, 0, 1);
}
