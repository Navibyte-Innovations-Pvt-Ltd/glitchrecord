// When the editor TRIMS footage, the removed time ranges (`removedSegments`) are
// cut out and the timeline reflows left. Footage-anchored overlays (zoom,
// annotation, speed) are DELETED when their footage is cut — they belong to a
// specific moment that no longer exists. But a NARRATION/audio region is a free
// overlay laid over the timeline, not tied to source frames: deleting it just
// because it overlaps a trim made the whole voiceover vanish on any small edit.
//
// Instead, RIPPLE audio regions by the removed time: shift each region left by the
// removed time before it, and shrink it by removed time inside it. A region is
// dropped ONLY if it was entirely inside a cut (nothing left to play).

export interface TimeRange {
	startMs: number;
	endMs: number;
}

// Total removed duration strictly before timeline position `t`. A segment fully
// before t counts fully; a segment straddling t counts up to t; a segment fully
// after t counts zero.
function removedBefore(t: number, removed: TimeRange[]): number {
	return removed.reduce((acc, seg) => {
		if (seg.endMs <= t) return acc + (seg.endMs - seg.startMs);
		if (seg.startMs >= t) return acc;
		return acc + (t - seg.startMs);
	}, 0);
}

export function rippleAudioRegionsForRemovedSegments<T extends TimeRange>(
	regions: T[],
	removedSegments: TimeRange[],
): T[] {
	if (removedSegments.length === 0) return regions;
	const result: T[] = [];
	for (const region of regions) {
		const nextStart = Math.round(region.startMs - removedBefore(region.startMs, removedSegments));
		const nextEnd = Math.round(region.endMs - removedBefore(region.endMs, removedSegments));
		// Entirely inside a cut → nothing left to play, drop it.
		if (nextEnd <= nextStart) continue;
		result.push({ ...region, startMs: nextStart, endMs: nextEnd });
	}
	return result;
}
