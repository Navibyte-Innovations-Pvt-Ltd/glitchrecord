# Releasing GlitchRecord

GlitchRecord is a team-only tool. Builds are unsigned and published to
`cdn.glitchgrab.dev/glitchrecord/` — never to GitHub Releases, never to a
public page.

## One-time setup

- A Mac with Xcode Command Line Tools and Node 22, `npm install` done in
  `apps/glitchrecord`.
- `gh auth login` with access to `Navibyte-Innovations-Pvt-Ltd/glitchgrab` — the
  script dispatches the Windows/Linux build there.
- The monorepo root `.env` has the S3 keys the web app already uses:
  `NEXT_AWS_ACCESS_KEY_ID`, `NEXT_AWS_SECRET_ACCESS_KEY`, `NEXT_AWS_BUCKET_NAME`,
  `NEXT_AWS_S3_REGION`. Nothing AWS-related is stored in GitHub.
- `.github/workflows/glitchrecord-build.yml` is pushed on the branch you release
  from (GitHub only runs a dispatched workflow that exists on that branch).

## Cut a release

1. Bump `version` in `apps/glitchrecord/package.json`.
2. Commit and push — CI builds Windows and Linux from the pushed branch.
3. From `apps/glitchrecord`:

   ```bash
   bun run release:cdn                  # Mac here + Windows/Linux on CI
   bun run release:cdn -- --mac-only    # Mac only
   bun run release:cdn -- --skip-build  # re-upload what is already in release/
   ```

The script (`scripts/release-cdn.mjs`):

1. checks the S3 keys are loaded, before any build starts;
2. dispatches `glitchrecord-build.yml` (Windows NSIS + Linux AppImage);
3. builds the Mac DMG and zip for arm64 and x64 locally (unsigned);
4. waits for CI and downloads its artifacts into `release/ci/`;
5. refuses to upload if any `latest*.yml` has a different version than `package.json`;
6. uploads installers, then the stable `latest/` copies, then the feed files;
7. fetches `latest-mac.yml` back through the CDN and fails if it is not served.

## CDN layout

| Key | Cache | Purpose |
|---|---|---|
| `glitchrecord/<version>/*` | immutable | installers + blockmaps the feed points at |
| `glitchrecord/latest/*` | no-cache | stable download links for the team |
| `glitchrecord/latest-mac.yml`, `latest.yml`, `latest-linux.yml` | no-cache | auto-update feed (`electron-builder.json5` → `publish`) |

Team download links:

- `https://cdn.glitchgrab.dev/glitchrecord/latest/GlitchRecord-arm64.dmg` (Apple Silicon)
- `https://cdn.glitchgrab.dev/glitchrecord/latest/GlitchRecord-x64.dmg` (Intel Mac)
- `https://cdn.glitchgrab.dev/glitchrecord/latest/GlitchRecord-windows-x64.exe`
- `https://cdn.glitchgrab.dev/glitchrecord/latest/GlitchRecord-linux-x64.AppImage`

## First release: the CDN must serve `glitchrecord/`

Before this, `cdn.glitchgrab.dev` was only proven to serve `screenshots/`
(`agent_docs/mcp-http-server.md`). A new prefix can land in the bucket and still
be refused by the CDN — step 7 exists to catch that. If it fails, allow
`glitchrecord/*` the same way `screenshots/*` is allowed (bucket policy or
CloudFront behavior), then run `bun run release:cdn -- --skip-build`.

## Auto-update

- **Windows / Linux** — the installed app reads `latest.yml` / `latest-linux.yml`
  from the feed and updates itself.
- **macOS** — Squirrel.Mac only installs updates into a signed app. Unsigned Mac
  builds cannot update themselves: download the new DMG from the `latest/` link.
  macOS also forgets Screen Recording / Accessibility for every new unsigned
  build (see `docs/TESTER-INSTALL.md`). An Apple Developer ID fixes both.
- `GLITCHRECORD_UPDATE_FEED_URL` overrides the feed for testing;
  `GLITCHRECORD_DISABLE_AUTO_UPDATES=1` turns updates off.

## Local build without publishing

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run build:mac   # → release/
```
