import { describe, expect, it } from "vitest";

import {
	clampPlaybackRate,
	computeManualSeekTarget,
	exceedsNativeRate,
	MAX_NATIVE_PLAYBACK_RATE,
} from "./playbackRateModel";

// Reproduces the user's lag report: a clip set to 21.55× froze the preview while
// audio kept playing. Root cause was an unclamped video.playbackRate (Chrome
// caps the effective rate ~16×, after which rVFC stops firing). These guard the
// clamp + the manual-seek advance that keeps the frame moving above the cap.

describe("clampPlaybackRate", () => {
	it("clamps the user's 21.55× down to the native ceiling (the freeze bug)", () => {
		expect(clampPlaybackRate(21.55)).toBe(MAX_NATIVE_PLAYBACK_RATE);
	});

	it("passes normal speeds through untouched", () => {
		expect(clampPlaybackRate(1)).toBe(1);
		expect(clampPlaybackRate(2)).toBe(2);
		expect(clampPlaybackRate(16)).toBe(16);
	});

	it("falls back to 1× for invalid input", () => {
		expect(clampPlaybackRate(0)).toBe(1);
		expect(clampPlaybackRate(-5)).toBe(1);
		expect(clampPlaybackRate(Number.NaN)).toBe(1);
	});
});

describe("exceedsNativeRate", () => {
	it("is true only above the native ceiling", () => {
		expect(exceedsNativeRate(21.55)).toBe(true);
		expect(exceedsNativeRate(30)).toBe(true);
		expect(exceedsNativeRate(16)).toBe(false);
		expect(exceedsNativeRate(2)).toBe(false);
	});
});

describe("computeManualSeekTarget", () => {
	it("advances the frame for the speed ABOVE the cap so it never freezes", () => {
		// 21.55× requested, element pinned at 16×. Over 200ms wall-clock the element
		// covers 16×·0.2s = 3.2s on its own; we add the missing (21.55−16)=5.55× →
		// 5.55·0.2 = 1.11s. So currentTime jumps forward 1.11s past where it was.
		const target = computeManualSeekTarget({
			currentSec: 10,
			wallDeltaMs: 200,
			targetSpeed: 21.55,
			endSec: Number.POSITIVE_INFINITY,
		});
		expect(target).toBeCloseTo(10 + 5.55 * 0.2, 5);
		expect(target).toBeGreaterThan(10); // the freeze is gone — frame moves
	});

	it("does NOT manual-advance at or below the native ceiling", () => {
		expect(
			computeManualSeekTarget({ currentSec: 10, wallDeltaMs: 200, targetSpeed: 16, endSec: 100 }),
		).toBe(10);
		expect(
			computeManualSeekTarget({ currentSec: 10, wallDeltaMs: 200, targetSpeed: 2, endSec: 100 }),
		).toBe(10);
	});

	it("never seeks past the content end", () => {
		const target = computeManualSeekTarget({
			currentSec: 9.9,
			wallDeltaMs: 1000,
			targetSpeed: 30,
			endSec: 10,
		});
		expect(target).toBe(10);
	});

	it("no-ops when no wall-clock elapsed", () => {
		expect(
			computeManualSeekTarget({ currentSec: 5, wallDeltaMs: 0, targetSpeed: 30, endSec: 100 }),
		).toBe(5);
	});
});
