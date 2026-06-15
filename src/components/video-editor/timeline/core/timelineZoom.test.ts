import { describe, expect, it } from "vitest";
import { computeZoomedRange, fractionToSpanMs, spanToFraction } from "./timelineZoom";

const TOTAL = 64_000; // 64s clip
const MIN = 300; // 300ms max zoom-in

describe("fractionToSpanMs", () => {
	it("fraction 0 = fully zoomed OUT (whole clip)", () => {
		expect(fractionToSpanMs(0, TOTAL, MIN)).toBe(TOTAL);
	});
	it("fraction 1 = fully zoomed IN (min span)", () => {
		expect(fractionToSpanMs(1, TOTAL, MIN)).toBeCloseTo(MIN, 5);
	});
	it("is monotonic decreasing (more fraction = tighter span)", () => {
		expect(fractionToSpanMs(0.25, TOTAL, MIN)).toBeGreaterThan(fractionToSpanMs(0.75, TOTAL, MIN));
	});
	it("clamps out-of-range fractions", () => {
		expect(fractionToSpanMs(-5, TOTAL, MIN)).toBe(TOTAL);
		expect(fractionToSpanMs(5, TOTAL, MIN)).toBeCloseTo(MIN, 5);
	});
	it("a clip shorter than minSpan can't zoom in — span stays the whole clip", () => {
		expect(fractionToSpanMs(1, 200, MIN)).toBe(200);
	});
});

describe("spanToFraction (inverse)", () => {
	it("round-trips with fractionToSpanMs", () => {
		for (const f of [0, 0.2, 0.5, 0.83, 1]) {
			const span = fractionToSpanMs(f, TOTAL, MIN);
			expect(spanToFraction(span, TOTAL, MIN)).toBeCloseTo(f, 5);
		}
	});
	it("whole-clip span = fraction 0; min span = fraction 1", () => {
		expect(spanToFraction(TOTAL, TOTAL, MIN)).toBe(0);
		expect(spanToFraction(MIN, TOTAL, MIN)).toBeCloseTo(1, 5);
	});
	it("degenerate clip (total <= min) = fraction 0", () => {
		expect(spanToFraction(150, 200, MIN)).toBe(0);
	});
});

describe("computeZoomedRange", () => {
	it("centers the playhead anchor when there's room", () => {
		const r = computeZoomedRange(spanToFraction(10_000, TOTAL, MIN), TOTAL, MIN, 32_000);
		expect(r.end - r.start).toBeCloseTo(10_000, 0);
		expect((r.start + r.end) / 2).toBeCloseTo(32_000, 0);
	});
	it("clamps to the left edge (anchor near start)", () => {
		const r = computeZoomedRange(spanToFraction(10_000, TOTAL, MIN), TOTAL, MIN, 0);
		expect(r.start).toBe(0);
		expect(r.end).toBeCloseTo(10_000, 0);
	});
	it("clamps to the right edge (anchor near end)", () => {
		const r = computeZoomedRange(spanToFraction(10_000, TOTAL, MIN), TOTAL, MIN, TOTAL);
		expect(r.end).toBeCloseTo(TOTAL, 0);
		expect(r.start).toBeCloseTo(TOTAL - 10_000, 0);
	});
	it("fraction 0 returns the whole clip", () => {
		const r = computeZoomedRange(0, TOTAL, MIN, 20_000);
		expect(r.start).toBe(0);
		expect(r.end).toBe(TOTAL);
	});
});
