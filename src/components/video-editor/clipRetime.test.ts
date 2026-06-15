import { describe, expect, it } from "vitest";
import {
	RETIME_MAX_SPEED,
	RETIME_MIN_SPEED,
	carveSpeedRegion,
	dissolveRetimeGroup,
	getRetimeGroup,
	planRetimeDrag,
	planSpeedPointInsert,
	resolveInternalBoundaryDrag,
} from "./clipRetime";
import { planClipSpeedChange } from "./clipSpeedChange";
import { type ClipRegion, getClipSourceSpans, mapTimelineTimeToSourceTime } from "./types";

// Shift+click on a clip drops two markers; the span between them is carved into
// its own speed region. This is the exact gesture from the editor (two markers,
// middle segment retimed).
describe("carveSpeedRegion (shift+click two markers)", () => {
	let n = 0;
	const newId = () => `clip-${++n}`;

	it("splits one clip into before / carved / after at the two markers", () => {
		n = 0;
		const regions: ClipRegion[] = [{ id: "base", startMs: 0, endMs: 30_000, speed: 1 }];
		const out = carveSpeedRegion(regions, 10_000, 20_000, 2, newId);
		expect(out).toHaveLength(3);
		expect(out.map((r) => [r.startMs, r.endMs])).toEqual([
			[0, 10_000],
			[10_000, 20_000],
			[20_000, 30_000],
		]);
		const carved = out.find((r) => r.startMs === 10_000);
		expect(carved?.speed).toBe(2); // the middle segment is retimed
		expect(carved?.endMs).toBe(20_000);
	});

	it("normalizes marker order (b dropped before a) to the same carve", () => {
		n = 0;
		const regions: ClipRegion[] = [{ id: "base", startMs: 0, endMs: 30_000, speed: 1 }];
		const forward = carveSpeedRegion(regions, 10_000, 20_000, 2, () => "x");
		n = 0;
		const reversed = carveSpeedRegion(regions, 20_000, 10_000, 2, () => "x");
		expect(reversed.map((r) => [r.startMs, r.endMs, r.speed])).toEqual(
			forward.map((r) => [r.startMs, r.endMs, r.speed]),
		);
	});

	it("keeps regions that don't overlap the carved span untouched", () => {
		n = 0;
		const regions: ClipRegion[] = [
			{ id: "a", startMs: 0, endMs: 5000, speed: 1 },
			{ id: "b", startMs: 5000, endMs: 30_000, speed: 1 },
		];
		const out = carveSpeedRegion(regions, 10_000, 20_000, 0.5, newId);
		// region "a" is fully left of the carve → preserved verbatim.
		expect(out.some((r) => r.id === "a" && r.startMs === 0 && r.endMs === 5000)).toBe(true);
		// stays sorted by start.
		const starts = out.map((r) => r.startMs);
		expect(starts).toEqual([...starts].sort((x, y) => x - y));
	});

	// The user-reported bug: "I add two markers and speed it up, but the part AFTER
	// the second marker also plays fast / wrong." Root cause: carving at 2× in place
	// makes the trailing clip's SOURCE start past where the carved part's source
	// ended — and past the recording itself. These tests pin the bug and the fix.
	it("REGRESSION: carving at 2× in place maps the trailing clip past the recording (the bleed)", () => {
		n = 0;
		const SOURCE = 30_000;
		const bad = carveSpeedRegion(
			[{ id: "base", startMs: 0, endMs: SOURCE, speed: 1 }],
			10_000,
			20_000,
			2,
			newId,
		);
		const maxSourceEnd = Math.max(...getClipSourceSpans(bad).map((s) => s.sourceEndMs));
		// 10s of PHANTOM footage beyond the real 30s recording → the player shows the
		// wrong (skipped-ahead/frozen) frames after the 2nd marker.
		expect(maxSourceEnd).toBe(40_000);
	});

	it("FIX: split at 1× then speed the carved middle (the editor flow) keeps source contiguous", () => {
		n = 0;
		const SOURCE = 30_000;
		const regions: ClipRegion[] = [{ id: "base", startMs: 0, endMs: SOURCE, speed: 1 }];
		// Exactly what handleShiftMarker now does: split at 1×, then planClipSpeedChange @2×.
		const split = carveSpeedRegion(regions, 10_000, 20_000, 1, newId, "carved");
		const plan = planClipSpeedChange({
			clipRegions: split,
			zoomRegions: [],
			selectedClipId: "carved",
			speed: 2,
		});
		expect(plan && "clipRegions" in plan).toBe(true);
		const clips = (plan as { clipRegions: ClipRegion[] }).clipRegions;

		// Nothing maps beyond the real recording — no phantom footage, no bleed.
		const maxSourceEnd = Math.max(...getClipSourceSpans(clips).map((s) => s.sourceEndMs));
		expect(maxSourceEnd).toBe(SOURCE);

		// Only the carved middle is fast; the parts before and after stay 1×.
		const carved = clips.find((c) => c.id === "carved");
		expect(carved?.speed).toBe(2);
		expect(clips.filter((c) => c.speed === 1)).toHaveLength(2);

		// The segment after the carve resumes at the 2nd marker's source (20s), NOT
		// skipped ahead — its content is unchanged, just shifted earlier in time.
		const after = clips.find((c) => carved && c.startMs === carved.endMs);
		expect(after).toBeDefined();
		if (after) {
			expect(mapTimelineTimeToSourceTime(after.startMs, clips)).toBe(20_000);
		}
	});
});

