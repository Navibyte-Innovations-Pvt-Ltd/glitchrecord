import { describe, expect, it } from "vitest";

import { planClipDelete } from "./clipDelete";
import { carveSpeedRegion } from "./clipRetime";
import {
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
	clipsToTrims,
	getClipSourceSpans,
	type SpeedRegion,
	type ZoomRegion,
} from "./types";

// Reproduces the user's report: a sped-up clip (21.55×) could not be deleted —
// "Delete" reverted its speed to 1× instead of removing it, and because revert
// balloons a sped clip back to its full source width, the footage that was meant
// to be cut "reappeared" when the right edge was dragged. The fix routes delete
// through planClipDelete, which always REMOVES the clip (ripple-closing the gap),
// never reverts speed.

const clip = (id: string, startMs: number, endMs: number, speed = 1): ClipRegion => ({
	id,
	startMs,
	endMs,
	speed,
});

describe("planClipDelete — removes a clip instead of reverting its speed", () => {
	it("deleting a 21.55× clip REMOVES it (the bug: it used to revert to 1×)", () => {
		const clips = [clip("a", 0, 1000), clip("b", 1000, 2000, 21.55), clip("c", 2000, 3000)];
		const plan = planClipDelete({
			clipRegions: clips,
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			audioRegions: [],
			clipId: "b",
			ripple: true,
		});
		expect(plan).not.toBeNull();
		const ids = plan!.clipRegions.map((c) => c.id);
		expect(ids).toEqual(["a", "c"]);
		// The sped clip is gone — NOT present at 1× with a ballooned width.
		expect(plan!.clipRegions.find((c) => c.id === "b")).toBeUndefined();
	});

	it("ripple closes the gap: clips after the deleted one shift left by its width", () => {
		const clips = [clip("a", 0, 1000), clip("b", 1000, 1500, 21.55), clip("c", 1500, 3000)];
		const plan = planClipDelete({
			clipRegions: clips,
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			audioRegions: [],
			clipId: "b",
			ripple: true,
		});
		// b spanned 1000–1500 (width 500). c was 1500–3000 → shifts to 1000–2500.
		const c = plan!.clipRegions.find((r) => r.id === "c")!;
		expect(c.startMs).toBe(1000);
		expect(c.endMs).toBe(2500);
		// No gap between a's end and c's new start.
		const a = plan!.clipRegions.find((r) => r.id === "a")!;
		expect(c.startMs).toBe(a.endMs);
	});

	it("ripple: false leaves the footage hole (no shift)", () => {
		const clips = [clip("a", 0, 1000), clip("b", 1000, 1500), clip("c", 1500, 3000)];
		const plan = planClipDelete({
			clipRegions: clips,
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			audioRegions: [],
			clipId: "b",
			ripple: false,
		});
		const c = plan!.clipRegions.find((r) => r.id === "c")!;
		expect(c.startMs).toBe(1500);
		expect(c.endMs).toBe(3000);
	});

	it("regression: the deleted footage cannot reappear — total clip span shrinks", () => {
		const clips = [clip("a", 0, 1000), clip("b", 1000, 2000, 21.55), clip("c", 2000, 3000)];
		const before = clips.reduce((sum, c) => sum + (c.endMs - c.startMs), 0);
		const plan = planClipDelete({
			clipRegions: clips,
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			audioRegions: [],
			clipId: "b",
			ripple: true,
		});
		const after = plan!.clipRegions.reduce((sum, c) => sum + (c.endMs - c.startMs), 0);
		expect(after).toBe(before - 1000); // exactly b's width removed, nothing ballooned back
	});

	it("folds a retime group: deleting both contiguous members removes the whole effect", () => {
		// A speed point splits one clip into two contiguous members. handleClipDelete
		// folds planClipDelete over both ids; later members shift as earlier ones ripple.
		const clips = [
			clip("a", 0, 1000),
			{ ...clip("b1", 1000, 1500, 2), retimeGroupId: "g" },
			{ ...clip("b2", 1500, 2000, 4), retimeGroupId: "g" },
			clip("c", 2000, 3000),
		];
		let acc = {
			clipRegions: clips as ClipRegion[],
			zoomRegions: [] as ZoomRegion[],
			annotationRegions: [] as AnnotationRegion[],
			speedRegions: [] as SpeedRegion[],
			audioRegions: [] as AudioRegion[],
		};
		for (const id of ["b1", "b2"]) {
			const plan = planClipDelete({ ...acc, clipId: id, ripple: true });
			expect(plan).not.toBeNull();
			acc = plan!;
		}
		expect(acc.clipRegions.map((c) => c.id)).toEqual(["a", "c"]);
		// Both members (1000ms total) removed; c rippled from 2000 back to 1000.
		expect(acc.clipRegions.find((c) => c.id === "c")!.startMs).toBe(1000);
	});

	it("returns null for an unknown clip id", () => {
		expect(
			planClipDelete({
				clipRegions: [clip("a", 0, 1000)],
				zoomRegions: [],
				annotationRegions: [],
				speedRegions: [],
				audioRegions: [],
				clipId: "missing",
				ripple: true,
			}),
		).toBeNull();
	});
});

