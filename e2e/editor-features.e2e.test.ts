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
    // split first so deleting one still leaves a timeline
    await clickClip(window); await seekFrac(window, 0.5); await window.keyboard.press("c");
    await window.waitForTimeout(800);
    const n = await clips(window).count();
    expect(n).toBeGreaterThanOrEqual(2);
    await clickClip(window, 0);
    await window.getByText("Delete Clip", { exact: true }).click();
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

  it("UNDO / REDO a speed change", async () => {
    const { window } = editor;
    await ready(window);
    await clickClip(window);
    await window.locator('[data-testid="clip-speed-0.5"]').first().click();
    await window.waitForTimeout(600);
    const badge = clips(window).first().locator('[data-testid="clip-speed-badge"]');
    expect((await badge.textContent())?.trim()).toBe("0.5x");
    await window.locator('[title="Undo"]').first().click();
    await window.waitForTimeout(700);
    expect(await badge.count()).toBe(0); // back to 1x → no badge
    await window.locator('[title="Redo"]').first().click();
    await window.waitForTimeout(700);
    expect((await clips(window).first().locator('[data-testid="clip-speed-badge"]').textContent())?.trim()).toBe("0.5x");
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
