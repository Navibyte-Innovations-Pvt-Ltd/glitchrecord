# GlitchRecord — Testing

GlitchRecord is the Electron screen recorder/editor + the GlitchGrab bridge that
pairs with the Chrome extension. Small UI/pipeline bugs kept shipping because no
test exercised the real flow. The contract: **every bug gets a reproduction
scenario + a regression test, at the lowest layer that can actually catch it.**

## Test lanes

Three lanes, fastest first. Run the fast one constantly; the headed ones before
shipping anything that touches capture, the script panel, or the timeline.

### 1. Deterministic unit/integration — CI-safe, always run
`bun run test` (vitest, `vitest.config.ts`). Node env, no browser, no Electron.
Pure logic + the bridge protocol:

| File | Covers |
| --- | --- |
| `src/components/video-editor/clipSpeedChange.test.ts` | `snapStretchSpeed` (drag right handle → speed), `planClipSpeedChange` |
| `src/components/video-editor/clipRetime.test.ts` | `carveSpeedRegion` (shift+click two markers), speed-point retime math |
| `electron/glitchbridge/server.test.ts` | the REAL WS bridge driven like the extension (recording:start → event:live → events:upload) — lost/duplicate/stale-event bugs |
| `apps/web/lib/narration/parse-refine.test.ts` | the `---SCRIPT---` delimiter parser (run from `apps/web` with `bun test`) |

### 2. Real capture e2e — extension on a real page (headed, local)
`bun run test:e2e:capture` (vitest, `vitest.e2e.config.ts`). Launches a real
Chromium with the **real unpacked extension** loaded, acts on a local fixture
page, and asserts events flow through the real bridge:

```
real Chrome + extension → ws://localhost:7337 → real bridge → session.events
```

Headed only (MV3 service workers need a display). Files: `e2e/helpers/harness.ts`,
`e2e/fixtures/playground.html`, `e2e/capture.e2e.test.ts`.

### 3. Electron UI e2e — click the real app (headed, local)
`bun run test:e2e:ui` (vitest, `vitest.e2e.config.ts`). Launches the **real
GlitchRecord app** via Playwright `_electron` with the dev-open-recording hook
(`RECORDLY_DEV_OPEN_RECORDING_INPUT`) so it lands straight in the editor, then
clicks real buttons / drags handles:

| File | Covers |
| --- | --- |
| `e2e/editor-launch.e2e.test.ts` | app boots (dev-open recording), a clip renders, resize handles exist |
| `e2e/script-panel.e2e.test.ts` | GlitchGrab rail → Script Writer → refine chat → **Apply to script** lands the script in the narration box (the `---SCRIPT---` bug at the UI level; AI reply seeded by stubbing the refine IPC) |
| `e2e/clip-speed.e2e.test.ts` | **shift+click two markers** on the timeline → a speed segment is carved (badge appears) |

**Prereqs for lane 3:** the app must be built — `dist-electron/main.cjs` + `dist/index.html`.
Run `bun run build` once (or `bunx vite build --config vite.config.ts && bun run normalize:electron-main-cjs` for just the renderer + main). Rebuild after changing renderer code or `data-testid`s — the test launches the BUILT app, not source.

How the launch avoids common traps (in `e2e/helpers/electron.ts`):
- **Private `--user-data-dir`** per run → the app gets its own single-instance
  lock. Without it, ANY other unpackaged Electron app on the machine holds the
  shared default lock and GlitchRecord `app.quit()`s instantly on launch.
- **`GG_E2E=1`** env → the editor skips the "unsaved changes" close dialog so
  teardown closes cleanly (no blocking native modal, no leaked instances).
- Teardown SIGKILLs the process tree as a backstop so runs never leak GlitchRecord processes.

`bun run test:e2e` runs lanes 2 + 3 together. `bun run test` from the repo root
runs lane 1 across every package via Turbo.

## ⚠️ Headed lanes need the dev app CLOSED

GlitchRecord takes `requestSingleInstanceLock()` and the bridge binds **port
7337**. A running dev instance owns both, so a second launch (the test's) just
focuses the existing window and exits → every UI test dies at launch. Lane 2's
own bridge also can't bind 7337 while dev holds it.

The harness preflights this and fails with a clear message
(*"GlitchRecord is already running … Close the dev app"*). To run lanes 2/3:
**quit the dev GlitchRecord first**, run the lane, restart dev. CI runs lane 1
only.

## The bug → test → scenario workflow (every bug)

1. **Pick the lowest lane that reproduces it.**
   - Pure math / data transform (speed, retime, parse, dedup) → lane 1 unit test.
   - Capture/bridge protocol (events lost/duplicated/stale) → lane 1
     `server.test.ts`-style, or lane 2 if it needs the real extension/DOM.
   - UI wiring (button does nothing, panel not updating, handle not dragging) →
     lane 3 click-test.
2. **Write the reproduction as a fixture, not prose.** Capture the exact input
   that triggers the bug — the malformed AI string, the event sequence, the clip
   geometry — and name the test `BUG:`. Example: `parse-refine.test.ts` pins the
   literal `---\n\nSCRIPT---` model output.
3. **Make it fail** on the unfixed code, then fix, then it passes. The fixture
   stays forever as the regression guard.
4. If the bug lived inline in a React component (like the stretch→speed snap or
   `carveSpeedRegion` did), **extract the pure function** so it's testable in
   lane 1, then have the component call it. Don't test through the DOM what you
   can test as a function.

## Stable selectors for UI e2e

Use `data-testid` (text/title change with i18n):
`rail-section-<id>` (e.g. `rail-section-glitchgrab` opens the panel),
`gg-script-toggle`, `gg-generate-script`, `gg-use-ai-script`,
`gg-narration-textarea`, `gg-refine-input`, `gg-refine-send`, `gg-apply-script`;
timeline `timeline-canvas` (shift+click target), `data-item-kind="clip"`,
`timeline-resize-left` / `timeline-resize-right`, `clip-speed-badge`. Add a
`data-testid` when you write a click-test for new UI.

Note: the decorative clip resize handles aren't driven by raw mouse events
(dnd-timeline owns the pointer pipeline), so the clip-speed UI test uses the
shift+click marker gesture instead; the stretch→speed math is unit-tested in
`clipSpeedChange.test.ts`.

## Debugging the capture pipeline

Unified debug log (both extension + bridge append):
`~/Library/Application Support/GlitchRecord-dev/glitchgrab-debug.log` (dev). Read
it directly when capture breaks. `GLITCHBRIDGE_PORT` overrides the fixed 7337 so
unit tests don't collide with a running app.
