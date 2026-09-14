# Giving GlitchRecord to a tester (unsigned build)

GlitchRecord has no Apple Developer ID yet, so builds are **ad-hoc signed and
not notarized**. macOS blocks them on first open. This is the path until the
signed release pipeline in `RELEASING.md` gets its `APPLE_*` secrets.

## 1. Build (on the developer's Mac)

```bash
cd apps/glitchrecord
CSC_IDENTITY_AUTO_DISCOVERY=false bun run build:mac
cd ../../packages/extension && bun run build
```

Outputs:

- `apps/glitchrecord/release/GlitchRecord-arm64.dmg` for Apple Silicon (M1–M4)
- `apps/glitchrecord/release/GlitchRecord-x64.dmg` for Intel Macs
- `packages/extension/dist/` for the Chrome extension. Zip the folder.

A packaged build talks to `https://glitchgrab.dev`, not localhost
(`electron/glitchbridge/api.ts`). Always rebuild before sending: a DMG in
`release/` can be months old.

## 2. Install GlitchRecord (tester's Mac)

1. Check the chip: Apple menu → About This Mac. "Apple M…" means arm64, "Intel" means x64.
2. Open the DMG and drag GlitchRecord into Applications.
3. Open it. macOS says it "could not verify" the app. Click **Done**, not Move to Trash.
4. Go to System Settings → Privacy & Security, scroll down, and click **Open Anyway**.

   If that button doesn't show, run this once in Terminal instead:
   `xattr -dr com.apple.quarantine /Applications/GlitchRecord.app`
5. Grant **Screen Recording**, **Accessibility** and **Microphone** when asked,
   then quit and reopen the app.

Every new unsigned build has a different signature, so macOS **forgets these
permissions after each update**. The tester has to remove GlitchRecord from
Screen Recording and Accessibility and add it again. This is the most common
"recording is blank" report on unsigned builds.

There is no auto-update without signing. Send the new DMG each time.

## 3. Install the Chrome extension

1. Unzip `glitchgrab-extension.zip` to a folder that won't be deleted (e.g. `~/glitchgrab-extension`).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick that folder.
4. For a new version, replace the folder's contents and click **↻** on the
   extension. Don't use Load unpacked again, which adds a duplicate.

## 4. Sign in

1. Open the QA link from the project owner in Chrome. The extension signs in by itself.
2. On the tester dashboard, click **Open in GlitchRecord**, then confirm the name and repos.

## 5. Filing a bug

- **In Chrome:** press **⌘⇧G** on the page with the bug.
- **A bug in GlitchRecord itself:** click **Report Bug** on Home, or press **⌘⇧G**
  while GlitchRecord is the app in front (File → Report Bug…). A side panel
  slides in over the window you're in and files into the glitchrecord repo, with a
  screenshot of that window. Not
  system-wide on purpose, so Chrome and Finder keep their own ⌘⇧G.

⌘⇧G in Chrome attaches the tester's last 50 steps: clicks, field changes and page
opens, but never typed text. The issue shows them as an **Activity Log** table. See
`agent_docs/tester-activity-trail.md`.
