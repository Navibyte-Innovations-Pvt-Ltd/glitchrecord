// Exercises a real EDITING session in the GlitchRecord editor — the gestures the
// user wants the auto-editor to use: drop two shift+click markers to carve a
// speed segment, then a SECOND pair of markers to carve another. Verifies that
// multiple independent speed segments land on the timeline (each with a badge).
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

async function shiftMark(window: EditorApp["window"], xFrac: number) {
  const canvas = window.locator('[data-testid="timeline-canvas"]').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no timeline canvas");
  await window.keyboard.down("Shift");
  await window.mouse.click(box.x + box.width * xFrac, box.y + 6);
  await window.keyboard.up("Shift");
}

describe("GlitchRecord editing: multiple shift+click speed carves", () => {
  it("carves two independent speed segments via two pairs of markers", async () => {
    const { window } = editor;
    await window.locator('[data-item-kind="clip"]').first().waitFor({ state: "visible", timeout: 60_000 });

    // First edit: two markers → carve segment A.
    await shiftMark(window, 0.2);
    await shiftMark(window, 0.4);
    const badges = window.locator('[data-testid="clip-speed-badge"]');
    await badges.first().waitFor({ state: "visible", timeout: 10_000 });
    const afterFirst = await badges.count();
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    // Second edit: two more markers further along → carve segment B.
    await shiftMark(window, 0.6);
    await shiftMark(window, 0.8);
    await window.waitForTimeout(500);
    const afterSecond = await badges.count();

    // Two separate carves → at least two speed-badged segments on the timeline.
    expect(afterSecond).toBeGreaterThan(afterFirst);

    // Every badge shows a valid playback speed (the edits are real, not 1x).
    const texts = await badges.allTextContents();
    for (const t of texts) {
      expect(t.trim()).toMatch(/^(0\.25|0\.5|0\.75|1\.25|1\.5|1\.75|2|2\.5|3|4)x$/);
    }
  });

  it("changes a clip's speed directly from the speed panel", async () => {
    const { window } = editor;
    // Select a clip → the clip panel (with the speed grid) opens.
    const clip = window.locator('[data-item-kind="clip"]').first();
    await clip.waitFor({ state: "visible", timeout: 30_000 });
    await clip.click();

    // Click the 0.5× speed button → the clip slows to 0.5x.
    const half = window.locator('[data-testid="clip-speed-0.5"]').first();
    await half.waitFor({ state: "visible", timeout: 10_000 });
    await half.click();

    // The timeline clip badge reflects the new speed.
    const badge = window.locator('[data-testid="clip-speed-badge"]').first();
    await badge.waitFor({ state: "visible", timeout: 10_000 });
    expect((await badge.textContent())?.trim()).toBe("0.5x");
  });
});
