import { describe, expect, it } from "vitest";

import { formatClipSpeedLabel, planClipSpeedChange } from "./clipSpeedChange";

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
