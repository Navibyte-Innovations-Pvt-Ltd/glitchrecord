// "Trim to End" — delete everything from the playhead to the tail of the
// timeline in one action (the user's "cut the right side fully"). Applied to
// every range-shaped region list (clips, zooms, annotations, audio, speed):
//   • a region fully AFTER the cut  → removed
//   • a region SPANNING the cut     → kept, clipped to end at the cut
//   • a region fully BEFORE the cut → untouched
// Pure + list-in/list-out so it's trivially testable and reused across region types.

export interface TimeRange {
	startMs: number;
	endMs: number;
}

export function trimRangesToEnd<T extends TimeRange>(ranges: T[], cutMs: number): T[] {
	const cut = Math.round(cutMs);
	const result: T[] = [];
	for (const range of ranges) {
		if (range.startMs >= cut) continue; // fully after the cut → gone
		result.push(range.endMs > cut ? { ...range, endMs: cut } : range);
	}
	return result;
}
