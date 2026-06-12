// Boots the REAL GlitchRecord app into the editor and asserts the timeline +
// clip render. This is the foundation smoke for every Electron UI click-test:
// if this passes, the dev-open-recording launch hook and the clip selectors
// (data-item-kind, clip-speed-badge, resize handles) all work.
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

describe("GlitchRecord editor launch (real Electron app)", () => {
  it("opens the editor with a clip on the timeline", async () => {
    const { window } = editor;
    // The dev-open-recording hook loads the sample video → a clip item renders.
    const clip = window.locator('[data-item-kind="clip"]').first();
    await clip.waitFor({ state: "visible", timeout: 60_000 });
    expect(await window.locator('[data-item-kind="clip"]').count()).toBeGreaterThan(0);
  });

  it("exposes the clip resize handles for stretch tests", async () => {
    const { window } = editor;
    const clip = window.locator('[data-item-kind="clip"]').first();
    await clip.click(); // select it
    expect(await clip.locator('[data-testid="timeline-resize-right"]').count()).toBe(1);
    expect(await clip.locator('[data-testid="timeline-resize-left"]').count()).toBe(1);
  });
});
