import { describe, expect, it } from "vitest";

import { planClipDelete } from "./clipDelete";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	ZoomRegion,
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
