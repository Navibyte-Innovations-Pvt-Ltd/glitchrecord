import { describe, expect, it } from "vitest";
import {
	calculateAxisScale,
	calculateTimelineScale,
	computeScrollbarThumb,
	createInitialRange,
	formatPlayheadTime,
	formatTimeLabel,
	normalizeWheelDeltaToPixels,
	resolveRangeFromScrollFraction,
} from "./time";

describe("timeline core/time", () => {
	it("creates fallback range for empty or invalid duration", () => {
		expect(createInitialRange(0)).toEqual({ start: 0, end: 1000 });
		expect(createInitialRange(-10)).toEqual({ start: 0, end: 1000 });
		expect(createInitialRange(2500)).toEqual({ start: 0, end: 2500 });
	});

	it("computes scale defaults and caps", () => {
		expect(calculateTimelineScale(0)).toEqual({
			minItemDurationMs: 100,
			defaultItemDurationMs: 1000,
			minVisibleRangeMs: 300,
		});
		expect(calculateTimelineScale(1).defaultItemDurationMs).toBe(100);
		expect(calculateTimelineScale(100).defaultItemDurationMs).toBe(5000);
		expect(calculateTimelineScale(10_000).defaultItemDurationMs).toBe(30000);
	});

	it("formats timeline labels in fractional, whole-second, and hour modes", () => {
		expect(formatTimeLabel(1234, 100)).toBe("0:01.23");
		expect(formatTimeLabel(1234, 500)).toBe("0:01.2");
		expect(formatTimeLabel(61_900, 1000)).toBe("1:01");
		expect(formatTimeLabel(3_661_999, 1000)).toBe("1:01:01");
	});

	it("formats playhead labels for sub-minute and minute timelines", () => {
		expect(formatPlayheadTime(1234)).toBe("1.2s");
		expect(formatPlayheadTime(61_400)).toBe("1:01.4");
	});

	it("normalizes wheel delta by deltaMode", () => {
		expect(normalizeWheelDeltaToPixels(2, 0)).toBe(2);
		expect(normalizeWheelDeltaToPixels(2, 1)).toBe(32);
		expect(normalizeWheelDeltaToPixels(2, 2)).toBe(480);
		expect(normalizeWheelDeltaToPixels(-3, 1)).toBe(-48);
	});

	it("picks fine and coarse axis scales based on visible range", () => {
		const tiny = calculateAxisScale(1);
		const typical = calculateAxisScale(2000);
		const huge = calculateAxisScale(24 * 60 * 60 * 1000);

		expect(tiny.intervalMs).toBeGreaterThan(0);
		expect(tiny.gridMs).toBeGreaterThan(0);
		expect(typical.intervalMs).toBeGreaterThanOrEqual(tiny.intervalMs);
		expect(huge.intervalMs).toBeGreaterThanOrEqual(typical.intervalMs);
	});

	// Regression: zoomed in, the user could NOT pan right to the end of the
	// timeline — there was no mouse-accessible horizontal pan affordance, so they
	// had to zoom all the way out and back in to navigate. These guard the pan math
	// behind the new scrollbar.
	describe("horizontal pan scrollbar", () => {
		it("thumb width is the visible fraction; left is the pan offset", () => {
			// 60s timeline, 5s window starting at 30s.
			const thumb = computeScrollbarThumb({ start: 30_000, end: 35_000 }, 60_000);
			expect(thumb.widthFraction).toBeCloseTo(5 / 60, 5);
			expect(thumb.leftFraction).toBeCloseTo(30 / 60, 5);
			expect(thumb.canPan).toBe(true);
		});

		it("cannot pan when the whole timeline is visible (zoomed out)", () => {
			const thumb = computeScrollbarThumb({ start: 0, end: 60_000 }, 60_000);
			expect(thumb.widthFraction).toBe(1);
			expect(thumb.leftFraction).toBe(0);
			expect(thumb.canPan).toBe(false);
		});

		it("dragging the thumb to the far RIGHT reaches the end (the bug)", () => {
			// THIS is the reported bug encoded as a test: panning to fraction 1 must
			// land the visible window flush against totalMs so the last clips are
			// reachable without zooming out.
			const range = resolveRangeFromScrollFraction(1, 5_000, 60_000);
			expect(range.end).toBe(60_000);
			expect(range.start).toBe(55_000);
		});

		it("dragging to the far LEFT reaches the start", () => {
			const range = resolveRangeFromScrollFraction(0, 5_000, 60_000);
			expect(range.start).toBe(0);
			expect(range.end).toBe(5_000);
		});

		it("preserves the visible span while panning and never overshoots", () => {
			const mid = resolveRangeFromScrollFraction(0.5, 5_000, 60_000);
			expect(mid.end - mid.start).toBe(5_000);
			const past = resolveRangeFromScrollFraction(99, 5_000, 60_000);
			expect(past.end).toBe(60_000); // clamped, not 60_000 * 99
		});

		it("thumb geometry round-trips with the range it produces", () => {
			const range = resolveRangeFromScrollFraction(1, 5_000, 60_000);
			const thumb = computeScrollbarThumb(range, 60_000);
			// Window at the right edge ⇒ thumb's right edge touches 1.
			expect(thumb.leftFraction + thumb.widthFraction).toBeCloseTo(1, 5);
		});
	});
});
