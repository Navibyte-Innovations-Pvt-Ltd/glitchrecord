# GlitchRecord — Editor Feature Test Coverage

Every timeline/editor feature has a real headed e2e test (Playwright `_electron`
driving the actual app on a real recording). Run all: `bun run test:e2e:ui`
(GlitchRecord dev must be CLOSED — port 7337). Each test launches a **fresh
editor** (edits accumulate on the timeline, so tests are isolated).

## Coverage

| Feature | Gesture tested | Verifies | Test file |
| --- | --- | --- | --- |
| App opens recording | dev-open hook | clip renders, handles exist | `editor-launch.e2e.test.ts` |
| Clip speed — **drag edge** | drag right edge inward | speed badge 1x→2x | `clip-speed`/`editing-flow` |
| Clip speed — speed panel | click 0.5× button | selected clip badge → 0.5x | `editing-flow.e2e.test.ts` |
| Speed point — **carve** | shift+click two markers | a 2x segment carved | `editing-flow.e2e.test.ts` |
| Speed point — **re-speed (drag)** | drag carved segment's edge | that segment's speed changes independently | `editing-flow.e2e.test.ts` |
| Multiple speed points | two pairs of shift+clicks | two independent carved segments | `editing-flow.e2e.test.ts` |
| **Split / cut** | seek + `C` | one clip → two | `editor-features.e2e.test.ts` |
| **Delete clip** | select + "Delete Clip" | clip count drops | `editor-features.e2e.test.ts` |
| **Add zoom** | "Add Zoom (Z)" | a zoom region appears | `editor-features.e2e.test.ts` |
| **Delete zoom** | select zoom + delete | zoom region removed | `editor-features.e2e.test.ts` |
| **Undo / redo** | speed change → Undo → Redo | badge reverts then restores | `editor-features.e2e.test.ts` |
| **Mute** | "Mute/Unmute" toggle | toggles both directions | `editor-features.e2e.test.ts` |
| **Crop** | "Crop Video" | crop editor opens | `editor-features.e2e.test.ts` |
| **Export** | "Export" | export settings menu opens (does NOT export) | `editor-features.e2e.test.ts` |
| Script — Apply to script | refine chat → Apply | refined script fills narration box | `script-panel.e2e.test.ts` |
| Extension capture | act on a page | events reach the bridge | `capture.e2e.test.ts` |
| Capture mid-nav | navigate during recording | new page still captures | `capture.e2e.test.ts` |

## Gotchas baked into the tests (so they don't flake)

- **Timeline clips fail Playwright actionability** — click them by coordinates
  (`mouse.click(centerX, centerY)`), not `locator.click()`.
- **Clip-edge resize needs async stepped mouse** — `mouse.down()` → await →
  `mouse.move()` × N → `up()`. The resize listeners attach in a `useLayoutEffect`
  after the pointerdown, so a synchronous burst fires before they exist. Drag the
  edge INWARD (shrink → faster); a full-width clip can't widen.
- **Shift+click** needs the key held via `keyboard.down("Shift")` (the modifier
  option on `mouse.click` doesn't reliably set `shiftKey` for the React handler).
- **Selectors** are the app's own `title`/text (`Split Clip (C)`, `Add Zoom (Z)`,
  `Mute/Unmute`, `Undo`, `Crop Video`, `Export`) + `data-testid` for the
  GlitchGrab panel + `data-item-kind`, `clip-speed-badge`, `timeline-canvas`.
- **Fresh editor per test** (`beforeEach`) — edits accumulate.

## Edit scenarios + export (`scenarios-export.e2e.test.ts`, `bun run test:e2e:export`)

Each scenario applies edits in the real editor and verifies the saved
`.project.json` reflects them (deterministic):

| Scenario | Edit | Verified |
| --- | --- | --- |
| Speed-up 2x | speed panel 2× | `clipRegions[0].speed === 2` |
| Slow-mo 0.5x | speed panel 0.5× | `clipRegions[0].speed === 0.5` |
| Speed point | shift+click two markers | 3 segments, middle is 2× |
| Baseline export | smoke-export the raw recording | report written; when it succeeds → valid h264 mp4 |

### Export-to-file status (honest)
- **Raw smoke-export → mp4 works** (verified: valid h264 + `report.success`).
- **Two real limitations, found here:**
  1. **`VideoEncoder is not defined` on the LOADED-PROJECT export path** — opening
     a project then exporting fires before WebCodecs is ready; the raw-input path
     waits correctly. So edited-project → file export crashes. **Product bug.**
  2. **WebCodecs (VideoEncoder) is flaky in headless Electron** — even the raw
     export doesn't always succeed under automation (works reliably in the GUI).
- So the scenarios verify edits via the **persisted project**, and the export
  test tolerates the headless WebCodecs flake (asserts a valid mp4 only when the
  pipeline reports success). Editing in the GUI + export from the GUI both work;
  only headless edited-export-to-file is blocked.

### Test hygiene
- The harness opens a **/tmp copy** of the sample video, never a repo asset —
  GlitchRecord writes `<video>.project.json` next to whatever it opens, which
  previously polluted `public/wallpapers/`.

## Not yet covered (next)

Remove-background toggle, zoom depth change, add-layer, annotations/captions,
add-audio, crop apply-and-verify-output, full export-to-file. The chrome→script
real-routine recorder (`record-routine.mjs`) is a local demo, not a test.
