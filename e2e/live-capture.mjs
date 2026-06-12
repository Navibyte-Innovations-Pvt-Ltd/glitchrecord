// Live capture session for testing the record→script workflow on a REAL site.
// Opens a fresh Chrome with the latest-built GlitchGrab extension, starts a
// minimal bridge on 7337 (no Electron/glitchgrab internals), and streams every
// captured event to a JSON file as YOU click through the app.
//
//   node e2e/live-capture.mjs [url]
//
// Then do the flow in the opened Chrome. Events land in OUT continuously
// (event:live), so no "stop" is needed to read them.
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXT = "/Users/webnaresh/coding-line/glitchgrab/packages/extension/dist";
const OUT = "/tmp/abhyasika-events.json";
const TARGET = process.argv[2] || "http://localhost:3333";

const events = [];
const persist = () => fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, count: events.length, events }, null, 2));
persist();

// ── Minimal bridge: tell the extension to record, collect its live events ──
const wss = new WebSocketServer({ port: 7337 });
const sessionId = `abhyasika-${Date.now()}`;
wss.on("listening", () => console.log("[bridge] ws://localhost:7337 up"));
wss.on("connection", (ws, req) => {
  const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
  console.log(`[bridge] client connected: ${role}`);
  if (role === "chrome") {
    ws.send(JSON.stringify({ type: "recording:start", sessionId, repoId: "abhyasika", repoName: "abhyasika" }));
    console.log("[bridge] → recording:start (capture is now LIVE)");
  }
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "event:live" && m.event) {
      events.push(m.event);
      persist();
      const e = m.event;
      const bits = [e.label || e.url || "", e.preview ? `"${e.preview}"` : "", e.meta?.role || ""].filter(Boolean).join(" | ");
      console.log(`#${events.length}  ${e.type.padEnd(8)} ${bits}`);
    } else if (m.type === "events:upload") {
      console.log(`[bridge] events:upload — ${m.events?.length ?? 0} total`);
    }
  });
  ws.on("close", () => console.log(`[bridge] ${role} disconnected`));
});

// ── Fresh Chrome with the latest extension ──
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "abhyasika-chrome-"));
const ctx = await chromium.launchPersistentContext(udd, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=9222", // so Claude can drive this same Chrome over CDP
  ],
});
let [worker] = ctx.serviceWorkers();
if (!worker) worker = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
console.log("[bridge] extension service worker is up");

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(TARGET, { waitUntil: "domcontentloaded" });

console.log("\n========================================================");
console.log(`READY. Do the WHOLE signup/onboarding flow in the opened Chrome.`);
console.log(`Target: ${TARGET}`);
console.log(`Events stream live to: ${OUT}`);
console.log("Leave this running; tell Claude when you're done.");
console.log("========================================================\n");

// Keep the process alive.
process.stdin.resume();
