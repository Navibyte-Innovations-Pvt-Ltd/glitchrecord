// Clicking the toolbar Scissors button ("Split Clip (C)") should split the clip
// at the playhead — same underlying action as the "C" keyboard shortcut
// (already covered indirectly via trim-to-end.e2e.test.ts), but exercised via
// the actual button a real user clicks.
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

describe("Split Clip toolbar button (real user click)", () => {
  it("clicking the scissors button splits the clip at the playhead", async () => {
    const { window } = editor;
    const clips = window.locator('[data-item-kind="clip"]');
    await clips.first().waitFor({ state: "visible", timeout: 60_000 });
    await window.waitForTimeout(800);
    expect(await clips.count()).toBe(1);

    // Seek the playhead into the MIDDLE of the clip (not the very start — a
    // split marker exactly at a clip's own start/end boundary is a no-op by
    // design, per handleClipSplit's strict `splitMs > start && splitMs < end`).
    const canvas = window.locator('[data-testid="timeline-canvas"]').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("timeline canvas has no box");
    await window.mouse.click(box.x + box.width * 0.5, box.y + 6);
    await window.waitForTimeout(500);

    await window.locator('[title^="Split Clip"]').first().click();
    await window.waitForTimeout(800);

    expect(await clips.count()).toBe(2);
  });
});
