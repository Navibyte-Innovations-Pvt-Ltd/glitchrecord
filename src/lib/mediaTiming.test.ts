import { describe, expect, it } from "vitest";

import {
	clampMediaTimeToDuration,
	enablePitchPreservingPlayback,
	estimateCompanionAudioStartDelaySeconds,
	getEffectiveRecordingDurationMs,
	getEffectiveVideoStreamDurationSeconds,
	getMediaSyncPlaybackRate,
	resolveOverlayPlaybackRate,
} from "./mediaTiming";

describe("clampMediaTimeToDuration", () => {
	it("clamps playback time to known media duration", () => {
		expect(clampMediaTimeToDuration(12, 4.5)).toBe(4.5);
		expect(clampMediaTimeToDuration(-1, 4.5)).toBe(0);
	});

	it("leaves playback time unchanged when duration is unknown", () => {
		expect(clampMediaTimeToDuration(12, null)).toBe(12);
		expect(clampMediaTimeToDuration(12, Number.NaN)).toBe(12);
	});
});

describe("estimateCompanionAudioStartDelaySeconds", () => {
	it("keeps small inferred offsets when the companion audio is only slightly shorter", () => {
		expect(estimateCompanionAudioStartDelaySeconds(10, 9.6)).toBeCloseTo(0.4);
		expect(estimateCompanionAudioStartDelaySeconds(10, 9.97)).toBeCloseTo(0.03);
	});

	it("prefers an explicitly recorded start delay", () => {
		expect(estimateCompanionAudioStartDelaySeconds(10, 2, 3_500)).toBeCloseTo(3.5);
		expect(estimateCompanionAudioStartDelaySeconds(10, 2, 0)).toBe(0);
	});

	it("ignores tiny, negative, or suspiciously large inferred differences", () => {
		expect(estimateCompanionAudioStartDelaySeconds(10, 9.99)).toBe(0);
		expect(estimateCompanionAudioStartDelaySeconds(10, 10.5)).toBe(0);
		expect(estimateCompanionAudioStartDelaySeconds(600, 565)).toBe(0);
	});
});

describe("getEffectiveRecordingDurationMs", () => {
	it("subtracts accumulated paused time", () => {
		expect(
			getEffectiveRecordingDurationMs({
				startTimeMs: 1_000,
				endTimeMs: 11_000,
				accumulatedPausedDurationMs: 2_500,
			}),
		).toBe(7_500);
	});

	it("subtracts an active pause interval", () => {
		expect(
			getEffectiveRecordingDurationMs({
				startTimeMs: 1_000,
				endTimeMs: 11_000,
				accumulatedPausedDurationMs: 2_000,
				pauseStartedAtMs: 9_000,
			}),
		).toBe(6_000);
	});
});

describe("getMediaSyncPlaybackRate", () => {
	it("returns the base rate when drift is within tolerance", () => {
		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10,
				targetTime: 10.01,
			}),
		).toBe(1);
	});

	it("nudges playback rate toward the target time", () => {
		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10,
				targetTime: 10.1,
			}),
		).toBeCloseTo(1.05);

		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10.1,
				targetTime: 10,
			}),
		).toBeCloseTo(0.95);
	});

	it("clamps oversized corrections", () => {
		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10,
				targetTime: 10.5,
			}),
		).toBeCloseTo(1.08);
	});
});

describe("resolveOverlayPlaybackRate — narration anti-warble", () => {
	// Narration is pitch-preserved SPEECH. Drift-correcting its playback rate
	// (getMediaSyncPlaybackRate) warbles the voice → "speaker tearing". Overlay
	// audio must therefore use a STABLE rate regardless of drift.
	it("REGRESSION: stays at the base rate for the SAME drifts that make getMediaSyncPlaybackRate swing", () => {
		// These drifts push getMediaSyncPlaybackRate to 1.05 / 0.95 / 1.08 (the warble).
		const driftCases = [
			{ currentTime: 10, targetTime: 10.1 },
			{ currentTime: 10.1, targetTime: 10 },
			{ currentTime: 10, targetTime: 10.5 },
		];
		for (const { currentTime, targetTime } of driftCases) {
			// getMediaSyncPlaybackRate DOES swing away from 1 (the cause of tearing)…
			expect(
				getMediaSyncPlaybackRate({ basePlaybackRate: 1, currentTime, targetTime }),
			).not.toBe(1);
			// …but the overlay rate is drift-independent → constant → no warble.
			expect(resolveOverlayPlaybackRate(1)).toBe(1);
		}
	});

	it("returns the base rate unchanged (e.g. a 2x clip-speed overlay)", () => {
		expect(resolveOverlayPlaybackRate(1)).toBe(1);
		expect(resolveOverlayPlaybackRate(2)).toBe(2);
		expect(resolveOverlayPlaybackRate(0.5)).toBe(0.5);
	});

	it("sanitizes invalid rates to 1", () => {
		expect(resolveOverlayPlaybackRate(0)).toBe(1);
		expect(resolveOverlayPlaybackRate(-1)).toBe(1);
		expect(resolveOverlayPlaybackRate(Number.NaN)).toBe(1);
		expect(resolveOverlayPlaybackRate(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("enablePitchPreservingPlayback", () => {
	it("enables standard and vendor pitch-preserve switches", () => {
		const media = {} as HTMLMediaElement & {
			preservesPitch?: boolean;
			mozPreservesPitch?: boolean;
			webkitPreservesPitch?: boolean;
		};

		enablePitchPreservingPlayback(media);

		expect(media.preservesPitch).toBe(true);
		expect(media.mozPreservesPitch).toBe(true);
		expect(media.webkitPreservesPitch).toBe(true);
	});
});

describe("getEffectiveVideoStreamDurationSeconds", () => {
	it("prefers the video stream duration when present", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: 12,
				streamDuration: 11.2,
			}),
		).toBe(11.2);
	});

	it("uses the container duration when the video stream is much shorter", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: 60,
				streamDuration: 40,
			}),
		).toBe(60);
	});

	it("falls back to the container duration when stream duration is missing", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: 12,
				streamDuration: undefined,
			}),
		).toBe(12);
	});

	it("returns zero when neither duration is usable", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: Number.NaN,
				streamDuration: 0,
			}),
		).toBe(0);
	});
});
