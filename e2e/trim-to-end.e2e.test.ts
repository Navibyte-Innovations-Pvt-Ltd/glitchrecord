// Real Electron UI test for "Trim to End" — split the sample clip into pieces,
// seek the playhead into the middle, then cut everything to the right via the
// keyboard shortcut (E) AND the toolbar button, asserting the tail clips vanish.
// Run: `bun run test:e2e:ui` (GlitchRecord dev CLOSED — port 7337).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchEditor, type EditorApp } from "./helpers/electron";

let editor: EditorApp;
beforeEach(async () => { editor = await launchEditor(); }, 90_000);
afterEach(async () => { await editor?.close(); });

const clips = (w: EditorApp["window"]) => w.locator('[data-item-kind="clip"]');
async function ready(w: EditorApp["window"]) {
  await clips(w).first().waitFor({ state: "visible", timeout: 60_000 });
  await w.waitForTimeout(1000);
}
async function clickClip(w: EditorApp["window"], idx = 0) {
  const b = await clips(w).nth(idx).boundingBox();
  if (b) await w.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await w.waitForTimeout(500);
}
async function seekFrac(w: EditorApp["window"], frac: number) {
  const b = await w.locator('[data-testid="timeline-canvas"]').first().boundingBox();
  if (b) await w.mouse.click(b.x + b.width * frac, b.y + 6);
  await w.waitForTimeout(500);
}

describe("GlitchRecord — Trim to End (cut everything after the playhead)", () => {
  it("keyboard E removes the clips to the RIGHT of the playhead", async () => {
    const { window } = editor;
    await ready(window);
    expect(await clips(window).count()).toBe(1);
    // Split into three: [0–0.33] [0.33–0.66] [0.66–1].
    await clickClip(window);
    await seekFrac(window, 0.33); await window.keyboard.press("c");
    await window.waitForTimeout(600);
    await seekFrac(window, 0.66); await window.keyboard.press("c");
    await window.waitForTimeout(600);
    expect(await clips(window).count()).toBe(3);

    // Playhead into the MIDDLE clip, then Trim to End (E) → the third clip is gone,
    // the middle one is clipped at the playhead → 2 clips remain.
    await seekFrac(window, 0.5);
    await window.keyboard.press("e");
    await window.waitForTimeout(800);
    expect(await clips(window).count()).toBe(2);
  });

  it("toolbar Trim-to-End button cuts the tail and is UNDOable", async () => {
    const { window } = editor;
    await ready(window);
    // Split into two: [0–0.5] [0.5–1].
    await clickClip(window);
    await seekFrac(window, 0.5); await window.keyboard.press("c");
    await window.waitForTimeout(600);
    expect(await clips(window).count()).toBe(2);

    // Playhead at 0.25 (inside the first clip) → trim → only [0–0.25] survives.
    await seekFrac(window, 0.25);
    await window.locator('[title^="Trim to End"]').first().click();
    await window.waitForTimeout(800);
    expect(await clips(window).count()).toBe(1);

    // Undo restores the trimmed-away clips.
    await window.locator('[title="Undo"]').first().click();
    await window.waitForTimeout(800);
    expect(await clips(window).count()).toBeGreaterThanOrEqual(2);
  });
});