function sourceConsumed(clips: ClipRegion[]): number {
	const spans = getClipSourceSpans(clips);
	return spans.reduce((sum, span) => sum + (span.sourceEndMs - span.sourceStartMs), 0);
}

describe("clipRetime", () => {
	// A single 10s clip at 1x, then a normal clip after it.
	const baseClip: ClipRegion = { id: "c1", startMs: 0, endMs: 10_000, speed: 1 };
	const trailing: ClipRegion = { id: "c2", startMs: 10_000, endMs: 30_000, speed: 1 };

	describe("planSpeedPointInsert", () => {
		it("splits a clip into a linked pair at the same speed", () => {
			const result = planSpeedPointInsert({
				clip: baseClip,
				markerMs: 4_000,
				rightClipId: "c1b",
				groupId: "g1",
			});
			expect(result).not.toBeNull();
			expect(result?.left).toMatchObject({ id: "c1", startMs: 0, endMs: 4_000, speed: 1, retimeGroupId: "g1" });
			expect(result?.right).toMatchObject({ id: "c1b", startMs: 4_000, endMs: 10_000, speed: 1, retimeGroupId: "g1" });
		});

		it("rejects a marker on or outside the clip edges", () => {
			expect(planSpeedPointInsert({ clip: baseClip, markerMs: 0, rightClipId: "x", groupId: "g" })).toBeNull();
			expect(planSpeedPointInsert({ clip: baseClip, markerMs: 10_000, rightClipId: "x", groupId: "g" })).toBeNull();
			expect(planSpeedPointInsert({ clip: baseClip, markerMs: 12_000, rightClipId: "x", groupId: "g" })).toBeNull();
		});
	});

	describe("planRetimeDrag — invariants", () => {
		// Group: c1 [0..4000] + c1b [4000..10000], both 1x, contiguous. Trailing c2.
		const groupClips: ClipRegion[] = [
			{ id: "c1", startMs: 0, endMs: 4_000, speed: 1, retimeGroupId: "g1" },
			{ id: "c1b", startMs: 4_000, endMs: 10_000, speed: 1, retimeGroupId: "g1" },
			trailing,
		];
		const baselineSource = sourceConsumed(groupClips);

		it("INV-1: total timeline duration and source consumed stay constant for any boundary", () => {
			for (const M of [1_000, 2_500, 4_000, 6_000, 8_500, 9_000]) {
				const next = planRetimeDrag({ clips: groupClips, groupId: "g1", newBoundaryMs: M });
				expect(next).not.toBeNull();
				if (!next) continue;
				// Outer edges fixed → total timeline duration unchanged.
				const left = next.find((c) => c.id === "c1");
				const right = next.find((c) => c.id === "c1b");
				expect(left?.startMs).toBe(0);
				expect(right?.endMs).toBe(10_000);
				// Source consumed by the whole project is unchanged.
				expect(sourceConsumed(next)).toBeCloseTo(baselineSource, 0);
			}
		});

		it("INV-1: the trailing clip's source position never moves", () => {
			const trailingSource = (clips: ClipRegion[]) =>
				getClipSourceSpans(clips).find((s) => s.clip.id === "c2")?.sourceStartMs;
			const baseline = trailingSource(groupClips);
			for (const M of [1_500, 5_000, 8_000]) {
				const next = planRetimeDrag({ clips: groupClips, groupId: "g1", newBoundaryMs: M });
				expect(trailingSource(next ?? [])).toBe(baseline);
			}
		});

		it("INV-2: the two zones stay contiguous in timeline AND source after rounding", () => {
			for (const M of [1_234, 3_777, 7_001, 9_333]) {
				const next = planRetimeDrag({ clips: groupClips, groupId: "g1", newBoundaryMs: M });
				expect(next).not.toBeNull();
				if (!next) continue;
				const left = next.find((c) => c.id === "c1");
				const right = next.find((c) => c.id === "c1b");
				expect(left?.endMs).toBe(right?.startMs);
				const spans = getClipSourceSpans(next);
				const ls = spans.find((s) => s.clip.id === "c1");
				const rs = spans.find((s) => s.clip.id === "c1b");
				expect(ls?.sourceEndMs).toBe(rs?.sourceStartMs);
			}
		});

		it("direction: dragging the boundary LEFT makes the first zone faster, second slower", () => {
			const dragLeft = planRetimeDrag({ clips: groupClips, groupId: "g1", newBoundaryMs: 2_000 });
			const left = dragLeft?.find((c) => c.id === "c1");
			const right = dragLeft?.find((c) => c.id === "c1b");
			// pivot source s = 4000; left zone now 2000ms timeline for 4000ms source → 2x (faster)
			expect(left?.speed).toBeCloseTo(2, 5);
			// right zone 8000ms timeline for 6000ms source → 0.75x (slower)
			expect(right?.speed).toBeCloseTo(0.75, 5);
		});

		it("INV-4: extreme drags clamp both speeds into the exportable range", () => {
			for (const M of [10, 9_990]) {
				const next = planRetimeDrag({ clips: groupClips, groupId: "g1", newBoundaryMs: M });
				expect(next).not.toBeNull();
				if (!next) continue;
				for (const c of next) {
					if (c.retimeGroupId !== "g1") continue;
					expect(c.speed).toBeGreaterThanOrEqual(RETIME_MIN_SPEED - 1e-6);
					expect(c.speed).toBeLessThanOrEqual(RETIME_MAX_SPEED + 1e-6);
					expect(Number.isFinite(c.speed)).toBe(true);
					expect(c.speed).toBeGreaterThan(0);
				}
			}
		});

		it("resolveInternalBoundaryDrag detects the internal seam from either member", () => {
			// Left member, right edge dragged to 6000 (start pinned at 0).
			expect(
				resolveInternalBoundaryDrag({ clips: groupClips, draggedId: "c1", newStartMs: 0, newEndMs: 6_000 }),
			).toEqual({ groupId: "g1", newBoundaryMs: 6_000 });
			// Right member, left edge dragged to 2500 (end pinned at 10000).
			expect(
				resolveInternalBoundaryDrag({ clips: groupClips, draggedId: "c1b", newStartMs: 2_500, newEndMs: 10_000 }),
			).toEqual({ groupId: "g1", newBoundaryMs: 2_500 });
			// Outer edge (left member's left edge) → not an internal boundary.
			expect(
				resolveInternalBoundaryDrag({ clips: groupClips, draggedId: "c1", newStartMs: 500, newEndMs: 4_000 }),
			).toBeNull();
			// A clip with no group → null (normal resize path).
			expect(
				resolveInternalBoundaryDrag({ clips: groupClips, draggedId: "c2", newStartMs: 10_000, newEndMs: 25_000 }),
			).toBeNull();
		});

		it("dissolveRetimeGroup merges a 1x-origin group back into one 1x clip", () => {
			// groupClips were inserted on a 1x clip, then (here) left undragged at 1x.
			const merged = dissolveRetimeGroup(groupClips, "g1");
			expect(merged).not.toBeNull();
			if (!merged) return;
			// One merged clip [0..10000] at 1x, plus the trailing clip — no group left.
			const groupMembers = merged.filter((c) => c.retimeGroupId);
			expect(groupMembers).toHaveLength(0);
			const m = merged.find((c) => c.startMs === 0);
			expect(m).toMatchObject({ startMs: 0, endMs: 10_000 });
			expect(m?.speed).toBeCloseTo(1, 5);
			expect(merged.find((c) => c.id === "c2")).toBeTruthy();
		});

		it("dissolveRetimeGroup after a drag still merges to the original average speed", () => {
			// Drag the seam — zones get odd speeds (e.g. 2x / 0.75x) but total source
			// consumed is unchanged, so the merged speed returns to 1x.
			const dragged = planRetimeDrag({ clips: groupClips, groupId: "g1", newBoundaryMs: 2_000 });
			expect(dragged).not.toBeNull();
			const merged = dissolveRetimeGroup(dragged ?? [], "g1");
			const m = merged?.find((c) => c.startMs === 0);
			expect(m?.endMs).toBe(10_000);
			expect(m?.speed).toBeCloseTo(1, 5);
			expect(merged?.some((c) => c.retimeGroupId)).toBe(false);
		});

		it("returns null for a non-existent or non-contiguous group", () => {
			expect(planRetimeDrag({ clips: groupClips, groupId: "nope", newBoundaryMs: 5_000 })).toBeNull();
			const broken: ClipRegion[] = [
				{ id: "a", startMs: 0, endMs: 4_000, speed: 1, retimeGroupId: "g" },
				{ id: "b", startMs: 5_000, endMs: 10_000, speed: 1, retimeGroupId: "g" }, // gap
			];
			expect(getRetimeGroup(broken, "g")).toBeNull();
			expect(planRetimeDrag({ clips: broken, groupId: "g", newBoundaryMs: 4_500 })).toBeNull();
		});
	});
});
