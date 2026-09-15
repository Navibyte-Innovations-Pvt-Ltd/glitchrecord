# CLAUDE.md — GlitchRecord (apps/glitchrecord)

Electron screen recorder/editor (derived from Recordly, AGPLv3; team-only) that records the screen,
edits clips/zooms, and hosts the **GlitchGrab bridge** pairing with the Chrome
extension (`packages/extension`) to turn a recording into a narrated tutorial.

## Commands

```bash
bun run dev          # vite + electron, hot-reloads main/preload. USER manages this — don't start/stop it.
bun run test         # lane 1: deterministic unit/integration (vitest, CI-safe)
bun run test:e2e:capture   # lane 2: real Chromium + extension → bridge (headed)
bun run test:e2e:ui        # lane 3: Playwright _electron clicks the real app (headed)
```

Electron main/preload changes need a full quit + relaunch to take effect.

## Testing

Full methodology, lanes, and the bug→test→scenario workflow live in
**[`docs/TESTING.md`](docs/TESTING.md)**. Key rules:

- **Every bug ships with a reproduction fixture + a regression test**, at the
  lowest lane that can catch it. Prefer extracting a pure function over testing
  through the DOM.
- **Headed lanes (2 & 3) need the dev app CLOSED** — GlitchRecord's
  single-instance lock + bridge **port 7337** mean a second launch just focuses
  the running window and exits. The e2e harness preflights this and fails with a
  clear message.

## Report Bug sheet

`src/components/report/InlineReport.tsx` (mounted in Home and the editor)
hosts the **shared** report dialog from `packages/report-ui` — vendored into
`src/vendor/report-ui/` by `scripts/sync-report-ui.mjs` on every `dev`/`build`.
`src/vendor/` is generated: **never hand-edit it**, edit `packages/report-ui`
and re-run `npm run sync:report-ui`. (It's a copy, not a dependency, because
this app is a standalone submodule — see that package's README.)

It files bugs in GlitchRecord only: fixed repo
`Navibyte-Innovations-Pvt-Ltd/glitchgrab` (private, labelled `glitchrecord`), same report flow as the SDK, as a right-side sheet
over the window you're in (`layout="sheet"`), with a screenshot of that window
(`capturePage`). Open it from Home or ⌘⇧G (File menu); from the recording HUD it
opens in Home. The AI assistant reads `GLITCH.md` at this
app's root. Identity is an `ExtensionSession` held in the main process — see the
repo-root `CLAUDE.md`.

## Releasing and installing

Team-only, unsigned builds on `cdn.glitchgrab.dev/glitchrecord/` via
`bun run release:cdn`: [RELEASING.md](RELEASING.md). Install, permissions and
extension steps: [docs/TESTER-INSTALL.md](docs/TESTER-INSTALL.md).

## Gotchas

- Recordly names were renamed to GlitchRecord everywhere (`GLITCHRECORD_*` env,
  `glitchrecord-*` helpers, `glitchrecord-extension.json`). The only `recordly`
  left reads old `.recordly` projects and old `recordly-extension.json`
  manifests — keep both. Extensions are local only.
- Dev userData + unified debug log:
  `~/Library/Application Support/GlitchRecord-dev/`.
- `GLITCHBRIDGE_PORT` overrides the fixed 7337 for isolated unit tests.
- See the repo-root `CLAUDE.md` for the full GlitchRecord ↔ extension capture
  pipeline, event model, and capture-chain gotchas.
- Explain gestures (how users mark what the AI narrates — hold Shift on a
  component, hold Shift across siblings for a cluster, select text + tap Shift):
  see [docs/EXPLAIN-GESTURES.md](docs/EXPLAIN-GESTURES.md).
