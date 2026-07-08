// User's report: shift+click twice on a clip to carve a middle segment (which
// auto-selects it — see clipRetime.ts's carveSpeedRegion / VideoEditor's
// handleShiftMarker), then click the toolbar Delete button expecting THAT
// carved segment to go. Perceived: "it deletes somewhere end part instead".
//
// Investigated with source-level instrumentation (window.__ggDebugLog, since
// dev/prod builds strip console.log): the id reaching handleClipDelete IS the
// carved middle clip, and planClipDelete's pure ripple math (already covered
// in isolation by clipDelete.test.ts) is correct — the middle clip's footage
// is genuinely cut and the trailing clip ripples left to close the gap.
//
// What actually confused the user: useTimelineRange's `clampedRange` clamped
// the visible range's END to the new (now-smaller) totalMs whenever a delete
// shrunk the edited timeline. Since the default view already shows the WHOLE
// timeline, this re-fit the viewport to the shorter content, and every
// remaining clip visually WIDENED to fill it — easy to misread as "the wrong
// clip changed" even though the deleted footage was correct. Fixed in
// clampTimelineRange (timeline/core/time.ts): `end` no longer gets pulled
// down when totalMs shrinks, so the viewport keeps its scale and a delete
// looks like a normal NLE ripple (gap closes, nothing stretches).
//
// This test checks BOTH: the scale-independent signal (the two clips flanking
// the carved middle are each 6006ms; only removing the true middle — 8008ms —
// leaves two EQUAL-width survivors) AND that the fix held (surviving widths
// match their PRE-delete widths — no viewport re-fit/stretch).
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

describe("Delete after carving a speed segment via shift+click", () => {
  it("deletes the carved MIDDLE segment, not an end clip", async () => {
    const { window } = editor;
    const clips = window.locator('[data-item-kind="clip"]');
    await clips.first().waitFor({ state: "visible", timeout: 60_000 });
    await window.waitForTimeout(800);
    expect(await clips.count()).toBe(1);

    const clipBox = await clips.first().boundingBox();
    if (!clipBox) throw new Error("clip has no box");
    const y = clipBox.y + clipBox.height / 2;

    // Carve the middle third into its own segment — auto-selects it.
    await window.keyboard.down("Shift");
    await window.mouse.click(clipBox.x + clipBox.width * 0.3, y);
    await window.mouse.click(clipBox.x + clipBox.width * 0.7, y);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(1000);
    expect(await clips.count()).toBe(3);

    const boxesBefore = await clips.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    );
    const sortedBefore = [...boxesBefore].sort((a, b) => a.x - b.x);
    const [first] = sortedBefore;

    const deleteBtn = window.getByRole("button", { name: /delete selected clip/i });
    await deleteBtn.waitFor({ state: "visible", timeout: 10_000 });
    expect(await deleteBtn.isDisabled()).toBe(false); // carve must have auto-selected it
    await deleteBtn.click();
    await window.waitForTimeout(500);

    expect(await clips.count()).toBe(2);
    const boxesAfter = await clips.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    );
    const sortedAfter = [...boxesAfter].sort((a, b) => a.x - b.x);

    // Scale-independent: the two flanking clips were built equal-duration
    // (6006ms each) around a wider carved middle (8008ms). Only deleting the
    // true middle leaves two equal-width survivors, regardless of any
    // viewport re-fit triggered by the shrunk total duration.
    expect(Math.abs(sortedAfter[0].width - sortedAfter[1].width)).toBeLessThan(5);

    // The fix: the viewport must NOT re-fit/stretch. First clip's box is
    // pixel-identical to before, and the survivor ripples left to butt
    // against it (no gap) at the SAME scale — not a stretched, wider box.
    expect(Math.round(sortedAfter[0].x)).toBe(Math.round(first.x));
    expect(Math.round(sortedAfter[0].width)).toBe(Math.round(first.width));
    expect(Math.round(sortedAfter[1].x)).toBe(Math.round(first.x + first.width));
    expect(Math.round(sortedAfter[1].width)).toBe(Math.round(first.width));
  });
});
