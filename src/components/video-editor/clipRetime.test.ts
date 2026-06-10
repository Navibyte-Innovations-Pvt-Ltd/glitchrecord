import { describe, expect, it } from "vitest";
import {
	RETIME_MAX_SPEED,
	RETIME_MIN_SPEED,
	getRetimeGroup,
	planRetimeDrag,
	planSpeedPointInsert,
	resolveInternalBoundaryDrag,
} from "./clipRetime";
import { type ClipRegion, getClipSourceSpans } from "./types";

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
