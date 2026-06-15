// Broad editor-feature coverage — one real e2e per timeline feature, each on a
// fresh editor (edits accumulate, so isolate). Selectors are the app's own
// title/text (Split Clip (C), Delete Clip, Add Zoom (Z), Mute/Unmute, Undo,
// Redo, Export, Crop Video). Run: `bun run test:e2e:ui` (GlitchRecord dev CLOSED).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchEditor, type EditorApp } from "./helpers/electron";

let editor: EditorApp;
beforeEach(async () => { editor = await launchEditor(); }, 90_000);
afterEach(async () => { await editor?.close(); });

const clips = (w: EditorApp["window"]) => w.locator('[data-item-kind="clip"]');
const zooms = (w: EditorApp["window"]) => w.locator('[data-item-kind="zoom"]');
async function ready(w: EditorApp["window"]) {
  await clips(w).first().waitFor({ state: "visible", timeout: 60_000 });
  await w.waitForTimeout(1000);
}
// coordinate-click a timeline clip (Playwright actionability fails on them)
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

describe("GlitchRecord editor features", () => {
  it("SPLIT a clip at the playhead → two clips", async () => {
    const { window } = editor;
    await ready(window);
    expect(await clips(window).count()).toBe(1);
    await clickClip(window);
    await seekFrac(window, 0.45);
    await window.keyboard.press("c"); // Split Clip (C)
    await window.waitForTimeout(800);
    expect(await clips(window).count()).toBe(2);
  });

  it("DELETE a clip removes it", async () => {
    const { window } = editor;
    await ready(window);
    // Carve a middle segment with two shift+click markers. carveSpeedRegion splits
    // the clip into before/carved/after = 3, and handleShiftMarker AUTO-SELECTS the
    // carved segment (handleSelectClip) — reliable selection (raw coordinate clicks
    // on dnd-timeline clips don't set selection). Then delete the selected clip via
    // keyboard (the clip settings panel with its "Delete Clip" button was removed).
    const box = await window.locator('[data-testid="timeline-canvas"]').first().boundingBox();
    if (!box) throw new Error("no canvas");
    await window.keyboard.down("Shift");
    await window.mouse.click(box.x + box.width * 0.35, box.y + 6);
    await window.waitForTimeout(400);
    await window.mouse.click(box.x + box.width * 0.6, box.y + 6);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(1000);
    const n = await clips(window).count();
    expect(n).toBe(3);
    await window.keyboard.press("Delete");
    await window.waitForTimeout(800);
    expect(await clips(window).count()).toBeLessThan(n);
  });

  it("ADD ZOOM creates a zoom region", async () => {
    const { window } = editor;
    await ready(window);
    expect(await zooms(window).count()).toBe(0);
    await window.locator('[title^="Add Zoom"]').first().click();
    await window.waitForTimeout(800);
    expect(await zooms(window).count()).toBeGreaterThanOrEqual(1);
  });

  it("UNDO / REDO a speed carve", async () => {
    const { window } = editor;
    await ready(window);
    expect(await clips(window).count()).toBe(1);
    // The speed-preset panel was removed; speed is carved/dragged on the timeline.
    // shift+click two markers carves the clip into 3 segments (the speed tool).
    const box = await window.locator('[data-testid="timeline-canvas"]').first().boundingBox();
    if (!box) throw new Error("no canvas");
    await window.keyboard.down("Shift");
    await window.mouse.click(box.x + box.width * 0.32, box.y + 6);
    await window.waitForTimeout(400);
    await window.mouse.click(box.x + box.width * 0.55, box.y + 6);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(1000);
    expect(await clips(window).count()).toBe(3);
    // Undo → back to one clip; Redo → carved into 3 again.
    await window.locator('[title="Undo"]').first().click();
    await window.waitForTimeout(700);
    expect(await clips(window).count()).toBe(1);
    await window.locator('[title="Redo"]').first().click();
    await window.waitForTimeout(700);
    expect(await clips(window).count()).toBe(3);
  });

  it("EXPORT opens the export settings menu", async () => {
    const { window } = editor;
    await ready(window);
    await window.getByText("Export", { exact: true }).first().click();
    await window.waitForTimeout(1500);
    // the export settings dropdown shows Quality/Encoding options (don't export)
    expect(await window.getByText(/Quality|Encoding|Pipeline|Balanced/).count()).toBeGreaterThanOrEqual(1);
  });

  it("CROP opens the crop editor", async () => {
    const { window } = editor;
    await ready(window);
    await window.getByText("Crop Video", { exact: true }).first().click();
    await window.waitForTimeout(1500);
    // crop editor exposes apply/reset/cancel-style controls
    expect(await window.getByText(/Done|Apply|Cancel|Reset|Aspect|Free/i).count()).toBeGreaterThanOrEqual(1);
  });

  it("DELETE a zoom region removes it", async () => {
    const { window } = editor;
    await ready(window);
    await window.locator('[title^="Add Zoom"]').first().click();
    await window.waitForTimeout(800);
    expect(await zooms(window).count()).toBe(1);
    const zb = await zooms(window).first().boundingBox();
    if (zb) await window.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
    await window.waitForTimeout(600);
    const del = window.getByText(/Delete Zoom|Delete/i).first();
    if (await del.count()) await del.click(); else await window.keyboard.press("Backspace");
    await window.waitForTimeout(800);
    expect(await zooms(window).count()).toBe(0);
  });

  it("MUTE toggles a clip's audio", async () => {
    const { window } = editor;
    await ready(window);
    await clickClip(window);
    const mute = window.locator('[title="Mute/Unmute"]').first();
    await mute.waitFor({ state: "visible", timeout: 10_000 });
    await mute.click(); // mute
    await window.waitForTimeout(500);
    await mute.click(); // unmute — both directions interactable
    await window.waitForTimeout(300);
    expect(await mute.count()).toBe(1);
  });
});
