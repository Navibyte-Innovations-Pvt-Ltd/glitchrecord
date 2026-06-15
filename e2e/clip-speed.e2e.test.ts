// Drops two markers on the timeline via shift+click (the user's gesture) in the
// REAL editor and asserts a clip is CARVED — it splits into three pieces at the
// two markers. The carve is NEUTRAL (1x) by default; the user sets the speed
// afterwards (drag the carved edge / speed panel), so NO speed badge appears yet.
// The carve math is unit-tested in clipRetime.test.ts (`carveSpeedRegion`); this
// proves the shift+click gesture reaches it.
//
// Run with `bun run test:e2e:ui` — GlitchRecord dev MUST be closed (port 7337).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchEditor, type EditorApp } from "./helpers/electron";

let editor: EditorApp;

beforeAll(async () => {
  editor = await launchEditor();
}, 90_000);

afterAll(async () => {
  await editor?.close();
});

describe("Clip speed via shift+click markers (real editor)", () => {
  it("shift+clicking two points carves a neutral 1x segment (clip splits into 3)", async () => {
    const { window } = editor;
    const clips = window.locator('[data-item-kind="clip"]');
    await clips.first().waitFor({ state: "visible", timeout: 60_000 });
    await window.waitForTimeout(800);
    expect(await clips.count()).toBe(1);

    const canvas = window.locator('[data-testid="timeline-canvas"]').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("timeline canvas has no box");

    // Two shift+clicks in the axis strip (top — above the clip row so the click
    // lands on the canvas, not a clip child that stops propagation). Well apart
    // in time → carveSpeedRegion gets a span ≥ 100ms and splits the clip in three.
    // Hold Shift via the keyboard so the React synthetic event sees shiftKey.
    const y = box.y + 6;
    await window.keyboard.down("Shift");
    await window.mouse.click(box.x + box.width * 0.3, y);
    await window.mouse.click(box.x + box.width * 0.7, y);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(1000);

    // The clip is carved into before / carved / after.
    expect(await clips.count()).toBe(3);
    // The carve is NEUTRAL — no speed badge until the user changes the speed.
    expect(await window.locator('[data-testid="clip-speed-badge"]').count()).toBe(0);
  });
});
