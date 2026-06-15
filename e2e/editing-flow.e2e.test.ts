// Exercises a real EDITING session in the GlitchRecord editor — the gestures the
// user wants the auto-editor to use: drop two shift+click markers to carve a
// segment (NEUTRAL 1x by default), then set its speed by dragging its edge, and
// carve a SECOND pair. Verifies multiple independent segments land on the
// timeline and that dragging a carved edge applies a real speed.
//
// Run with `bun run test:e2e:ui` — GlitchRecord dev MUST be closed (port 7337).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchEditor, type EditorApp } from "./helpers/electron";

let editor: EditorApp;

// Fresh editor per test — edits (carves/speed changes) accumulate on the
// timeline, so each test needs a clean clip to assert against.
beforeEach(async () => {
  editor = await launchEditor();
}, 90_000);

afterEach(async () => {
  await editor?.close();
});

async function shiftMark(window: EditorApp["window"], xFrac: number) {
  const canvas = window.locator('[data-testid="timeline-canvas"]').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no timeline canvas");
  await window.keyboard.down("Shift");
  await window.mouse.click(box.x + box.width * xFrac, box.y + 6);
  await window.keyboard.up("Shift");
}

describe("GlitchRecord editing: multiple shift+click speed carves", () => {
  it("carves two independent NEUTRAL segments via two pairs of markers", async () => {
    const { window } = editor;
    const clips = window.locator('[data-item-kind="clip"]');
    await clips.first().waitFor({ state: "visible", timeout: 60_000 });
    await window.waitForTimeout(800);
    expect(await clips.count()).toBe(1);

    // First edit: two markers → carve clip into before / carved / after = 3.
    await shiftMark(window, 0.2);
    await shiftMark(window, 0.4);
    await window.waitForTimeout(1000);
    const afterFirst = await clips.count();
    expect(afterFirst).toBe(3);

    // Second edit: two more markers further along → carve another piece.
    await shiftMark(window, 0.6);
    await shiftMark(window, 0.8);
    await window.waitForTimeout(1000);
    const afterSecond = await clips.count();
    expect(afterSecond).toBeGreaterThan(afterFirst); // second carve added segments

    // Carves are NEUTRAL (1x) by default — no speed badge until the user changes
    // a speed. (Setting a speed is covered by the drag + speed-panel tests below.)
    expect(await window.locator('[data-testid="clip-speed-badge"]').count()).toBe(0);
  });

  it("a carved segment can be SPEEDED by dragging its edge (squeeze→faster)", async () => {
    const { window } = editor;
    const canvas = window.locator('[data-testid="timeline-canvas"]').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas");

    // shift+click two markers → carve an internal segment (NEUTRAL 1x, no badge yet)
    await window.keyboard.down("Shift");
    await window.mouse.click(box.x + box.width * 0.32, box.y + 6);
    await window.waitForTimeout(400);
    await window.mouse.click(box.x + box.width * 0.55, box.y + 6);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(1000);
    const badges = window.locator('[data-testid="clip-speed-badge"]');
    expect(await badges.count()).toBe(0); // neutral carve → no speed badge yet

    // Drag that carved segment's RIGHT edge inward → it shrinks → ITS speed rises,
    // independently of the neighbouring 1x clips. This is the stretch→speed path.
    const seg = window.locator('[data-item-kind="clip"]').nth(1);
    const sb = await seg.boundingBox();
    if (!sb) throw new Error("no carved segment");
    // coordinate click (timeline clips fail Playwright's actionability checks)
    await window.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await window.waitForTimeout(600);
    const ex = sb.x + sb.width - 5, ey = sb.y + sb.height / 2;
    await window.mouse.move(ex, ey, { steps: 8 });
    await window.mouse.down(); await window.waitForTimeout(350);
    const tgt = sb.x + sb.width * 0.45;
    for (let i = 1; i <= 12; i++) { await window.mouse.move(ex + (tgt - ex) * i / 12, ey, { steps: 2 }); await window.waitForTimeout(45); }
    await window.mouse.up(); await window.waitForTimeout(1200);

    // The squeezed segment now shows a valid non-1x speed badge. Speed snaps to a
    // clean 0.05 grid now (e.g. "1.85x"), so accept any numeric speed ≠ 1x.
    await badges.first().waitFor({ state: "visible", timeout: 10_000 });
    const label = (await badges.first().textContent())?.trim() ?? "";
    expect(label).toMatch(/^\d+(\.\d+)?x$/);
    expect(label).not.toBe("1x");
  });

  // NOTE: the clip speed-preset panel was removed — speed is now set ONLY by
  // dragging a clip's edge (covered by the squeeze test above + clip-stretch.e2e).
  // The old "set speed from the panel" test was deleted with the panel.
});
