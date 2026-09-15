# GlitchRecord

The Glitchgrab team's internal screen recorder and editor. It records the
screen, edits clips and zooms, and hosts the **GlitchGrab bridge** that pairs
with the Glitchgrab Chrome extension to turn a recording into a narrated
tutorial and a GitHub issue.

Used inside Navibyte Innovations only — builds are not distributed outside the
team.

- macOS 14+ (native ScreenCaptureKit helpers)
- Windows 10 build 19041+ (Windows Graphics Capture helper)
- Linux (Electron capture; no cursor hiding)

## GlitchGrab integration

A WebSocket server (port 7337, `electron/glitchbridge/`) pairs with the Chrome
extension (`packages/extension`).

1. Press Record → the bridge broadcasts `recording:start` over WS.
2. The extension's content script captures click/input/navigate/scroll events
   on every open tab.
3. Events stream live into the editor's event log; on stop, they're sorted into
   one timeline and uploaded.
4. If logged in: events → AI narration script (Gemini 2.5 Pro, DeepSeek
   fallback) → the editor's **Create GitHub Issue** button posts through the
   account's own repo/token.
5. **Report Bug** (Home, or ⌘⇧G while the app is in front) files a bug in
   GlitchRecord itself into the private glitchgrab repo with a `glitchrecord`
   label.

The full event model and capture-chain gotchas live in the repo-root
`CLAUDE.md`.

## Develop

```bash
npm install                # also rebuilds native modules (postinstall)
bun run dev                # vite + electron, hot-reloads main/preload
```

Needs Node 22 and, on macOS, Xcode Command Line Tools (`swiftc` builds the
native capture helpers on first launch).

```bash
bun run test               # lane 1: deterministic unit/integration (vitest)
bun run test:e2e:capture   # lane 2: real Chromium + extension → bridge (headed)
bun run test:e2e:ui        # lane 3: Playwright _electron clicks the real app (headed)
```

Headed lanes need the dev app closed (single-instance lock + port 7337). Testing
methodology: `docs/TESTING.md`.

- Dev userData + unified debug log: `~/Library/Application Support/GlitchRecord-dev/`.
- Electron main/preload changes need a full quit + relaunch.
- `GLITCHBRIDGE_PORT` overrides the fixed 7337 for isolated unit tests.

## Release and install

- Cutting a build and publishing it to `cdn.glitchgrab.dev`: `RELEASING.md`
- Installing on a team member's machine: `docs/TESTER-INSTALL.md`

## Extensions

In-app extensions are loaded from the local extensions folder only — there is
no marketplace. API reference: `EXTENSIONS.md`.

## Projects

Work is saved as project files next to the recording. Older `.recordly` and
`.openscreen` project files still open.

## License and attribution

GlitchRecord is derived from [Recordly](https://github.com/webadderallorg/Recordly)
by webadderall, licensed under AGPLv3, which itself began as a fork of
[OpenScreen](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem.
See `LICENSE.md` for the full license and its attribution terms.
