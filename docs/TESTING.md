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

## ✅ Run tests — `test:fast` (quick) and `test:all` (everything incl. demo)

```
bun run test:fast     # lane 1 (unit) + every e2e test, one file at a time  (~3 min)
bun run test:all      # test:fast THEN demo:videos — the full pipeline       (~45–60 min)
```

- **`test:fast`** = unit + all e2e. Run this before declaring any feature/fix done.
- **`test:all`** = `test:fast` + **`demo:videos`** (lane 4 below) — the complete
  pass, including the real capture→narration→Sarvam→export pipeline producing 20
  videos (10 sites × 2). Heavy; needs the web API on :3000, a Sarvam key, and a
  login token. Run it before a release or after touching the narration/export path.

Both are **glob-driven, not a hand-maintained list** — a NEW test file is picked up
automatically with zero config edits:

- Lane 1 (`vitest.config.ts`) runs every `**/*.test.ts`.
- Lanes 2 + 3 (`vitest.e2e.config.ts`) run every `e2e/**/*.e2e.test.ts`, serially
  (`fileParallelism: false`, because the bridge/app bind the fixed port 7337).

**Never hardcode test file paths into a script** (the old `test:all` did, so new
e2e files silently never ran). Drop a `*.test.ts` (lane 1) or `*.e2e.test.ts`
(lanes 2/3) in the right place and it runs forever. The per-lane scripts
(`test:e2e:ui`, `test:e2e:capture`, `test:e2e:export`) stay only as targeted
shortcuts while iterating on one area.

**Before the headed lanes:** quit the dev GlitchRecord (frees port 7337) and build
the app + extension (`bun run build`; `packages/extension` `bun run build`). The
harness fails fast with a clear message if 7337 is held.

### 4. Full-pipeline demo — `demo:videos`
`bun run demo:videos` (`e2e/demo-videos.mjs`). Scans 10 real websites, and for each
runs the WHOLE flow: extension capture → DB session → DeepSeek narration script →
Sarvam Ritu voice → ffmpeg mux + captions → edited export. Output: 20 videos in
`demo-videos/` (`routine-<site>.mp4` browse+editing, `exported-<site>.mp4` edited).
Each site runs in its own spawned process (6-min timeout) so one crash can't cascade.
This is the end-to-end smoke for the narration/export pipeline; it's slow and needs
external services, so it's the demo lane of `test:all`, not `test:fast`.

## Standard for every new feature / fix (do this, every time)

1. **Write the test at the lowest lane that proves it** (see the bug→test→scenario
   workflow below). Pure logic → lane 1 unit test (extract a pure function if it
   lives inline in a component). UI wiring (a new button/shortcut actually firing)
   → a lane-3 `*.e2e.test.ts` that clicks the real app.
2. **Name + ground it** — one assertion per behaviour, real selectors
   (`data-item-kind`, `data-testid`, titles), a fixture not prose.
3. **Run `bun run test:all`** and make it green before saying "done". A feature
   without a test that survives `test:all` is not finished.

Example (the "Trim to End" feature): pure range math →
`src/components/video-editor/trimToEnd.test.ts` (lane 1); the `E` shortcut + the
toolbar button actually cutting the tail + Undo restoring it →
`e2e/trim-to-end.e2e.test.ts` (lane 3). Both run under `test:all` automatically.

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
