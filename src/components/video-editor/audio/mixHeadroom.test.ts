import { describe, expect, it } from "vitest";
import { computeMixHeadroom, PREVIEW_MIX_CEILING } from "./mixHeadroom";

describe("computeMixHeadroom — preview anti-clip", () => {
	it("REPRO: narration + source/embedded both near full-scale would clip the device (sum > 1)", () => {
		// This is the bug: each source is individually clamped to ≤1, but the
		// preview sums them at the device with no limiter → > 1.0 → hard clip
		// ("speaker tearing"). The raw narration file alone (one source) is clean.
		const narration = 1.0;
		const embeddedVideo = 0.9;
		const rawSum = narration + embeddedVideo;
		expect(rawSum).toBeGreaterThan(1); // device clips here → distortion

		// The fix attenuates proportionally so the summed peak fits the ceiling.
		const headroom = computeMixHeadroom([narration, embeddedVideo]);
		const fixedSum = (narration + embeddedVideo) * headroom;
		expect(fixedSum).toBeLessThanOrEqual(PREVIEW_MIX_CEILING + 1e-9);
	});

	it("does NOT attenuate when a single source fits (narration alone stays at full volume)", () => {
		expect(computeMixHeadroom([1.0])).toBe(1);
		expect(computeMixHeadroom([0.8])).toBe(1);
	});

	it("does not attenuate when the sum already fits under the ceiling", () => {
		expect(computeMixHeadroom([0.4, 0.5])).toBe(1); // 0.9 ≤ 0.99
	});

	it("preserves relative balance between sources (proportional, not muting)", () => {
		const gains = [1.0, 0.5]; // 2:1 ratio, sum 1.5 > ceiling
		const h = computeMixHeadroom(gains);
		const scaled = gains.map((g) => g * h);
		expect(scaled[0] / scaled[1]).toBeCloseTo(2, 5); // ratio unchanged
		expect(scaled.reduce((a, b) => a + b, 0)).toBeCloseTo(PREVIEW_MIX_CEILING, 5);
	});

	it("handles three concurrent sources (narration + mic + system)", () => {
		const gains = [1.0, 0.8, 0.8]; // sum 2.6
		const h = computeMixHeadroom(gains);
		expect(gains.reduce((a, b) => a + b, 0) * h).toBeCloseTo(PREVIEW_MIX_CEILING, 5);
	});

	it("ignores negative/zero gains and returns 1 for an empty/silent set", () => {
		expect(computeMixHeadroom([])).toBe(1);
		expect(computeMixHeadroom([0, 0])).toBe(1);
		expect(computeMixHeadroom([1.0, -5])).toBe(1); // negative ignored, sum=1 ≤ ceiling...
	});

	it("respects a custom ceiling", () => {
		expect(computeMixHeadroom([0.5, 0.5], 0.5)).toBeCloseTo(0.5, 5);
	});
});
