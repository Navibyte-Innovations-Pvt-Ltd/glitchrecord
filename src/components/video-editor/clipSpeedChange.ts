import type { ClipRegion, PlaybackSpeed, ZoomRegion } from "./types";

export type ClipSpeedChangeBlockReason = "clip-overlap" | "zoom-overlap";

// Manual clip-speed control (the +/− steppers + typable number box that replaced
// the preset grid). Free adjustment, but SNAPPED to a clean 0.05 grid so values
// are always 0.1, 0.15, 0.2 … never 0.1345.
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 30;
export const SPEED_STEP = 0.05;

/**
 * Clamp to [SPEED_MIN, SPEED_MAX] and snap to the nearest 0.05, returning a clean
 * 2-decimal number (no float drift like 0.15000000000000002). Non-finite input
 * falls back to 1.
 */
export function snapClipSpeed(value: number): number {
	if (!Number.isFinite(value)) return 1;
	const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
	const snapped = Math.round(clamped / SPEED_STEP) * SPEED_STEP;
	return Number(snapped.toFixed(2));
}

// The speeds a clip's right-edge resize can snap to. Stretching the clip wider
// lowers the speed (slow-mo); squeezing it narrower raises the speed.
export const CLIP_SPEEDS: PlaybackSpeed[] = [
	0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];

// Right-edge resize → playback speed. The clip's SOURCE content is fixed; the
// new timeline width sets the speed (speed = source / width), snapped to the
// clean 0.05 grid (0.1 … 30) so the user gets free values like 0.1, 0.15, 0.2 —
// NOT the old fixed presets. Stretch right (wider) → lower speed; squeeze
// (narrower) → higher speed. Clamps mirror the editor: source ≥ 1ms, width ≥ 50ms.
export function snapStretchSpeed(sourceContentMs: number, newWidthMs: number): number {
	const source = Math.max(1, sourceContentMs);
	const width = Math.max(50, newWidthMs);
	return snapClipSpeed(source / width);
}

export interface ClipSpeedChangePlan {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
}

export interface BlockedClipSpeedChange {
	blockedReason: ClipSpeedChangeBlockReason;
}

export function formatClipSpeedLabel(speed: number): string | null {
	if (!Number.isFinite(speed) || speed <= 0 || speed === 1) {
		return null;
	}

	return `${Number.isInteger(speed) ? speed.toFixed(0) : speed.toString()}x`;
}

export function planClipSpeedChange(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	selectedClipId: string;
	speed: number;
}): ClipSpeedChangePlan | BlockedClipSpeedChange | null {
	const { clipRegions, zoomRegions, selectedClipId, speed } = params;
	if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) {
		return null;
	}

	const clip = clipRegions.find((candidate) => candidate.id === selectedClipId);
	if (!clip) {
		return null;
	}

	const oldSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const oldEndMs = clip.endMs;
	const sourceDurationMs = Math.max(0, oldEndMs - clip.startMs) * oldSpeed;
	const newEndMs = Math.round(clip.startMs + sourceDurationMs / speed);
	// How much this clip's timeline duration changes. Slowing → positive (grows),
	// speeding → negative (shrinks). Everything AFTER the clip shifts by this so
	// nothing overlaps — the total video gets longer/shorter (time-remap).
	const delta = newEndMs - oldEndMs;
	const scaleFactor = oldSpeed / speed;

	const nextClipRegions = clipRegions.map((candidate) => {
		if (candidate.id === selectedClipId) {
			return { ...candidate, speed, endMs: newEndMs };
		}
		if (candidate.startMs >= oldEndMs) {
			return { ...candidate, startMs: candidate.startMs + delta, endMs: candidate.endMs + delta };
		}
		return candidate;
	});

	const nextZoomRegions = zoomRegions.map((zoom) => {
		// Inside the changed clip → scale around the clip start.
		if (zoom.startMs >= clip.startMs && zoom.startMs < oldEndMs) {
			return {
				...zoom,
				startMs: Math.round(clip.startMs + (zoom.startMs - clip.startMs) * scaleFactor),
				endMs: Math.round(clip.startMs + (zoom.endMs - clip.startMs) * scaleFactor),
			};
		}
		// After the changed clip → shift by delta to stay aligned.
		if (zoom.startMs >= oldEndMs) {
			return { ...zoom, startMs: zoom.startMs + delta, endMs: zoom.endMs + delta };
		}
		return zoom;
	});

	return { clipRegions: nextClipRegions, zoomRegions: nextZoomRegions };
}
