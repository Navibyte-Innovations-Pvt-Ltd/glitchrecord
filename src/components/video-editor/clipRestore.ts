import { getClipSourceSpans } from "./types";
import type { ClipRegion } from "./types";

// Deleting the end clips of a timeline cuts their footage out — but the SOURCE
// past the last clip's coverage then has no clip mapping it, so it vanishes from
// the timeline with no handle to grab (getTimelineDurationMs deliberately ends at
// the last clip, never flooring at source length). "Restore trimmed tail" brings
// that leftover source back as a single 1× clip appended at the timeline end.
//
// It is the inverse of the trailing cut: it re-covers [lastSourceEnd, source] by
// appending a clip [lastTimelineEnd, lastTimelineEnd + leftoverSource]. Because the
// clip is contiguous on the timeline and resumes at the next source ms,
// getClipSourceSpans maps it straight onto the leftover footage — no other state
// needs to change (derived trims, export, undo all flow from clipRegions).

/** Source ms past the last clip that no clip currently covers (0 if none). */
export function getTrimmedTailMs(clips: ClipRegion[], sourceDurationMs: number): number {
	const spans = getClipSourceSpans(clips);
	const lastSourceEnd = spans.length > 0 ? spans[spans.length - 1].sourceEndMs : 0;
	return Math.max(0, Math.round(sourceDurationMs) - lastSourceEnd);
}

/**
 * Append a 1× clip that re-covers the trimmed tail. Returns the new clipRegions,
 * or null when there is nothing to restore (tail <= `minTailMs`, default 1ms — a
 * sub-frame remainder isn't worth a clip). With no clips, restores the whole
 * recording as one clip.
 */
export function planRestoreTrimmedTail(params: {
	clipRegions: ClipRegion[];
	sourceDurationMs: number;
	newClipId: string;
	minTailMs?: number;
}): ClipRegion[] | null {
	const { clipRegions, sourceDurationMs, newClipId, minTailMs = 1 } = params;
	const spans = getClipSourceSpans(clipRegions);
	const lastTimelineEnd = spans.length > 0 ? spans[spans.length - 1].timelineEndMs : 0;
	const lastSourceEnd = spans.length > 0 ? spans[spans.length - 1].sourceEndMs : 0;
	const tailMs = getTrimmedTailMs(clipRegions, sourceDurationMs);
	if (tailMs < minTailMs) {
		return null;
	}
	const restored: ClipRegion = {
		id: newClipId,
		startMs: lastTimelineEnd,
		endMs: lastTimelineEnd + tailMs,
		speed: 1,
		// Appended at the TIMELINE tail, but its footage is whatever source the
		// last clip didn't cover — which may differ from lastTimelineEnd if an
		// earlier ripple-delete already desynced timeline position from source.
		sourceStartMs: lastSourceEnd,
	};
	return [...clipRegions, restored];
}
