// Reproduces the REAL user gesture: shift+click directly on the CLIP BODY (not
// the thin ruler strip above the rows, which clip-speed.e2e.test.ts targets and
// which sidesteps this bug entirely).
//
// Root cause: shift+click landing on a clip/zoom item engages dnd-kit's drag
// machinery. Its pointerup handler calls preventDefault(), which — per the
// Pointer Events spec — suppresses the browser's compatibility 'click' event
// for that whole interaction. TimelineCanvas's onShiftMarker used to run off
// 'click', so it silently never fired when the marker landed on an item (the
// common case — items tile the row, leaving almost no bare canvas). Item
// selection already dodges this exact class of bug by living on pointerdown
// instead of click (see Item.tsx's handleSelectPointerDown comment) — the fix
// mirrors that: onShiftMarker now runs on a capture-phase pointerdown on the
// timeline canvas, which fires before drag/click suppression can kick in.
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

describe("Clip speed via shift+click ON the clip body (real user gesture)", () => {
  it("shift+clicking twice on the clip itself carves a segment (clip splits into 3)", async () => {
    const { window } = editor;
    const clips = window.locator('[data-item-kind="clip"]');
    await clips.first().waitFor({ state: "visible", timeout: 60_000 });
    await window.waitForTimeout(800);
    expect(await clips.count()).toBe(1);

    const clipBox = await clips.first().boundingBox();
    if (!clipBox) throw new Error("clip has no box");

    // Click at the VERTICAL CENTER of the clip row — where a real user clicks —
    // not a few px from the top (that's the ruler strip the other test uses).
    const y = clipBox.y + clipBox.height / 2;
    await window.keyboard.down("Shift");
    await window.mouse.click(clipBox.x + clipBox.width * 0.3, y);
    await window.mouse.click(clipBox.x + clipBox.width * 0.7, y);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(1000);

    expect(await clips.count()).toBe(3);
  });
});
