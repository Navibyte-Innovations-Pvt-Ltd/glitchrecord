import { type ClipRegion, type PlaybackSpeed, getClipSourceSpans, sortClipRegions } from "./types";

// Shift+click drops two markers; the span between them is carved into its own
// clip region at `speed`. Any region overlapping [a, b] is split so the carved
// region sits cleanly in the middle. Markers under 100ms apart are rejected by
// the caller (handleShiftMarker). Returns the new region list, sorted by start.
export function carveSpeedRegion(
	regions: ClipRegion[],
	a: number,
	b: number,
	speed: PlaybackSpeed,
	newId: () => string,
	carvedId?: string,
): ClipRegion[] {
	const start = Math.round(Math.min(a, b));
	const end = Math.round(Math.max(a, b));
	const out: ClipRegion[] = [];
	for (const r of regions) {
		if (r.endMs <= start || r.startMs >= end) {
			out.push(r);
			continue;
		}
		if (r.startMs < start) out.push({ ...r, id: newId(), endMs: start });
		if (r.endMs > end) out.push({ ...r, id: newId(), startMs: end });
	}
	// The carved region's id is returned to the caller (via `carvedId`) so it can
	// be auto-selected — selection is what lets the seam-drag reroute know which
	// segment the user means to re-speed. See handleClipSpanChange.
	out.push({ id: carvedId ?? newId(), startMs: start, endMs: end, speed });
	out.sort((x, y) => x.startMs - y.startMs);
	return out;
}

// DaVinci-style "speed point" retime math.
//
// A speed point is two contiguous clips sharing a `retimeGroupId`. The group
// occupies a FIXED timeline span [T0, T1] and consumes a FIXED source range
// [srcStart, srcEnd]. A pivot source frame `s` sits at the internal boundary.
// Moving the internal boundary to timeline position M re-times the two zones:
//
//   speedLeft  = (s - srcStart) / (M  - T0)
//   speedRight = (srcEnd - s)   / (T1 - M)
//
// Source consumed by the pair = (s - srcStart) + (srcEnd - s) = srcEnd - srcStart,
// which is INDEPENDENT of M. So the total timeline duration and every following
// clip's source position stay put — the redistribution is invisible to the
// cumulative-source model, playback, and export.

/** Speeds outside this range have no available export path; clamp the drag to it. */
export const RETIME_MIN_SPEED = 0.25;
export const RETIME_MAX_SPEED = 30;

export interface RetimeGroup {
	groupId: string;
	left: ClipRegion;
	right: ClipRegion;
}

/** The two clips of a retime group, ordered left→right by timeline start. */
export function getRetimeGroup(clips: ClipRegion[], groupId: string): RetimeGroup | null {
	const members = sortClipRegions(clips).filter((clip) => clip.retimeGroupId === groupId);
	if (members.length !== 2) {
		return null;
	}
	const [left, right] = members;
	// Must be (near-)contiguous on the timeline to be a valid speed point;
	// tolerate sub-ms rounding drift from repeated boundary drags.
	if (Math.abs(left.endMs - right.startMs) > 1) {
		return null;
	}
	return { groupId, left, right };
}

/** Find the retime group whose internal boundary sits at `boundaryMs`, if any. */
export function findRetimeGroupAtBoundary(
	clips: ClipRegion[],
	boundaryMs: number,
): RetimeGroup | null {
	const rounded = Math.round(boundaryMs);
	for (const clip of clips) {
		if (!clip.retimeGroupId) continue;
		const group = getRetimeGroup(clips, clip.retimeGroupId);
		if (group && group.left.endMs === rounded) {
			return group;
		}
	}
	return null;
}

/**
 * Insert a speed point into a single clip at timeline `markerMs`, splitting it
 * into a linked pair (both at the original speed). Returns the two clips, or
 * null if the marker is at/outside the clip's edges.
 */
export function planSpeedPointInsert(params: {
	clip: ClipRegion;
	markerMs: number;
	rightClipId: string;
	groupId: string;
}): { left: ClipRegion; right: ClipRegion } | null {
	const { clip, rightClipId, groupId } = params;
	const markerMs = Math.round(params.markerMs);
	if (markerMs <= clip.startMs || markerMs >= clip.endMs) {
		return null;
	}
	const left: ClipRegion = { ...clip, endMs: markerMs, retimeGroupId: groupId };
	const right: ClipRegion = {
		...clip,
		id: rightClipId,
		startMs: markerMs,
		retimeGroupId: groupId,
	};
	return { left, right };
}

/**
 * Decide whether an edge drag is moving the INTERNAL boundary of a retime group
 * (the seam between its two zones) — as opposed to an outer edge. Returns the
 * group id + the new boundary timeline position, or null to let the normal
 * clip-resize/trim path handle it. Lets the drag fire from either member (the
 * left clip's right edge OR the right clip's left edge).
 */
