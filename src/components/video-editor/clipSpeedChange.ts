import type { ClipRegion, ZoomRegion } from "./types";

export type ClipSpeedChangeBlockReason = "clip-overlap" | "zoom-overlap";

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
