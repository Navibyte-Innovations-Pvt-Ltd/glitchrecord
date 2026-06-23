/**
 * Decode an uploaded audio data URL and summarize its loudness over the card's
 * time window, for feeding into the AI animation prompt. The AI then designs the
 * animation to emphasize the louder moments / hit the beats. Renderer-only
 * (Web Audio API). Returns null if decoding fails.
 */

export interface AudioAnalysis {
	/** Loudness envelope: t (0..1 over the card) → level (0..1, peak-normalized). */
	points: { t: number; level: number }[];
	/** Times (0..1) of energy peaks — natural emphasis/beat points. */
	beats: number[];
	/** Seconds of audio analyzed (min of clip length and the cap). */
	durationSec: number;
	/** Full length of the uploaded clip in seconds. */
	fullDurationSec: number;
	/** Suggested card durationMs so the animation spans the analyzed music. */
	recommendedDurationMs: number;
	/** Plain-language structure summary for the AI to reason about. */
	summary: string;
}

const BUCKETS = 32;

/**
 * Analyze the music over the first `capMs` (default = max card length) of the
 * clip, so the AI sees the whole usable track and can set the card duration to
 * match. `t` in the result is normalized over the analyzed window.
 */
export async function analyzeAudio(dataUrl: string, capMs = 8000): Promise<AudioAnalysis | null> {
	try {
		const resp = await fetch(dataUrl);
		const buf = await resp.arrayBuffer();
		const Ctx =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctx) return null;
		const ctx = new Ctx();
		const audio = await ctx.decodeAudioData(buf);
		await ctx.close().catch(() => undefined);

		const channel = audio.getChannelData(0);
		const sampleRate = audio.sampleRate;
		const cardSec = Math.min(capMs / 1000, audio.duration);
		const totalSamples = Math.max(1, Math.floor(cardSec * sampleRate));
		const per = Math.max(1, Math.floor(totalSamples / BUCKETS));

		const rms: number[] = [];
		let max = 1e-6;
		for (let b = 0; b < BUCKETS; b++) {
			const start = b * per;
			const end = Math.min(totalSamples, start + per);
			let sum = 0;
			for (let i = start; i < end; i++) {
				sum += channel[i] * channel[i];
			}
			const value = Math.sqrt(sum / Math.max(1, end - start));
			rms.push(value);
			if (value > max) max = value;
		}

		const points = rms.map((v, b) => ({
			t: Number((b / (BUCKETS - 1)).toFixed(2)),
			level: Number((v / max).toFixed(2)),
		}));

		const mean = rms.reduce((a, c) => a + c, 0) / rms.length;
		const beats: number[] = [];
		for (let b = 1; b < BUCKETS - 1; b++) {
			if (rms[b] > rms[b - 1] && rms[b] >= rms[b + 1] && rms[b] > mean * 1.1) {
				beats.push(Number((b / (BUCKETS - 1)).toFixed(2)));
			}
		}

		const summary = describeStructure(rms, beats.length);
		return {
			points,
			beats,
			durationSec: Number(cardSec.toFixed(2)),
			fullDurationSec: Number(audio.duration.toFixed(2)),
			recommendedDurationMs: Math.round(cardSec * 1000),
			summary,
		};
	} catch {
		return null;
	}
}

/** Heuristic plain-language description of the energy structure. */
function describeStructure(rms: number[], peakCount: number): string {
	const n = rms.length;
	if (n < 3) return "very short clip";
	const avg = (a: number, b: number) => {
		let s = 0;
		for (let i = a; i < b; i++) s += rms[i];
		return s / Math.max(1, b - a);
	};
	const third = Math.floor(n / 3);
	const startE = avg(0, third);
	const midE = avg(third, 2 * third);
	const endE = avg(2 * third, n);
	let maxIdx = 0;
	for (let i = 1; i < n; i++) if (rms[i] > rms[maxIdx]) maxIdx = i;
	const maxT = (maxIdx / (n - 1)).toFixed(2);

	const parts: string[] = [];
	if (endE > startE * 1.4 && endE >= midE) {
		parts.push(`steadily builds and is loudest near the end (climax ~t=${maxT})`);
	} else if (startE > endE * 1.4) {
		parts.push("starts strong then fades out");
	} else if (midE > startE * 1.3 && midE > endE * 1.3) {
		parts.push(`swells in the middle (peak ~t=${maxT}) then eases`);
	} else {
		parts.push("fairly steady energy throughout");
	}
	const quietStart = startE < 0.15;
	if (quietStart) parts.push("near-silent intro");
	parts.push(`${peakCount} accent hit${peakCount === 1 ? "" : "s"}`);
	return parts.join("; ");
}
