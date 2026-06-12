import { describe, expect, it } from "vitest";

import {
	CLIP_SPEEDS,
	formatClipSpeedLabel,
	planClipSpeedChange,
	snapStretchSpeed,
} from "./clipSpeedChange";

// Right-edge stretch → speed. Models the timeline gesture from the editor:
// drag a clip's right handle wider to slow it down, squeeze it to speed up.
// Source content stays fixed; speed = source / timeline-width, snapped to CLIP_SPEEDS.
describe("snapStretchSpeed (drag right handle → speed)", () => {
	it("matches the editor screenshot: 4.825s source over a 19.3s clip → 0.25x", () => {
		// Clip shown as 0.1s–19.4s at 0.25x ⇒ source = 19.3s * 0.25 = 4.825s.
		expect(snapStretchSpeed(4825, 19_300)).toBe(0.25);
	});

	it("stretching to the right lowers the speed (slow-mo)", () => {
		const source = 5000;
		expect(snapStretchSpeed(source, 6667)).toBe(0.75); // 5000/6667 ≈ 0.75
		expect(snapStretchSpeed(source, 10_000)).toBe(0.5); // wider → slower
		expect(snapStretchSpeed(source, 20_000)).toBe(0.25); // widest → slowest allowed
	});

	it("squeezing back to the left raises the speed (fast-forward)", () => {
		const source = 5000;
		expect(snapStretchSpeed(source, 4000)).toBe(1.25); // 5000/4000 = 1.25
		expect(snapStretchSpeed(source, 2500)).toBe(2); // narrower → faster
		expect(snapStretchSpeed(source, 1250)).toBe(4); // narrowest → fastest allowed
	});

	it("stretch right then make it lower again round-trips to the same speed", () => {
		const source = 5000;
		const original = snapStretchSpeed(source, 2500); // 2x
		const stretchedWider = snapStretchSpeed(source, 10_000); // 0.5x
		const squeezedBack = snapStretchSpeed(source, 2500); // back to 2x
		expect(stretchedWider).toBeLessThan(original);
		expect(squeezedBack).toBe(original);
	});

	it("speed decreases monotonically as the clip is stretched wider", () => {
		const source = 5000;
		const speeds = [2000, 4000, 6000, 10_000, 20_000].map((w) => snapStretchSpeed(source, w));
		for (let i = 1; i < speeds.length; i++) {
			expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1]);
		}
	});

	it("always returns an allowed snap speed and clamps degenerate sizes", () => {
		expect(CLIP_SPEEDS).toContain(snapStretchSpeed(0, 0));
		expect(CLIP_SPEEDS).toContain(snapStretchSpeed(123_456, 7));
	});
});

describe("formatClipSpeedLabel", () => {
	it("returns labels only for non-default positive speeds", () => {
		expect(formatClipSpeedLabel(1)).toBeNull();
		expect(formatClipSpeedLabel(0)).toBeNull();
		expect(formatClipSpeedLabel(-1)).toBeNull();
		expect(formatClipSpeedLabel(Number.POSITIVE_INFINITY)).toBeNull();
		expect(formatClipSpeedLabel(Number.NaN)).toBeNull();
		expect(formatClipSpeedLabel(0.5)).toBe("0.5x");
		expect(formatClipSpeedLabel(2)).toBe("2x");
	});
});

describe("planClipSpeedChange", () => {
	it("returns null for missing clips and invalid speeds", () => {
		const clipRegions = [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }];

		expect(
			planClipSpeedChange({
				clipRegions,
				zoomRegions: [],
				selectedClipId: "missing",
				speed: 0.5,
			}),
		).toBeNull();

		for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				planClipSpeedChange({
					clipRegions,
					zoomRegions: [],
					selectedClipId: "clip-1",
					speed,
				}),
			).toBeNull();
		}
	});

	it("extends an isolated clip when slowing it down", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
			zoomRegions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 0.5 }],
			zoomRegions: [],
		});
	});

	it("shortens an isolated clip when speeding it up", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6_000, speed: 1 }],
			zoomRegions: [],
			selectedClipId: "clip-1",
			speed: 2,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 3_000, speed: 2 }],
			zoomRegions: [],
		});
	});

	it("treats invalid stored clip speed as 1x", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 4_000, speed: Number.NaN }],
			zoomRegions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 0.5 }],
			zoomRegions: [],
		});
	});

	it("shifts the following clip when slowing (reflow, not blocked)", () => {
		const result = planClipSpeedChange({
			clipRegions: [
				{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 },
				{ id: "clip-2", startMs: 5_000, endMs: 10_000, speed: 1 },
			],
			zoomRegions: [],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [
				{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 0.5 },
				{ id: "clip-2", startMs: 10_000, endMs: 15_000, speed: 1 },
			],
			zoomRegions: [],
		});
	});

	it("scales zoom regions inside the changed clip", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 1_000, endMs: 5_000, speed: 1 }],
			zoomRegions: [
				{ id: "zoom-1", startMs: 2_000, endMs: 3_000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 1_000, endMs: 9_000, speed: 0.5 }],
			zoomRegions: [
				{ id: "zoom-1", startMs: 3_000, endMs: 5_000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
		});
	});

	it("leaves earlier zooms alone but shifts zooms after the changed clip", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 2_000, endMs: 6_000, speed: 1 }],
			zoomRegions: [
				{ id: "zoom-before", startMs: 1_000, endMs: 1_500, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
				{ id: "zoom-after", startMs: 6_000, endMs: 6_500, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		// clip 2000–6000 @1x → 0.5x → end 10000 (delta +4000); zoom-after shifts +4000.
		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 2_000, endMs: 10_000, speed: 0.5 }],
			zoomRegions: [
				{ id: "zoom-before", startMs: 1_000, endMs: 1_500, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
				{ id: "zoom-after", startMs: 10_000, endMs: 10_500, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
		});
	});

	it("reflows zooms after the clip instead of blocking", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
			zoomRegions: [
				{ id: "zoom-1", startMs: 2_000, endMs: 3_000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
				{ id: "zoom-2", startMs: 5_500, endMs: 6_500, depth: 3, focus: { cx: 0.5, cy: 0.5 } },
			],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		// clip 0–5000 @1x → 0.5x → end 10000 (delta +5000). zoom-1 inside scales ×2;
		// zoom-2 (after) shifts +5000.
		expect(result).toEqual({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 0.5 }],
			zoomRegions: [
				{ id: "zoom-1", startMs: 4_000, endMs: 6_000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
				{ id: "zoom-2", startMs: 10_500, endMs: 11_500, depth: 3, focus: { cx: 0.5, cy: 0.5 } },
			],
		});
	});
});
