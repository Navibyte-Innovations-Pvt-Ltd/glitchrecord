// Real-browser e2e harness for the GlitchRecord capture pipeline.
//
// Boots the exact runtime the user does — a real Chromium with the unpacked
// Glitchgrab extension loaded — and a local http server for a deterministic
// page to act on. The Electron-side bridge is started by the test itself
// (electron mocked) so the whole chain runs:
//
//   real Chrome + extension  →  ws://localhost:7337  →  real bridge  →  session
//
// Headed only: MV3 service workers don't run in headless Chromium, and the
// extension's background IS a service worker. So this lane runs locally on a
// machine with a display, not in headless CI.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, type Worker, chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(HERE, "../../../../packages/extension");
const EXT_DIST = path.join(EXT_DIR, "dist");
const FIXTURES = path.resolve(HERE, "../fixtures");

// Build the extension to dist/ if it has never been built. We deliberately do
// NOT rebuild on every run — `bun run build` in packages/extension is the
// source of truth; the test just needs *a* dist to load.
export function ensureExtensionBuilt(): string {
  if (!fs.existsSync(path.join(EXT_DIST, "manifest.json"))) {
    execFileSync("bun", ["run", "build"], { cwd: EXT_DIR, stdio: "inherit" });
  }
  return EXT_DIST;
}

export interface Harness {
  context: BrowserContext;
  worker: Worker; // the extension's background service worker
  fixtureUrl: (file: string) => string;
  close: () => Promise<void>;
}

// Serve the e2e/fixtures dir over http so content scripts (which match
// http/https, not file://) attach normally.
function startFixtureServer(): Promise<{ origin: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = path.basename((req.url ?? "/").split("?")[0]) || "index.html";
      const file = path.join(FIXTURES, name);
      fs.readFile(file, (err, buf) => {
        if (err) { res.statusCode = 404; res.end("not found"); return; }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

export async function launchHarness(): Promise<Harness> {
  const extDir = ensureExtensionBuilt();
  const fixtures = await startFixtureServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-e2e-chrome-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // MV3 service worker requires a headed context
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  // Grab the extension's background service worker (the WS client to the bridge).
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });

  return {
    context,
    worker,
    fixtureUrl: (file: string) => `${fixtures.origin}/${file}`,
    close: async () => {
      await context.close();
      fixtures.close();
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

// Poll until a predicate holds or the deadline passes. Capture is async across
// process + WS boundaries, so tests wait on observed state, never fixed sleeps.
export async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 8000, intervalMs = 100, label = "condition" } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms waiting for: ${label}`);
}