describe("planClipDelete — reflows clip-scoped effects and audio", () => {
	const zoom = (id: string, startMs: number, endMs: number): ZoomRegion =>
		({ id, startMs, endMs }) as ZoomRegion;
	const annotation = (id: string, startMs: number, endMs: number): AnnotationRegion =>
		({ id, startMs, endMs }) as AnnotationRegion;
	const speed = (id: string, startMs: number, endMs: number): SpeedRegion =>
		({ id, startMs, endMs }) as SpeedRegion;
	const audio = (id: string, startMs: number, endMs: number): AudioRegion =>
		({ id, startMs, endMs }) as AudioRegion;

	it("drops clip-scoped effects overlapping the deleted clip, ripples later ones", () => {
		const plan = planClipDelete({
			clipRegions: [clip("a", 0, 1000), clip("b", 1000, 2000), clip("c", 2000, 3000)],
			zoomRegions: [zoom("z-before", 100, 400), zoom("z-inside", 1200, 1800), zoom("z-after", 2100, 2400)],
			annotationRegions: [annotation("n-after", 2500, 2700)],
			speedRegions: [speed("s-inside", 1100, 1900)],
			audioRegions: [],
			clipId: "b",
			ripple: true,
		});
		expect(plan!.zoomRegions.map((z) => z.id)).toEqual(["z-before", "z-after"]);
		const after = plan!.zoomRegions.find((z) => z.id === "z-after")!;
		expect(after.startMs).toBe(1100); // 2100 - 1000 ripple
		expect(after.endMs).toBe(1400);
		expect(plan!.speedRegions).toHaveLength(0); // overlapping speed zone dropped
		expect(plan!.annotationRegions[0].startMs).toBe(1500); // 2500 - 1000
	});

	it("keeps a narration that merely spans the deleted clip, only ripples it left", () => {
		const plan = planClipDelete({
			clipRegions: [clip("a", 0, 1000), clip("b", 1000, 2000), clip("c", 2000, 3000)],
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			audioRegions: [audio("narration", 0, 3000), audio("snippet", 1100, 1900)],
			clipId: "b",
			ripple: true,
		});
		const ids = plan!.audioRegions.map((r) => r.id);
		expect(ids).toContain("narration"); // spanning narration survives
		expect(ids).not.toContain("snippet"); // snippet fully inside is dropped
		// The spanning narration starts before the clip → not rippled (startMs < endMs).
		expect(plan!.audioRegions.find((r) => r.id === "narration")!.startMs).toBe(0);
	});
});

// User's report: carve a middle clip via shift+click, select it, delete it —
// the timeline shows it gone, but PLAYBACK/EXPORT still show the old footage.
// Root cause: ripple-delete shifts the trailing clip's TIMELINE position to
// close the gap. getClipSourceSpans/clipsToTrims used to INFER that clip's
// SOURCE position from the (now-closed) gap, so closing the gap made the cut
// undetectable — the trailing clip's footage was silently reassigned to
// whatever the deleted clip's old timeline slot maps to in the source, and the
// deleted clip's TRUE range was never actually cut. See sourceStartMs in
// types.ts (ClipRegion) — the fix anchors each clip's footage independently of
// its timeline position, so ripple can move the box without moving the video.
describe("planClipDelete — ripple-delete must not corrupt playback/export mapping", () => {
	it("deleting a carved middle clip trims exactly that footage, not the tail", () => {
		const original: ClipRegion[] = [{ id: "base", startMs: 0, endMs: 20_020, speed: 1 }];
		const carved = carveSpeedRegion(original, 6_006, 14_014, 1, () => `x-${Math.random()}`, "middle");

		const plan = planClipDelete({
			clipRegions: carved,
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			audioRegions: [],
			clipId: "middle",
			ripple: true,
		});
		expect(plan).not.toBeNull();

		// The trim must be exactly the deleted middle span — NOT the untouched tail.
		const trims = clipsToTrims(plan!.clipRegions, 20_020);
		expect(trims).toEqual([{ id: "trim-gap-1", startMs: 6_006, endMs: 14_014 }]);

		// The surviving trailing clip must still map to ITS true original footage
		// (14014–20020), regardless of where ripple moved it on the timeline.
		const spans = getClipSourceSpans(plan!.clipRegions);
		const survivor = spans.find((s) => s.timelineStartMs > 0);
		expect(survivor?.sourceStartMs).toBe(14_014);
		expect(survivor?.sourceEndMs).toBe(20_020);
	});
});
