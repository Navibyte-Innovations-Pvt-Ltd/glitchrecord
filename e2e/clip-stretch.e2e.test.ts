// Stretching a shift+click speed-carve must re-speed THAT segment and conserve
// the rest of the footage — whether the user grabs the segment's own right edge
// OR the (invisible) shared seam with its right neighbour.
//
// REGRESSION: grabbing the seam used to route to the neighbour's left edge → it
// TRIMMED the neighbour (footage lost) and rippled the carved clip wider at a
// STALE speed (clip claimed more source than it had). Now carve auto-selects the
// carved segment and the seam-drag reroutes to its proven right-edge speed-change
// path (reflow, footage conserved). Both grabs must yield the SAME result.
//
// Run with `bun run test:e2e:ui` — GlitchRecord dev MUST be closed (port 7337).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchEditor, type EditorApp } from "./helpers/electron";

// Dedicated video so the auto-saved <video>.project.json is ours to read.
const VIDEO = path.join(os.tmpdir(), "gg-stretch-sample.mp4");
const PROJECT = `${VIDEO}.project.json`;
const SAMPLE_SRC = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../public/wallpapers/wispysky.mp4",
);

type Clip = { id: string; startMs: number; endMs: number; speed: number };
const width = (c?: Clip) => (c ? c.endMs - c.startMs : 0);
const source = (c?: Clip) => (c ? width(c) * c.speed : 0); // fixed source content
const readClips = () =>
	(JSON.parse(fs.readFileSync(PROJECT, "utf8")).editor.clipRegions ?? []) as Clip[];

let editor: EditorApp | null = null;
afterEach(async () => {
	await editor?.close();
	editor = null;
});

// Carve a neutral (1x) segment in the first third, then drag it wider (→ slow-mo);
// `grabOffset` selects
// WHERE on the carved clip's right edge the drag starts (-4 = inside the carved
// clip, +3 = on the neighbour side of the shared seam). Returns before/after clips.
async function carveThenStretch(grabOffset: number) {
	if (!fs.existsSync(VIDEO)) fs.copyFileSync(SAMPLE_SRC, VIDEO);
	fs.rmSync(PROJECT, { force: true });
	editor = await launchEditor({ videoPath: VIDEO });
	const win = editor.window;
	await win.locator('[data-item-kind="clip"]').first().waitFor({ state: "visible", timeout: 60_000 });
	await win.waitForTimeout(1200);

	const canvas = win.locator('[data-testid="timeline-canvas"]').first();
	const cbox = await canvas.boundingBox();
	if (!cbox) throw new Error("no canvas");
	await win.keyboard.down("Shift");
	await win.mouse.click(cbox.x + cbox.width * 0.2, cbox.y + 6);
	await win.waitForTimeout(400);
	await win.mouse.click(cbox.x + cbox.width * 0.35, cbox.y + 6);
	await win.keyboard.up("Shift");
	await win.waitForTimeout(1000);

	await win.keyboard.press("Meta+s").catch(() => {});
	await win.waitForTimeout(1500);
	const beforeClips = readClips();

	// Carve auto-selects the carved segment — DO NOT click it (a body click would
	// deselect, and the real flow grabs the seam straight after carving).
	const seg = win.locator('[data-item-kind="clip"]').nth(1);
	const sb = await seg.boundingBox();
	if (!sb) throw new Error("no carved segment");
	const ex = sb.x + sb.width + grabOffset;
	const ey = sb.y + sb.height / 2;
	await win.mouse.move(ex, ey, { steps: 6 });
	await win.mouse.down();
	await win.waitForTimeout(300);
	const tgt = sb.x + sb.width * 1.8;
	for (let i = 1; i <= 14; i++) {
		await win.mouse.move(ex + ((tgt - ex) * i) / 14, ey, { steps: 2 });
		await win.waitForTimeout(40);
	}
	await win.mouse.up();
	await win.waitForTimeout(1200);

	await win.keyboard.press("Meta+s").catch(() => {});
	await win.waitForTimeout(1800);
	return { beforeClips, afterClips: readClips() };
}

function assertStretch(beforeClips: Clip[], afterClips: Clip[]) {
	// The carve splits the clip into before / carved / after, all NEUTRAL 1x — the
	// carved segment is the MIDDLE one by timeline position (it starts 1x; the drag
	// below is what gives it a speed).
	const carvedBefore = [...beforeClips].sort((a, b) => a.startMs - b.startMs)[1];
	const carvedAfter = afterClips.find((c) => c.id === carvedBefore?.id);
	expect(carvedBefore, "a carved middle segment exists").toBeTruthy();
	expect(carvedBefore.speed, "carve is neutral 1x before the drag").toBe(1);
	expect(carvedAfter, "the carved segment survives").toBeTruthy();

	// Stretching wider must LOWER the speed and WIDEN the clip…
	expect(width(carvedAfter)).toBeGreaterThan(width(carvedBefore) + 50);
	expect(carvedAfter!.speed).toBeLessThan(carvedBefore!.speed);
	// …while the SOURCE content stays fixed (no inconsistent clip claiming source
	// it never had). width × speed is the source footage the segment plays.
	expect(Math.abs(source(carvedAfter) - source(carvedBefore))).toBeLessThan(150);

	// The right neighbour must SHIFT later, not get trimmed — its duration is
	// preserved (this is the footage-loss regression guard).
	const neighBefore = beforeClips.find((c) => c.startMs === carvedBefore!.endMs);
	const neighAfter = afterClips.find((c) => c.id === neighBefore?.id);
	expect(neighBefore, "a right neighbour exists").toBeTruthy();
	expect(neighAfter, "the neighbour survives").toBeTruthy();
	expect(neighAfter!.startMs).toBeGreaterThan(neighBefore!.startMs); // shifted later
	expect(Math.abs(width(neighAfter) - width(neighBefore))).toBeLessThan(150); // duration kept
}

describe("GlitchRecord: stretch a carved speed segment", () => {
	it("OWN EDGE: dragging the carved clip's right edge slows it, conserves footage", async () => {
		const { beforeClips, afterClips } = await carveThenStretch(-4);
		assertStretch(beforeClips, afterClips);
	}, 120_000);

	it("SEAM: dragging the shared seam re-speeds the carved clip (not a neighbour trim)", async () => {
		const { beforeClips, afterClips } = await carveThenStretch(3);
		assertStretch(beforeClips, afterClips);
	}, 120_000);
});
