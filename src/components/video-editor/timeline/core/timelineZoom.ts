import type { Range } from "dnd-timeline";

// Timeline horizontal zoom = the WIDTH of the visible range window. Zoomed all the
// way OUT shows the whole clip (span = totalMs); all the way IN shows minSpanMs
// (300ms). The slider fraction runs 0 (out) … 1 (in). The mapping is LOGARITHMIC
// so each equal drag step multiplies the zoom — the DaVinci-style feel where one
// smooth slide crosses a 60s → 0.3s range instead of crawling linearly.

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Effective bounds, guarding tiny/zero clips (min can't exceed total).
function bounds(totalMs: number, minSpanMs: number) {
	const total = Math.max(1, totalMs);
	const min = Math.max(1, Math.min(minSpanMs, total));
	return { total, min };
}

// fraction (0 out … 1 in) → visible span in ms. f=0 ⇒ total, f=1 ⇒ min.
export function fractionToSpanMs(fraction: number, totalMs: number, minSpanMs: number): number {
	const { total, min } = bounds(totalMs, minSpanMs);
	if (total <= min) return total;
	return total * Math.pow(min / total, clamp01(fraction));
}

// visible span → fraction (inverse of the above), so a wheel/pinch zoom is
// reflected on the slider thumb.
export function spanToFraction(spanMs: number, totalMs: number, minSpanMs: number): number {
	const { total, min } = bounds(totalMs, minSpanMs);
	if (total <= min) return 0;
	const span = Math.max(min, Math.min(spanMs, total));
	return clamp01(Math.log(span / total) / Math.log(min / total));
}

// Build the new visible range for a slider fraction, keeping `anchorMs` (the
// playhead) centered when possible, then clamped into [0, total].
export function computeZoomedRange(
	fraction: number,
	totalMs: number,
	minSpanMs: number,
	anchorMs: number,
): Range {
	const { total } = bounds(totalMs, minSpanMs);
	const span = fractionToSpanMs(fraction, totalMs, minSpanMs);
	const anchor = Math.max(0, Math.min(anchorMs, total));
	const start = Math.max(0, Math.min(anchor - span / 2, total - span));
	return { start, end: start + span };
}
