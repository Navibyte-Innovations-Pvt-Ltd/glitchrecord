# CLAUDE.md — GlitchRecord (apps/glitchrecord)

Electron screen recorder/editor (a fork of Recordly) that records the screen,
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

## Gotchas

- Dev userData + unified debug log:
  `~/Library/Application Support/GlitchRecord-dev/` (not `Recordly-dev`).
- `GLITCHBRIDGE_PORT` overrides the fixed 7337 for isolated unit tests.
- See the repo-root `CLAUDE.md` for the full GlitchRecord ↔ extension capture
  pipeline, event model, and capture-chain gotchas.
- Explain gestures (how users mark what the AI narrates — hold Shift on a
  component, hold Shift across siblings for a cluster, select text + tap Shift):
  see [docs/EXPLAIN-GESTURES.md](docs/EXPLAIN-GESTURES.md).
