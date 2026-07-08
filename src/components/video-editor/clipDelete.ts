import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	ZoomRegion,
} from "./types";

// Deleting a clip CUTS its footage out of the timeline. It does NOT revert the
// clip's speed to 1× — the Speed panel's "1×" button already does that, and the
// old revert-on-delete behaviour ballooned a sped clip back to its full source
// width, which read to users as "the deleted video came back" (it never left).
//
// `ripple: true` closes the gap: every clip/effect that started AFTER the deleted
// clip shifts left by the clip's timeline width, so the following footage butts
// up against the preceding clip (standard NLE ripple-delete). `ripple: false`
// leaves a hole (the playhead simply skips the removed span).

export interface ClipDeletePlan {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
}

type Spannable = { startMs: number; endMs: number };

// Drop / keep / ripple a list of timeline regions around a deleted span.
// `drop` decides which regions belonged to the deleted clip and must go:
//   - "overlap": clip-scoped effects (zoom/annotation/speed) — drop anything
//     that touches the deleted span at all.
//   - "contained": independent layers (audio/narration) — only drop a snippet
//     that lives ENTIRELY inside the deleted clip; a narration spanning the whole
//     timeline merely crosses the span and must survive.
function reflowRegions<T extends Spannable>(
	regions: T[],
	startMs: number,
	endMs: number,
	shift: number,
	drop: "overlap" | "contained",
): T[] {
	const result: T[] = [];
	for (const region of regions) {
		const fullyInside = region.startMs >= startMs && region.endMs <= endMs;
		const overlaps = region.startMs < endMs && region.endMs > startMs;
		if (drop === "contained" ? fullyInside : overlaps) {
			continue;
		}
		// Strictly after the deleted clip → ripple left to close the gap.
		if (region.startMs >= endMs) {
			result.push({ ...region, startMs: region.startMs - shift, endMs: region.endMs - shift });
		} else {
			result.push(region);
		}
	}
	return result;
}

export function planClipDelete(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
	clipId: string;
	ripple: boolean;
}): ClipDeletePlan | null {
	const { clipRegions, zoomRegions, annotationRegions, speedRegions, audioRegions, clipId, ripple } =
		params;

	const deleted = clipRegions.find((clip) => clip.id === clipId);
	if (!deleted) {
		return null;
	}

	const { startMs, endMs } = deleted;
	const width = Math.max(0, endMs - startMs);
	const shift = ripple ? width : 0;

	const nextClips: ClipRegion[] = [];
	for (const clip of clipRegions) {
		if (clip.id === clipId) continue;
		if (clip.startMs >= endMs) {
			// Ripple shifts TIMELINE position to close the gap, but the footage this
			// clip shows must NOT move. Lock in its true source anchor (falling back
			// to its CURRENT startMs, before the shift below) so a later derivation
			// can't mistake the shifted startMs for source position.
			nextClips.push({
				...clip,
				startMs: clip.startMs - shift,
				endMs: clip.endMs - shift,
				sourceStartMs: clip.sourceStartMs ?? clip.startMs,
			});
		} else {
			nextClips.push(clip);
		}
	}

	return {
		clipRegions: nextClips,
		zoomRegions: reflowRegions(zoomRegions, startMs, endMs, shift, "overlap"),
		annotationRegions: reflowRegions(annotationRegions, startMs, endMs, shift, "overlap"),
		speedRegions: reflowRegions(speedRegions, startMs, endMs, shift, "overlap"),
		audioRegions: reflowRegions(audioRegions, startMs, endMs, shift, "contained"),
	};
}
