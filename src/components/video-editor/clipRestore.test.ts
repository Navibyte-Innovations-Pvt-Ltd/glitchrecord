import { describe, expect, it } from "vitest";
import { getTrimmedTailMs, planRestoreTrimmedTail } from "./clipRestore";
import type { ClipRegion } from "./types";

const clip = (id: string, startMs: number, endMs: number, speed = 1): ClipRegion => ({
	id,
	startMs,
	endMs,
	speed,
});

describe("getTrimmedTailMs", () => {
	it("is 0 when clips cover the whole source", () => {
		const clips = [clip("a", 0, 10_000)];
		expect(getTrimmedTailMs(clips, 10_000)).toBe(0);
	});

	it("reports the leftover source past a trailing cut (1× clips)", () => {
		// One clip keeps 0..6000 of source; source is 10000 → 4000 trimmed tail.
		const clips = [clip("a", 0, 6_000)];
		expect(getTrimmedTailMs(clips, 10_000)).toBe(4_000);
	});

	it("accounts for speed when mapping clip → source coverage", () => {
		// A 2× clip spanning 0..3000 timeline consumes 0..6000 of source.
		const clips = [clip("a", 0, 3_000, 2)];
		expect(getTrimmedTailMs(clips, 10_000)).toBe(4_000);
	});

	it("equals the whole source when there are no clips", () => {
		expect(getTrimmedTailMs([], 10_000)).toBe(10_000);
	});
});

describe("planRestoreTrimmedTail", () => {
	it("appends a 1× clip covering the trimmed tail at the timeline end", () => {
		const clips = [clip("a", 0, 6_000)];
		const next = planRestoreTrimmedTail({
			clipRegions: clips,
			sourceDurationMs: 10_000,
			newClipId: "restore-1",
		});
		expect(next).not.toBeNull();
		expect(next).toHaveLength(2);
		// Original clip untouched.
		expect(next?.[0]).toEqual(clip("a", 0, 6_000));
		// New clip starts at the timeline end (6000) and runs the leftover 4000ms at 1×.
		expect(next?.[1]).toEqual({ id: "restore-1", startMs: 6_000, endMs: 10_000, speed: 1 });
	});

	it("appends past the timeline end even when clips slowed the footage", () => {
		// 2× clip: timeline 0..3000 = source 0..6000. Restore the remaining 4000ms
		// of source, appended at timeline 3000.
		const clips = [clip("a", 0, 3_000, 2)];
		const next = planRestoreTrimmedTail({
			clipRegions: clips,
			sourceDurationMs: 10_000,
			newClipId: "restore-1",
		});
		expect(next?.[1]).toEqual({ id: "restore-1", startMs: 3_000, endMs: 7_000, speed: 1 });
	});

	it("restores the whole recording as one clip when empty", () => {
		const next = planRestoreTrimmedTail({
			clipRegions: [],
			sourceDurationMs: 10_000,
			newClipId: "restore-1",
		});
		expect(next).toEqual([{ id: "restore-1", startMs: 0, endMs: 10_000, speed: 1 }]);
	});

	it("returns null when there is nothing to restore", () => {
		const clips = [clip("a", 0, 10_000)];
		expect(
			planRestoreTrimmedTail({
				clipRegions: clips,
				sourceDurationMs: 10_000,
				newClipId: "restore-1",
			}),
		).toBeNull();
	});

	it("returns null for a sub-frame remainder below minTailMs", () => {
		const clips = [clip("a", 0, 9_999)];
		expect(
			planRestoreTrimmedTail({
				clipRegions: clips,
				sourceDurationMs: 10_000,
				newClipId: "restore-1",
				minTailMs: 5,
			}),
		).toBeNull();
	});
});
