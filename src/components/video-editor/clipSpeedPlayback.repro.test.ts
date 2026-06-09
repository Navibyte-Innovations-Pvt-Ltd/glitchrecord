import { describe, expect, it } from "vitest";
import {
	type ClipRegion,
	clipsToTrims,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
} from "./types";

// Reproduces the "video freezes at the end of a slow-mo clip" bug.
//
// Manual repro in the app: record a clip, set part of it to 0.75x (slow-mo),
// then play across the end of that slow region — the video freezes on the last
// slow frame while the audio keeps playing.
//
// Root cause (asserted below): a speed != 1 clip followed by a normal clip
// leaves a SOURCE-time gap, because the next clip is anchored at its ORIGINAL
// source position instead of continuing from where the slow clip's source
// ended. That gap becomes a trim/skip region; the playback seek across it
// stalls the <video> element → freeze. The source↔timeline mapping is also
// discontinuous inside the gap.
//
// These tests encode the CORRECT (contiguous, content-preserving) behavior, so
// they fail against the current model and pass once it's fixed.
describe("slow-mo clip playback (repro)", () => {
	// 0.75x over timeline 0..15000, then normal clip to the end of a 108s source.
	const clips: ClipRegion[] = [
		{ id: "c1", startMs: 0, endMs: 15000, speed: 0.75 },
		{ id: "c2", startMs: 15000, endMs: 108000, speed: 1 },
	];

	it("does NOT create a skip/trim gap for a contiguous slow-mo clip", () => {
		// A slow-mo clip must not discard recording — there is no real cut here,
		// so clipsToTrims should produce no trim regions.
		const trims = clipsToTrims(clips, 108000);
		expect(trims).toEqual([]);
	});

	it("maps source time to timeline monotonically across the slow-mo boundary", () => {
		// Walking source time forward must never make the timeline jump backward.
		let prevTimeline = -1;
		for (let sourceMs = 0; sourceMs <= 20000; sourceMs += 250) {
			const timeline = mapSourceTimeToTimelineTime(sourceMs, clips);
			expect(timeline).toBeGreaterThanOrEqual(prevTimeline);
			prevTimeline = timeline;
		}
	});

	it("keeps source contiguous: the normal clip resumes where the slow clip's source ended", () => {
		// Slow clip 0..15000 timeline at 0.75x consumes 11250ms of source.
		// The next clip must continue from source 11250, not jump to 15000.
		const sourceAtBoundary = mapTimelineTimeToSourceTime(15000, clips);
		expect(sourceAtBoundary).toBe(11250);
		const sourceJustAfter = mapTimelineTimeToSourceTime(16000, clips);
		expect(sourceJustAfter).toBe(12250);
	});
});