export function resolveInternalBoundaryDrag(params: {
	clips: ClipRegion[];
	draggedId: string;
	newStartMs: number;
	newEndMs: number;
}): { groupId: string; newBoundaryMs: number } | null {
	const { clips, draggedId, newStartMs, newEndMs } = params;
	const clip = clips.find((c) => c.id === draggedId);
	if (!clip?.retimeGroupId) {
		return null;
	}
	const group = getRetimeGroup(clips, clip.retimeGroupId);
	if (!group) {
		return null;
	}
	// Left member, right edge moved (start pinned) → boundary = newEnd.
	if (draggedId === group.left.id && newStartMs === group.left.startMs && newEndMs !== group.left.endMs) {
		return { groupId: group.groupId, newBoundaryMs: newEndMs };
	}
	// Right member, left edge moved (end pinned) → boundary = newStart.
	if (draggedId === group.right.id && newEndMs === group.right.endMs && newStartMs !== group.right.startMs) {
		return { groupId: group.groupId, newBoundaryMs: newStartMs };
	}
	return null;
}

/**
 * Dissolve a speed point back into ONE clip (remove the marker). The merged clip
 * keeps the group's original effective speed = total source consumed / total
 * timeline span — which is exactly the speed of the clip the point was inserted
 * into (1× if it was a normal clip). Returns the full updated clip array, or null
 * if the group isn't a valid pair.
 */
export function dissolveRetimeGroup(clips: ClipRegion[], groupId: string): ClipRegion[] | null {
	const group = getRetimeGroup(clips, groupId);
	if (!group) {
		return null;
	}
	const spans = getClipSourceSpans(clips);
	const leftSpan = spans.find((span) => span.clip.id === group.left.id);
	const rightSpan = spans.find((span) => span.clip.id === group.right.id);
	if (!leftSpan || !rightSpan) {
		return null;
	}
	const timelineSpan = group.right.endMs - group.left.startMs;
	const sourceSpan = rightSpan.sourceEndMs - leftSpan.sourceStartMs;
	const mergedSpeed = timelineSpan > 0 ? sourceSpan / timelineSpan : 1;
	const merged: ClipRegion = {
		...group.left,
		endMs: group.right.endMs,
		speed: mergedSpeed,
		retimeGroupId: undefined,
	};
	return clips.flatMap((clip) => {
		if (clip.id === group.left.id) return [merged];
		if (clip.id === group.right.id) return [];
		return [clip];
	});
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Drag the internal boundary of a retime group to timeline `newBoundaryMs`,
 * recomputing both zone speeds so the group's total duration and source range
 * stay constant. The boundary is clamped so both derived speeds stay within
 * [RETIME_MIN_SPEED, RETIME_MAX_SPEED]. Returns the full updated clip array, or
 * null if `groupId` is not a valid 2-clip contiguous group.
 */
export function planRetimeDrag(params: {
	clips: ClipRegion[];
	groupId: string;
	newBoundaryMs: number;
	minSpeed?: number;
	maxSpeed?: number;
}): ClipRegion[] | null {
	const { clips, groupId } = params;
	const minSpeed = params.minSpeed ?? RETIME_MIN_SPEED;
	const maxSpeed = params.maxSpeed ?? RETIME_MAX_SPEED;

	const group = getRetimeGroup(clips, groupId);
	if (!group) {
		return null;
	}

	const spans = getClipSourceSpans(clips);
	const leftSpan = spans.find((span) => span.clip.id === group.left.id);
	const rightSpan = spans.find((span) => span.clip.id === group.right.id);
	if (!leftSpan || !rightSpan) {
		return null;
	}

	const T0 = group.left.startMs;
	const T1 = group.right.endMs;
	const srcStart = leftSpan.sourceStartMs;
	const srcEnd = rightSpan.sourceEndMs;
	const s = leftSpan.sourceEndMs; // pivot source frame — stays fixed across drags
	const leftSource = s - srcStart;
	const rightSource = srcEnd - s;
	if (leftSource <= 0 || rightSource <= 0) {
		return null;
	}

	// Boundary ranges that keep each zone's speed within [minSpeed, maxSpeed].
	// speedLeft = leftSource / (M - T0) ∈ [min,max]  → M ∈ [T0 + leftSource/max, T0 + leftSource/min]
	// speedRight = rightSource / (T1 - M) ∈ [min,max] → M ∈ [T1 - rightSource/min, T1 - rightSource/max]
	const leftLo = T0 + leftSource / maxSpeed;
	const leftHi = T0 + leftSource / minSpeed;
	const rightLo = T1 - rightSource / minSpeed;
	const rightHi = T1 - rightSource / maxSpeed;
	// Snap inward to integers (ceil low / floor high) so the rounded-integer
	// boundary can never round back across a speed limit (INV-4).
	const lo = Math.ceil(Math.max(leftLo, rightLo));
	const hi = Math.floor(Math.min(leftHi, rightHi));
	if (lo > hi) {
		// The fixed total can't satisfy both zones within the speed range. Leave as-is.
		return null;
	}

	const boundaryMs = clamp(Math.round(params.newBoundaryMs), lo, hi);
	const speedLeft = leftSource / (boundaryMs - T0);
	const speedRight = rightSource / (T1 - boundaryMs);

	return clips.map((clip) => {
		if (clip.id === group.left.id) {
			return { ...clip, endMs: boundaryMs, speed: speedLeft };
		}
		if (clip.id === group.right.id) {
			return { ...clip, startMs: boundaryMs, speed: speedRight };
		}
		return clip;
	});
}
