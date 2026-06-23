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
	/** Seconds of audio covered (min of clip length and card duration). */
	durationSec: number;
}

const BUCKETS = 24;

export async function analyzeAudio(
	dataUrl: string,
	cardDurationMs: number,
): Promise<AudioAnalysis | null> {
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
		const cardSec = Math.min(cardDurationMs / 1000, audio.duration);
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

		return { points, beats, durationSec: Number(cardSec.toFixed(2)) };
	} catch {
		return null;
	}
}
