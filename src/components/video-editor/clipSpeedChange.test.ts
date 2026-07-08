import { describe, expect, it } from "vitest";

import {
	formatClipSpeedLabel,
	planClipSpeedChange,
	snapClipSpeed,
	snapStretchSpeed,
	SPEED_MAX,
	SPEED_MIN,
	SPEED_STEP,
} from "./clipSpeedChange";
import { getClipSourceSpans } from "./types";

// Right-edge stretch → speed. Models the timeline gesture from the editor:
// drag a clip's right handle wider to slow it down, squeeze it to speed up.
// Source content stays fixed; speed = source / timeline-width, snapped to the
// clean 0.05 grid (0.1 … 30) — the user adjusts freely, not via fixed presets.
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

	it("clamps degenerate sizes into the [0.1, 30] range and lands on the 0.05 grid", () => {
		const tiny = snapStretchSpeed(0, 0); // → clamps to the floor
		const huge = snapStretchSpeed(123_456, 7); // → clamps to the ceiling
		expect(tiny).toBe(SPEED_MIN);
		expect(huge).toBe(SPEED_MAX);
		// every result is already-snapped (idempotent on the 0.05 grid)
		expect(snapClipSpeed(tiny)).toBe(tiny);
		expect(snapClipSpeed(huge)).toBe(huge);
	});

	it("produces clean 0.05-grid values (e.g. 0.85), never arbitrary like 0.8333", () => {
		expect(snapStretchSpeed(5000, 6000)).toBe(0.85); // 5000/6000 = 0.8333 → 0.85
	});
});

describe("snapClipSpeed (clean 0.05 grid, clamped 0.1…30)", () => {
	it("snaps to the nearest 0.05 with no float drift", () => {
		expect(snapClipSpeed(0.1)).toBe(0.1);
		expect(snapClipSpeed(0.15)).toBe(0.15);
		expect(snapClipSpeed(0.123)).toBe(0.1);
		expect(snapClipSpeed(0.138)).toBe(0.15);
		expect(snapClipSpeed(0.1345)).toBe(0.15); // the "no 0.1345" requirement
		expect(snapClipSpeed(1.337)).toBe(1.35);
		// clean decimals, no 0.15000000000000002
		expect(Number.isInteger(snapClipSpeed(0.4) / SPEED_STEP)).toBe(true);
	});

	it("clamps below 0.1 and above 30", () => {
		expect(snapClipSpeed(0)).toBe(SPEED_MIN);
		expect(snapClipSpeed(-3)).toBe(SPEED_MIN);
		expect(snapClipSpeed(0.04)).toBe(SPEED_MIN);
		expect(snapClipSpeed(99)).toBe(SPEED_MAX);
	});

	it("falls back to 1 for non-finite input", () => {
		expect(snapClipSpeed(Number.NaN)).toBe(1);
		expect(snapClipSpeed(Number.POSITIVE_INFINITY)).toBe(1);
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
				// Reflowed to stay adjacent — its footage didn't move, so its source
				// anchor is locked to where it WAS (5000) before the shift.
				{ id: "clip-2", startMs: 10_000, endMs: 15_000, speed: 1, sourceStartMs: 5_000 },
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

	// User's report: slowed one clip down (it grew ~45s on the timeline), and the
	// clip AFTER it lost exactly that much footage — as if the added time was
	// "stolen" from the neighbour instead of just shifting it. Root cause: the
	// reflow branch locked the shifted clip's sourceStartMs to its own raw
	// startMs — correct only for the first clip in a sequence. This project has
	// an earlier 0.55x clip, so every later un-anchored clip's TRUE source start
	// is the accumulated total, not its own startMs (same bug class as the
	// ripple-delete fix, different code path). Fixed via trueSourceStartMs
	// (types.ts), which computes the real value instead of assuming raw startMs.
	it("reflow keeps the NEXT clip's own footage duration intact when an earlier legacy clip slows down", () => {
		const clips = [
			{ id: "clip-3", startMs: 0, endMs: 111, speed: 1 },
			{ id: "clip-2", startMs: 111, endMs: 14_013, speed: 0.55 },
			{ id: "clip-6", startMs: 14_013, endMs: 30_345, speed: 1 },
			{ id: "clip-5", startMs: 30_345, endMs: 36_458, speed: 0.15 },
		];
		const before = getClipSourceSpans(clips).find((s) => s.clip.id === "clip-5")!;
		const beforeDuration = before.sourceEndMs - before.sourceStartMs;

		const plan = planClipSpeedChange({
			clipRegions: clips,
			zoomRegions: [],
			selectedClipId: "clip-6",
			speed: 0.5, // slow clip-6 down — it grows on the timeline, clip-5 reflows right
		});
		expect(plan && "clipRegions" in plan).toBe(true);
		const nextClips = (plan as { clipRegions: typeof clips }).clipRegions;

		const after = getClipSourceSpans(nextClips).find((s) => s.clip.id === "clip-5")!;
		const afterDuration = after.sourceEndMs - after.sourceStartMs;

		// clip-5's own footage duration must be UNCHANGED — only its timeline
		// position shifts to stay adjacent to the now-wider clip-6.
		expect(afterDuration).toBeCloseTo(beforeDuration, 0);
	});
});
