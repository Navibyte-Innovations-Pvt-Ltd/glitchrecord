import { describe, expect, it } from "vitest";
import { rippleAudioRegionsForRemovedSegments } from "./audioRegionRipple";

interface Audio {
	id: string;
	startMs: number;
	endMs: number;
}

describe("rippleAudioRegionsForRemovedSegments", () => {
	// The reported bug: a narration track spanning the whole video VANISHED on a
	// trim, because it overlapped the removed segment and was deleted outright.
	it("keeps a full-span narration when a middle chunk is trimmed (does NOT vanish)", () => {
		const narration: Audio[] = [{ id: "narr", startMs: 0, endMs: 60_000 }];
		const out = rippleAudioRegionsForRemovedSegments(narration, [{ startMs: 20_000, endMs: 25_000 }]);
		expect(out).toHaveLength(1);
		// Spanned the cut → shrinks by the 5s removed, never disappears.
		expect(out[0]).toMatchObject({ id: "narr", startMs: 0, endMs: 55_000 });
	});

	it("shifts an audio region that sits entirely after a cut left by the removed time", () => {
		const audio: Audio[] = [{ id: "a", startMs: 30_000, endMs: 40_000 }];
		const out = rippleAudioRegionsForRemovedSegments(audio, [{ startMs: 10_000, endMs: 14_000 }]);
		expect(out[0]).toMatchObject({ startMs: 26_000, endMs: 36_000 });
	});

	it("leaves a region fully before the cut untouched", () => {
		const audio: Audio[] = [{ id: "a", startMs: 0, endMs: 5_000 }];
		const out = rippleAudioRegionsForRemovedSegments(audio, [{ startMs: 10_000, endMs: 14_000 }]);
		expect(out[0]).toMatchObject({ startMs: 0, endMs: 5_000 });
	});

	it("drops only a region that was ENTIRELY inside the cut", () => {
		const audio: Audio[] = [
			{ id: "inside", startMs: 11_000, endMs: 13_000 },
			{ id: "spanning", startMs: 0, endMs: 60_000 },
		];
		const out = rippleAudioRegionsForRemovedSegments(audio, [{ startMs: 10_000, endMs: 14_000 }]);
		expect(out.map((r) => r.id)).toEqual(["spanning"]);
	});

	it("handles multiple removed segments cumulatively", () => {
		const audio: Audio[] = [{ id: "a", startMs: 0, endMs: 60_000 }];
		const out = rippleAudioRegionsForRemovedSegments(audio, [
			{ startMs: 5_000, endMs: 7_000 },
			{ startMs: 30_000, endMs: 33_000 },
		]);
		// 2s + 3s = 5s removed across the span.
		expect(out[0]).toMatchObject({ startMs: 0, endMs: 55_000 });
	});

	it("no removed segments → returns the input unchanged", () => {
		const audio: Audio[] = [{ id: "a", startMs: 0, endMs: 5_000 }];
		expect(rippleAudioRegionsForRemovedSegments(audio, [])).toBe(audio);
	});
});
