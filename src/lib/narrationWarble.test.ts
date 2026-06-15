import { describe, expect, it } from "vitest";
import { getMediaSyncPlaybackRate, resolveOverlayPlaybackRate } from "./mediaTiming";

// Signal-level reproduction of the "speaker tearing" the user heard.
//
// The narration element played at a per-frame DRIFT-CORRECTED rate
// (getMediaSyncPlaybackRate), which swings up to ±8% frame to frame. Playing an
// audio stream at a wobbling rate frequency-modulates it: a clean 300 Hz tone
// comes out with its pitch wobbling between ~276–324 Hz — audible as warble /
// "tearing" / noise. A FIXED rate (resolveOverlayPlaybackRate) plays the tone
// back at a single, stable frequency.
//
// This test MEASURES that frequency wobble directly (not just the rate value),
// so it actually captures the artifact and proves the fix removes it.

const FS = 48_000; // sample rate
const F0 = 300; // source tone frequency (Hz)
const FRAME_HZ = 30; // playback rate is re-evaluated ~per animation frame
const FRAME_SAMPLES = Math.round(FS / FRAME_HZ);
const FRAMES = 60; // ~2s

// Render `frames` of a sine played back under a per-frame rate schedule.
// rateFor(frameIndex) returns the playback rate applied during that frame.
function renderPlayback(rateFor: (frame: number) => number): Float64Array {
	const out = new Float64Array(FRAMES * FRAME_SAMPLES);
	let srcPos = 0; // position in the SOURCE signal (in samples)
	let i = 0;
	for (let frame = 0; frame < FRAMES; frame += 1) {
		const rate = rateFor(frame);
		for (let s = 0; s < FRAME_SAMPLES; s += 1) {
			out[i++] = Math.sin((2 * Math.PI * F0 * srcPos) / FS);
			srcPos += rate; // playing faster/slower advances the source faster/slower
		}
	}
	return out;
}

// Instantaneous frequency via SUB-SAMPLE interpolated zero crossings (no
// per-frame integer quantization). For each adjacent pair of upward crossings the
// frequency is FS / (period in samples); we return the standard deviation of those
// instantaneous frequencies (Hz). A clean tone → ~0; a frequency-modulated
// (wobbling) tone → large deviation. This is what "frequency/noise" means here.
function frequencyWobbleHz(signal: Float64Array): number {
	const upwardCrossings: number[] = []; // sub-sample positions of negative→positive crossings
	for (let s = 1; s < signal.length; s += 1) {
		if (signal[s - 1] < 0 && signal[s] >= 0) {
			const frac = signal[s - 1] / (signal[s - 1] - signal[s]); // linear interp
			upwardCrossings.push(s - 1 + frac);
		}
	}
	if (upwardCrossings.length < 3) return 0;
	const freqs: number[] = [];
	for (let i = 1; i < upwardCrossings.length; i += 1) {
		const periodSamples = upwardCrossings[i] - upwardCrossings[i - 1];
		freqs.push(FS / periodSamples);
	}
	const mean = freqs.reduce((a, b) => a + b, 0) / freqs.length;
	const variance = freqs.reduce((a, f) => a + (f - mean) ** 2, 0) / freqs.length;
	return Math.sqrt(variance);
}

// A realistic narration drift: the element keeps drifting, so the drift-corrector
// oscillates (overshoots), producing the alternating ±8% swing frame to frame.
function driftCorrectedRate(frame: number): number {
	// Alternate the drift sign each frame so the corrector swings both ways.
	const targetTime = 10;
	const currentTime = frame % 2 === 0 ? 9.5 : 10.5; // ±0.5s drift → ±8% clamp
	return getMediaSyncPlaybackRate({ basePlaybackRate: 1, currentTime, targetTime });
}

describe("narration playback — frequency wobble (the 'speaker tearing')", () => {
	it("REPRO: the OLD drift-corrected rate frequency-modulates the tone (audible wobble)", () => {
		const wobble = frequencyWobbleHz(renderPlayback(driftCorrectedRate));
		// 300 Hz × (1 ± 0.08) ≈ ±24 Hz swing → large per-frame frequency deviation.
		expect(wobble).toBeGreaterThan(15);
	});

	it("FIX: the fixed overlay rate plays the tone at one stable frequency (no wobble)", () => {
		const wobble = frequencyWobbleHz(renderPlayback(() => resolveOverlayPlaybackRate(1)));
		// Only ±1 zero-crossing quantization noise remains → essentially flat.
		expect(wobble).toBeLessThan(2);
	});

	it("the fixed rate reproduces the source frequency faithfully (~300 Hz)", () => {
		const signal = renderPlayback(() => resolveOverlayPlaybackRate(1));
		// Mean frequency should land on F0.
		let crossings = 0;
		for (let s = 1; s < signal.length; s += 1) {
			if ((signal[s - 1] < 0 && signal[s] >= 0) || (signal[s - 1] >= 0 && signal[s] < 0)) {
				crossings += 1;
			}
		}
		const totalSeconds = signal.length / FS;
		const measuredHz = crossings / 2 / totalSeconds;
		expect(measuredHz).toBeGreaterThan(F0 - 5);
		expect(measuredHz).toBeLessThan(F0 + 5);
	});
});
