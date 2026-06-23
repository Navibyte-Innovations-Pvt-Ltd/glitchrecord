import { describe, expect, it } from "vitest";
import type { AudioRegion } from "@/components/video-editor/types";
import { AudioProcessor } from "./audioEncoder";

// Access the private chunk scheduler the way the sibling test reaches internals.
type LoopSchedulerHarness = AudioProcessor & {
	scheduleLoopedRegionForChunk(
		ctx: OfflineAudioContext,
		buffer: AudioBuffer,
		region: AudioRegion,
		chunkOutputStartSec: number,
		chunkDurationSec: number,
	): void;
};

interface ScheduledSource {
	when: number;
	offset: number;
	duration: number;
	gainValue: number;
	curve: Float32Array | null;
}

// Minimal OfflineAudioContext stand-in that records what each buffer source was
// told to play. Enough to assert the loop iteration math (start time, buffer
// offset, clipped duration) without a real Web Audio implementation.
function makeRecordingCtx(scheduled: ScheduledSource[]): OfflineAudioContext {
	return {
		destination: {},
		createGain() {
			const node = {
				gain: {
					value: 1,
					setValueCurveAtTime(curve: Float32Array) {
						node.gain.value = Number.NaN; // marks "used a curve"
						pendingCurve = curve;
					},
				},
				connect() {},
			};
			let pendingCurve: Float32Array | null = null;
			// Expose the curve grab to the source via closure.
			(node as unknown as { _readCurve: () => Float32Array | null })._readCurve = () =>
				pendingCurve;
			return node as unknown as GainNode;
		},
		createBufferSource() {
			let connectedGain: {
				gain: { value: number };
				_readCurve: () => Float32Array | null;
			} | null = null;
			const src = {
				buffer: null as AudioBuffer | null,
				connect(node: unknown) {
					connectedGain = node as typeof connectedGain;
				},
				start(when: number, offset: number, duration: number) {
					const curve = connectedGain?._readCurve() ?? null;
					scheduled.push({
						when,
						offset,
						duration,
						gainValue: connectedGain ? connectedGain.gain.value : 1,
						curve,
					});
				},
			};
			return src as unknown as AudioBufferSourceNode;
		},
	} as unknown as OfflineAudioContext;
}

function fakeBuffer(durationSec: number): AudioBuffer {
	return { duration: durationSec, numberOfChannels: 2 } as AudioBuffer;
}

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("background-music loop scheduling", () => {
	const proc = new AudioProcessor() as unknown as LoopSchedulerHarness;

	const region: AudioRegion = {
		id: "background-music",
		audioPath: "/music.mp3",
		startMs: 0,
		endMs: 10_000, // 10s timeline
		volume: 0.5,
		normalize: false,
		loop: true,
		loopCrossfadeMs: 200,
	};
	// buffer 4s, crossfade 0.2s → each repeat advances by 3.8s.

	it("repeats the buffer to fill the region and clips the final repeat to the region end", () => {
		const scheduled: ScheduledSource[] = [];
		proc.scheduleLoopedRegionForChunk(
			makeRecordingCtx(scheduled),
			fakeBuffer(4),
			region,
			0,
			30,
		);

		// k = 0,1,2 → starts at 0, 3.8, 7.6 (k=3 would start at 11.4 ≥ 10 → stop).
		expect(scheduled.length).toBe(3);
		expect(scheduled.map((s) => Number(s.when.toFixed(3)))).toEqual([0, 3.8, 7.6]);
		// All repeats start at buffer offset 0.
		expect(scheduled.every((s) => close(s.offset, 0))).toBe(true);
		// First two play the full 4s; the last is clipped to the 10s region end (2.4s).
		expect(close(scheduled[0].duration, 4)).toBe(true);
		expect(close(scheduled[1].duration, 4)).toBe(true);
		expect(close(scheduled[2].duration, 2.4)).toBe(true);
	});

	it("continues a repeat seamlessly across a chunk boundary (correct phase offset)", () => {
		const chunkA: ScheduledSource[] = [];
		const chunkB: ScheduledSource[] = [];
		// Chunk A = [0,5], chunk B = [5,10].
		proc.scheduleLoopedRegionForChunk(makeRecordingCtx(chunkA), fakeBuffer(4), region, 0, 5);
		proc.scheduleLoopedRegionForChunk(makeRecordingCtx(chunkB), fakeBuffer(4), region, 5, 5);

		// In chunk A the 2nd repeat (starts at output 3.8) only plays [3.8,5] → 1.2s.
		const aSecond = chunkA.find((s) => close(s.when, 3.8));
		expect(aSecond).toBeDefined();
		expect(close(aSecond?.duration ?? -1, 1.2)).toBe(true);
		expect(close(aSecond?.offset ?? -1, 0)).toBe(true);

		// In chunk B that SAME repeat resumes from buffer offset 1.2 at chunk-local 0 —
		// no gap, no restart. This is the phase-offset the loop math must get right.
		const bResume = chunkB.find((s) => close(s.when, 0));
		expect(bResume).toBeDefined();
		expect(close(bResume?.offset ?? -1, 1.2)).toBe(true);
		expect(close(bResume?.duration ?? -1, 2.8)).toBe(true);
	});

	it("uses a hard-cut gapless loop when crossfade is 0 (constant gain, no curve)", () => {
		const scheduled: ScheduledSource[] = [];
		const noFade: AudioRegion = { ...region, loopCrossfadeMs: 0 };
		proc.scheduleLoopedRegionForChunk(
			makeRecordingCtx(scheduled),
			fakeBuffer(4),
			noFade,
			0,
			30,
		);

		// period = 4 → starts at 0,4,8; last clipped to 10s (2s).
		expect(scheduled.map((s) => Number(s.when.toFixed(3)))).toEqual([0, 4, 8]);
		// No crossfade → flat gain at baseGain (volume 0.5), no value curve.
		expect(scheduled.every((s) => s.curve === null)).toBe(true);
		expect(scheduled.every((s) => close(s.gainValue, 0.5))).toBe(true);
	});

	it("crossfade repeats schedule an equal-power gain curve peaking at baseGain", () => {
		const scheduled: ScheduledSource[] = [];
		proc.scheduleLoopedRegionForChunk(
			makeRecordingCtx(scheduled),
			fakeBuffer(4),
			region,
			0,
			30,
		);

		const curve = scheduled[1].curve; // an interior repeat fades in and out
		expect(curve).not.toBeNull();
		if (!curve) return;
		const peak = Math.max(...Array.from(curve));
		// Peak sits at baseGain (0.5); endpoints fade toward 0.
		expect(peak).toBeLessThanOrEqual(0.5 + 1e-6);
		expect(peak).toBeGreaterThan(0.45);
		expect(curve[0]).toBeLessThan(0.1);
	});
});
