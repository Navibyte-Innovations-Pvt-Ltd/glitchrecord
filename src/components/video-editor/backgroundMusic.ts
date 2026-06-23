// Timeline background-music bed: pure helpers to convert the persisted
// BackgroundMusicConfig into a looping AudioRegion at the export/preview
// boundary, and to normalize it on project load. Kept pure so the looping +
// span math is unit-testable without the editor.
import {
	type AudioRegion,
	type BackgroundMusicConfig,
	DEFAULT_BACKGROUND_MUSIC_CROSSFADE_MS,
	DEFAULT_BACKGROUND_MUSIC_VOLUME,
} from "./types";

/** Stable region id so dedup/lookup can recognize the music bed. */
export const BACKGROUND_MUSIC_REGION_ID = "background-music";

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

/**
 * Build the looping AudioRegion for the music bed. It spans the whole OUTPUT
 * timeline ([0, timelineDuration]) — NOT the source file length — so trims and
 * speed edits that change the output length keep the music covering the video.
 * Returns null when there's no music configured.
 */
export function buildBackgroundMusicRegion(
	config: BackgroundMusicConfig | null | undefined,
	timelineDurationSec: number,
): AudioRegion | null {
	if (!config || !config.audioPath) return null;
	const endMs = Math.max(1, Math.round(timelineDurationSec * 1000));
	return {
		id: BACKGROUND_MUSIC_REGION_ID,
		audioPath: config.audioPath,
		startMs: 0,
		endMs,
		volume: clamp01(config.volume),
		normalize: false,
		loop: true,
		loopCrossfadeMs: Math.max(0, Math.round(config.loopCrossfadeMs)),
	};
}

/** Normalize a persisted/untrusted value into a BackgroundMusicConfig or null. */
export function normalizeBackgroundMusic(value: unknown): BackgroundMusicConfig | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Partial<BackgroundMusicConfig>;
	if (typeof raw.audioPath !== "string" || raw.audioPath.trim().length === 0) {
		return null;
	}
	return {
		audioPath: raw.audioPath,
		volume:
			typeof raw.volume === "number" && Number.isFinite(raw.volume)
				? clamp01(raw.volume)
				: DEFAULT_BACKGROUND_MUSIC_VOLUME,
		loopCrossfadeMs:
			typeof raw.loopCrossfadeMs === "number" && Number.isFinite(raw.loopCrossfadeMs)
				? Math.max(0, Math.round(raw.loopCrossfadeMs))
				: DEFAULT_BACKGROUND_MUSIC_CROSSFADE_MS,
		...(typeof raw.name === "string" && raw.name.trim().length > 0
			? { name: raw.name }
			: {}),
	};
}
