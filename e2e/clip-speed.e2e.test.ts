// Drops two markers on the timeline via shift+click (the user's gesture) in the
// REAL editor and asserts a clip-speed segment is carved — a speed badge
// appears. The carve math is unit-tested in clipRetime.test.ts
// (`carveSpeedRegion`); this proves the shift+click gesture reaches it.
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
  it("shift+clicking two points carves a speed segment (badge appears)", async () => {
    const { window } = editor;
    const canvas = window.locator('[data-testid="timeline-canvas"]').first();
    await canvas.waitFor({ state: "visible", timeout: 60_000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error("timeline canvas has no box");

    // Two shift+clicks in the axis strip (top — above the clip row so the click
    // lands on the canvas, not a clip child that stops propagation). Well apart
    // in time → carveSpeedRegion gets a span ≥ 100ms and inserts a 2x segment.
    // Hold Shift via the keyboard so the React synthetic event sees shiftKey.
    const y = box.y + 6;
    await window.keyboard.down("Shift");
    await window.mouse.click(box.x + box.width * 0.3, y);
    await window.mouse.click(box.x + box.width * 0.7, y);
    await window.keyboard.up("Shift");

    // A carved segment renders with a non-1x speed badge.
    const badge = window.locator('[data-testid="clip-speed-badge"]').first();
    await badge.waitFor({ state: "visible", timeout: 10_000 });
    expect((await badge.textContent())?.trim() ?? "").toMatch(
      /^(0\.25|0\.5|0\.75|1\.25|1\.5|1\.75|2|2\.5|3|4)x$/,
    );
  });
});
