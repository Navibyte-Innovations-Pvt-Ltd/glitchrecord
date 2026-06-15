// Launches the REAL GlitchRecord Electron app and returns its editor window so
// e2e tests can click actual buttons (script panel, clip handles, markers).
//
// Uses the dev-open-recording hook (RECORDLY_DEV_OPEN_RECORDING_INPUT) to land
// straight in the editor with a video on the timeline — no manual recording.
//
// CONSTRAINT: GlitchRecord takes requestSingleInstanceLock() and the bridge
// binds port 7337. A running dev instance owns both, so a second launch would
// just focus the existing window and exit. This lane therefore needs the dev
// app CLOSED. We preflight-check 7337 and fail with a clear message instead of
// hanging.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
// `electron` resolves to the binary path string at runtime.
import electronPath from "electron";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");
const MAIN = path.join(APP_ROOT, "dist-electron", "main.cjs");
const RENDERER = path.join(APP_ROOT, "dist", "index.html");

// GlitchRecord auto-saves a `<video>.project.json` NEXT TO the video it opens.
// So the e2e must never point at a tracked repo asset (that pollutes
// public/wallpapers). Copy the bundled sample into /tmp once and open that.
const SAMPLE_SRC = path.join(APP_ROOT, "public", "wallpapers", "wispysky.mp4");
const SAMPLE_VIDEO = path.join(os.tmpdir(), "gg-e2e-sample.mp4");
function ensureSampleVideo(): string {
  if (!fs.existsSync(SAMPLE_VIDEO) && fs.existsSync(SAMPLE_SRC)) {
    fs.copyFileSync(SAMPLE_SRC, SAMPLE_VIDEO);
  }
  return SAMPLE_VIDEO;
}

// Detect a running GlitchRecord by trying to BIND 7337 the same way its bridge
// does (Node's default dual-stack `::`). A connect-probe missed it because the
// app listens on IPv6 `*:7337`; an EADDRINUSE on bind is the reliable signal.
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (e: NodeJS.ErrnoException) => resolve(e.code === "EADDRINUSE"));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port);
  });
}

const DEV_RUNNING_MSG =
  "GlitchRecord is already running (port 7337 / single-instance lock). " +
  "Close the dev app before running the Electron UI e2e lane, then re-run.";

export interface EditorApp {
  app: ElectronApplication;
  window: Page;
  close: () => Promise<void>;
}

export async function launchEditor(opts?: { videoPath?: string }): Promise<EditorApp> {
  if (!fs.existsSync(MAIN) || !fs.existsSync(RENDERER)) {
    throw new Error(
      `Built app not found (need ${MAIN} + ${RENDERER}). The UI e2e launches the ` +
        `BUILT app, not source — run \`bun run build\` (or \`bunx vite build --config vite.config.ts\`) first.`,
    );
  }
  if (await portInUse(7337)) throw new Error(DEV_RUNNING_MSG);
  const video = opts?.videoPath ?? ensureSampleVideo();

  // Private user-data-dir → the app gets its OWN single-instance lock. Without
  // this, ANY other unpackaged Electron app on the machine (e.g. another dev
  // tool) holds the shared default lock, so GlitchRecord's
  // requestSingleInstanceLock() returns false and it app.quit()s instantly —
  // the launch then rejects with a cryptic "browser has been closed". The
  // private dir also gives each run clean, logged-out state.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-e2e-udd-"));

  const app = await electron
    .launch({
      executablePath: electronPath as unknown as string,
      args: [MAIN, "--no-sandbox", `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        RECORDLY_DEV_OPEN_RECORDING_INPUT: video,
        // Mark the run so the app/bridge can stay offline (no login/AI required).
        GG_E2E: "1",
      },
    })
    .catch((err) => {
      throw new Error(
        `GlitchRecord failed to launch. If a dev instance is running, close it (port 7337). ` +
          `(launch error: ${err instanceof Error ? err.message : err})`,
      );
    });

  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState("domcontentloaded");

  return {
    app,
    window,
    close: async () => {
      // Grab the pid BEFORE close() so we can guarantee the process tree dies
      // even if Playwright's own kill fails (it has hit EPERM on macOS). A
      // surviving GlitchRecord would hold the bridge + leak RAM across runs.
      const pid = app.process()?.pid;
      await app.close().catch(() => {});
      if (pid) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

export interface HomeApp extends EditorApp {
  userDataDir: string;
  projectsDir: string;
}

// Launch the app on its HOME screen (the projects/recordings launcher), NOT the
// editor — so we omit RECORDLY_DEV_OPEN_RECORDING_INPUT. Seeds project files into
// the private user-data-dir's Projects directory BEFORE launch so the launcher's
// list-project-files finds them. Returns the dirs so the test can assert on disk.
export async function launchHome(opts?: {
  seedProjects?: Array<{ name: string; content?: string }>;
}): Promise<HomeApp> {
  if (!fs.existsSync(MAIN) || !fs.existsSync(RENDERER)) {
    throw new Error(
      `Built app not found (need ${MAIN} + ${RENDERER}). Run \`bun run build\` first.`,
    );
  }
  if (await portInUse(7337)) throw new Error(DEV_RUNNING_MSG);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-e2e-udd-"));
  // getProjectsDir() = <userData>/recordings/Projects (electron/ipc/utils.ts +
  // project/manager.ts). Seed there so the launcher lists the projects.
  const projectsDir = path.join(userDataDir, "recordings", "Projects");
  fs.mkdirSync(projectsDir, { recursive: true });
  for (const proj of opts?.seedProjects ?? []) {
    fs.writeFileSync(path.join(projectsDir, proj.name), proj.content ?? "{}");
  }

  const app = await electron
    .launch({
      executablePath: electronPath as unknown as string,
      args: [MAIN, "--no-sandbox", `--user-data-dir=${userDataDir}`],
      // NO RECORDLY_DEV_OPEN_RECORDING_INPUT → the app stays on the home launcher.
      env: { ...process.env, GG_E2E: "1" },
    })
    .catch((err) => {
      throw new Error(
        `GlitchRecord failed to launch home. If a dev instance is running, close it (port 7337). ` +
          `(launch error: ${err instanceof Error ? err.message : err})`,
      );
    });

  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState("domcontentloaded");

  return {
    app,
    window,
    userDataDir,
    projectsDir,
    close: async () => {
      const pid = app.process()?.pid;
      await app.close().catch(() => {});
      if (pid) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
