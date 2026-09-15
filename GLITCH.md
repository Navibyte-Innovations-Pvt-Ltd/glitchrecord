# GLITCH.md

The brief Glitchgrab's report assistant reads before it talks to anyone filing a
bug about GlitchRecord. CLAUDE.md is for whoever writes the code; this is for
whoever is stuck in the app. Keep it to a page — only the first ~80 lines reach
the model.

## What this product is

GlitchRecord is a desktop screen recorder and video editor (derived from Recordly, AGPLv3 — see LICENSE.md)
made by the Glitchgrab team. With the Glitchgrab Chrome extension it records a
product walkthrough, logs every click on the page, and writes a narrated
tutorial script from those clicks. File → Report Bug… (⌘⇧G) files a bug about
GlitchRecord itself.

## Roles

- **owner** — signed in with a Glitchgrab account (Connect Glitchgrab). Picks the
  recording repo, generates scripts, creates issues from recordings.
- **tester** — QA on a magic link; signs in with "Open in GlitchRecord" on the
  tester dashboard. Records and reports; no repo or billing settings.

## Entities

- **recording** — one screen capture. Listed under Recent recordings on Home.
- **project** — a recording's edits, saved as `.project.json` next to the video.
- **clip / zoom / speed segment** — pieces on the editor timeline.
- **capture log** — clicks, typing and page changes the Chrome extension saw
  during a recording.
- **explain mark** — pressing Shift over something while recording, so the
  script explains it.
- **script** — the AI narration written from the capture log.

## Areas

- **Home** — Recent recordings, New Recording, Report Bug, the account menu.
- **Recorder HUD** — the floating bar while recording, with the live event feed.
- **Editor** — timeline (clips, zoom, speed, split, mute, crop) and export.
- **GlitchGrab panel** — capture log, Script Writer, refine chat, narration.
- **Chrome extension** — captures page events; talks to GlitchRecord on port 7337.
- **Report Bug** — the side panel this report is being written in.

## Guides and fixes

- **Report Bug asks to sign in, or says the sign-in expired.** Sign-ins last 90
  days. Click Connect Glitchgrab and approve in the browser; the window reloads.
- **Recording is black or blank after installing a new build.** Unsigned builds
  lose macOS permissions on every update. System Settings → Privacy & Security →
  Screen Recording: remove GlitchRecord, add it again, reopen the app. Same under
  Accessibility if the cursor is not tracked.
- **"Apple could not verify GlitchRecord".** Builds are not notarized yet. System
  Settings → Privacy & Security → Open Anyway.
- **The capture log is empty (0 events).** The Chrome extension must be installed
  and connected. Reload tabs that were open before the extension was installed
  or reloaded. Chrome's own pages, the address bar and other apps are never
  captured.
- **Two Glitchgrab extensions in Chrome.** Turn one off (store copy or unpacked);
  two at once make capture and ⌘⇧G unreliable.
- **Opening GlitchRecord only focuses a window.** Only one GlitchRecord runs at a
  time. Quit the other one (including a dev copy).
- **The script is generic.** Mark what matters while recording: hover a control
  and tap Shift, or select text and tap Shift. Then generate again.

## Known limitations

- macOS is the tested platform; the ⌘⇧G menu shortcut exists only on macOS.
- Exporting an edited project reopened from disk can fail with "VideoEncoder is
  not defined". Exporting right after recording works.
- No auto-update on unsigned builds — each new version is installed by hand.

## Don't report

- Bugs in the website or app being recorded — file those from that app
  (⌘⇧G in Chrome), not from GlitchRecord.
- "The script sounds off" without saying which lines are wrong.
