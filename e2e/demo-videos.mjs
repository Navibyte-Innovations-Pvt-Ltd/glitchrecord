// ONE command → TWO videos (both into apps/glitchrecord/demo-videos/, gitignored):
//
//   1. routine.mp4          — the FULL flow start→end:
//        Chrome browses the live public site https://www.myabhyasika.in/
//        (visible cursor, GlitchGrab extension capturing events)  ──►
//        GlitchRecord opens that footage and does REAL drag edits
//        (drag a clip edge to re-speed it, shift+click to carve a speed point),
//        the two stages concatenated.
//
//   2. routine-EXPORTED.mp4 — the EDITED export: GlitchRecord's real export
//        pipeline (WebGL render + WebCodecs encode) rendering the footage WITH
//        the edits baked in. This is the rendered deliverable, not a screen
//        recording.
//
// Run:  bun run demo:videos   (from repo root OR apps/glitchrecord)
// Needs: built extension (packages/extension/dist) + built app (dist + dist-electron),
//        ffmpeg/ffprobe, and a network connection to myabhyasika.in. No login.
import { chromium, _electron as electron } from "playwright";
import electronPath from "electron";
import { WebSocketServer } from "ws";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const EXT = path.resolve(APP, "../../packages/extension/dist");
const OUT = path.join(APP, "demo-videos");
const BROWSE_MP4 = path.join(OUT, "r1-browse.mp4");
const EDIT_MP4 = path.join(OUT, "r2-edits.mp4");
const ROUTINE = path.join(OUT, "routine.mp4");
const EXPORTED = path.join(OUT, "routine-EXPORTED.mp4");
// Footage the editor opens + exports (project.json is auto-saved next to it).
const FOOTAGE = path.join(os.tmpdir(), "demo-footage.mp4");
const PROJECT = `${FOOTAGE}.project.json`;
const SITE = "https://www.myabhyasika.in/";
const SIZE = { width: 1280, height: 800 };
fs.mkdirSync(OUT, { recursive: true });

// Playwright video doesn't render the OS pointer — draw a synthetic one that
// follows the mouse and pulses on press, so the demo shows where it's acting.
const CURSOR_JS = `(() => {
  if (window.__ggCursor) return; window.__ggCursor = 1;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:-100px;top:-100px;width:20px;height:20px;border-radius:50%;background:rgba(255,40,40,.5);border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:width .08s,height .08s,background .08s';
  (document.body||document.documentElement).appendChild(d);
  addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';},true);
  addEventListener('mousedown',()=>{d.style.width='32px';d.style.height='32px';d.style.background='rgba(40,120,255,.6)';},true);
  addEventListener('mouseup',()=>{d.style.width='20px';d.style.height='20px';d.style.background='rgba(255,40,40,.5)';},true);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toMp4(webm, mp4) {
  execFileSync("ffmpeg", ["-y", "-i", webm, "-vf", "scale=1280:800,setsar=1,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
}

// ───────────────────────── PART A: public browse on the live site ─────────────
async function recordBrowse() {
  const events = [];
  const wss = new WebSocketServer({ port: 7337 });
  const sid = `demo-${process.pid}`;
  wss.on("connection", (ws, req) => {
    const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
    if (role === "chrome") ws.send(JSON.stringify({ type: "recording:start", sessionId: sid, repoId: "myabhyasika", repoName: "myabhyasika" }));
    ws.on("message", (r) => { try { const m = JSON.parse(r.toString()); if (m.type === "event:live" && m.event) events.push(m.event); } catch { /* */ } });
  });

  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "demo-br-"));
  const vdir = path.join(os.tmpdir(), "demo-br-vid"); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(udd, {
    headless: false, viewport: SIZE, recordVideo: { dir: vdir, size: SIZE },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
  });
  await ctx.addInitScript({ content: CURSOR_JS });
  let [w] = ctx.serviceWorkers(); if (!w) await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => {});
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const hoverEl = async (loc) => { const box = await loc.boundingBox().catch(() => null); if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 }); await sleep(250); } };
  const clickEl = async (loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await hoverEl(loc); await loc.click({ timeout: 6000 }).catch(() => {}); await sleep(900); };
  const scrollBy = async (dy) => { for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dy / 6); await sleep(180); } await sleep(700); };

  try {
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2500);
    await page.evaluate(CURSOR_JS).catch(() => {});
    await scrollBy(600);                  // look down the list of libraries
    // The list re-renders after each navigation, so capture target card hrefs up
    // front, then visit 2–3 of them. Library cards are anchors to /library/<slug>.
    const hrefs = await page.locator('a[href^="/library/"]').evaluateAll(
      (els) => [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
    ).catch(() => []);
    const pick = [hrefs[0], hrefs[4], hrefs[8]].filter(Boolean).slice(0, 3);
    let visited = 0;
    for (const href of pick) {
      // Return to the list before each card (goto, not goBack — an SPA back can
      // land on about:blank).
      if (!/myabhyasika\.in\/?$/.test(page.url())) {
        await page.goto(SITE, { waitUntil: "domcontentloaded" }).catch(() => {});
        await sleep(1500); await page.evaluate(CURSOR_JS).catch(() => {});
      }
      const card = page.locator(`a[href="${href}"]`).first();
      await clickEl(card);                                  // visible cursor clicks the card
      await page.waitForURL((u) => u.pathname.includes("/library/"), { timeout: 8000 }).catch(() => {});
      if (!page.url().includes("/library/")) {              // click didn't navigate → go directly
        await page.goto(new URL(href, SITE).href, { waitUntil: "domcontentloaded" }).catch(() => {});
      }
      await sleep(1600); await page.evaluate(CURSOR_JS).catch(() => {});
      await scrollBy(450);                                  // scroll a little inside the card
      await scrollBy(-300);
      console.log(`  visited card: ${href} → ${page.url()}`);
      visited++;
    }
    // …and get out.
    console.log("  browse FINAL:", page.url(), "| cards visited", visited);
  } catch (e) { console.log("  browse partial:", e.message.split("\n")[0], "at", page.url()); }
  await sleep(1500);

  const video = page.video();
  await ctx.close(); wss.close();
  const webm = await video.path();
  toMp4(webm, BROWSE_MP4);
  fs.copyFileSync(BROWSE_MP4, FOOTAGE); // the recording the editor opens + exports
  fs.rmSync(PROJECT, { force: true });
  fs.rmSync(udd, { recursive: true, force: true });
  console.log(`  browse recorded → ${BROWSE_MP4} | events captured: ${events.length}`);
}

// ───────────────────────── PART B: GlitchRecord real edits ─────────────────────
async function recordEdits() {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "demo-ed-"));
  const vdir = path.join(os.tmpdir(), "demo-ed-vid"); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(APP, "dist-electron/main.cjs"), "--no-sandbox", `--user-data-dir=${udd}`],
    env: { ...process.env, RECORDLY_DEV_OPEN_RECORDING_INPUT: FOOTAGE, GG_E2E: "1" },
    recordVideo: { dir: vdir, size: SIZE },
  });
  const win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState("domcontentloaded");
  await win.locator('[data-item-kind="clip"]').first().waitFor({ state: "visible", timeout: 60000 });
  await win.evaluate(CURSOR_JS).catch(() => {});
  await sleep(1500);
  const move = async (x, y) => { await win.mouse.move(x, y, { steps: 18 }); await sleep(250); };

  // seek onto real content so the preview isn't the blank first frame
  const canvas = win.locator('[data-testid="timeline-canvas"]').first();
  let box = await canvas.boundingBox();
  await move(box.x + box.width * 0.25, box.y + 6); await win.mouse.click(box.x + box.width * 0.25, box.y + 6); await sleep(2500);

  // EDIT 1 — drag the clip's RIGHT edge inward → speeds the clip up (real drag)
  const clip = win.locator('[data-item-kind="clip"]').first();
  await clip.click(); await sleep(800);
  const cb = await clip.boundingBox();
  const ex = cb.x + cb.width - 6, ey = cb.y + cb.height / 2;
  await move(ex, ey); await win.mouse.down(); await sleep(400);
  const tgt = cb.x + cb.width * 0.5;
  for (let i = 1; i <= 14; i++) { await win.mouse.move(ex + (tgt - ex) * i / 14, ey, { steps: 2 }); await sleep(55); }
  await sleep(400); await win.mouse.up(); await sleep(1500);
  const sp1 = await win.locator('[data-testid="clip-speed-badge"]').first().textContent().catch(() => "?");
  console.log("  EDIT1 drag→speed:", sp1);

  // EDIT 2 — shift+click two points to carve a speed point on a portion
  box = await canvas.boundingBox();
  await win.keyboard.down("Shift");
  await move(box.x + box.width * 0.15, box.y + 6); await win.mouse.click(box.x + box.width * 0.15, box.y + 6); await sleep(500);
  await move(box.x + box.width * 0.3, box.y + 6); await win.mouse.click(box.x + box.width * 0.3, box.y + 6);
  await win.keyboard.up("Shift"); await sleep(1500);
  console.log("  EDIT2 shift+click speed point done");

  // EDIT 3 — ZOOM-IN effects (the "zoom on click" look). Move the playhead to a
  // few moments and click "Add Zoom" → punch-in zoom regions that the exporter
  // renders. Try the "Auto-zoom" button first (suggests zooms from the recording);
  // fall back to manual Add Zoom so the export always has zoom punches.
  const addZoom = win.locator('[title^="Add Zoom"]').first();
  let zoomCount = 0;
  for (const frac of [0.3, 0.55, 0.78]) {
    const cb2 = await canvas.boundingBox();
    await move(cb2.x + cb2.width * frac, cb2.y + 6);
    await win.mouse.click(cb2.x + cb2.width * frac, cb2.y + 6); // seek playhead
    await sleep(500);
    await addZoom.click().catch(() => {});
    await sleep(900);
    zoomCount++;
  }
  const zoomsOnTimeline = await win.locator('[data-item-kind="zoom"]').count().catch(() => 0);
  console.log(`  EDIT3 added ${zoomCount} zoom punches (timeline shows ${zoomsOnTimeline})`);
  await sleep(1000);

  // Save so the edits persist into <footage>.project.json → exported video bakes them in.
  await win.keyboard.press("Meta+s").catch(() => {});
  await sleep(2500);

  const video = win.video();
  const pid = app.process()?.pid;
  await app.close().catch(() => {});
  if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* */ } }
  const webm = await video.path();
  toMp4(webm, EDIT_MP4);
  fs.rmSync(udd, { recursive: true, force: true });
  console.log(`  edits recorded → ${EDIT_MP4}${fs.existsSync(PROJECT) ? " | project saved" : " | (no project saved)"}`);
}

// ───────────────────────── PART C: real export (WebGL) of the edits ────────────
async function exportEdited() {
  fs.rmSync(EXPORTED, { force: true });
  fs.rmSync(`${EXPORTED}.report.json`, { force: true });
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "demo-exp-"));
  const env = {
    ...process.env, GG_E2E: "1",
    RECORDLY_SMOKE_EXPORT: "1",
    RECORDLY_SMOKE_EXPORT_INPUT: FOOTAGE,
    RECORDLY_SMOKE_EXPORT_OUTPUT: EXPORTED,
    RECORDLY_SMOKE_EXPORT_ENCODING_MODE: "fast",
    // WebGL renders headlessly (WebGPU can't configure a canvas without a display).
    RECORDLY_SMOKE_EXPORT_RENDER_BACKEND: "webgl",
  };
  if (fs.existsSync(PROJECT)) env.RECORDLY_SMOKE_EXPORT_PROJECT = PROJECT; // bake the edits in
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(APP, "dist-electron/main.cjs"), "--no-sandbox", `--user-data-dir=${udd}`],
    env,
  });
  const report = `${EXPORTED}.report.json`;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) { if (fs.existsSync(report)) { await sleep(1500); break; } await sleep(1000); }
  try { const pid = app.process()?.pid; if (pid) process.kill(pid, "SIGKILL"); } catch { /* */ }
  await app.close().catch(() => {});
  fs.rmSync(udd, { recursive: true, force: true });
  if (fs.existsSync(report)) {
    const rep = JSON.parse(fs.readFileSync(report, "utf8"));
    console.log(`  export: success=${rep.success} render=${rep.metrics?.renderBackend} frames=${rep.metrics?.frameCount}`);
    if (!rep.success) console.log("  export error:", (rep.error || "").split("\n")[0]);
  }
}

console.log("PART A — public browse on", SITE, "…");
await recordBrowse();
console.log("PART B — GlitchRecord edits on the footage…");
await recordEdits();

// concat browse + edits → one routine video (video 1)
const list = path.join(OUT, "_list.txt");
fs.writeFileSync(list, `file '${BROWSE_MP4}'\nfile '${EDIT_MP4}'\n`);
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ROUTINE], { stdio: "ignore" });
fs.rmSync(list, { force: true });

console.log("PART C — exporting the edited video (WebGL)…");
await exportEdited();

const probe = (f) => fs.existsSync(f) ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim() : "MISSING";
console.log(`\n2 VIDEOS in ${OUT}:`);
console.log(`  1. routine.mp4          (full flow start→end)  ${probe(ROUTINE)}s`);
console.log(`  2. routine-EXPORTED.mp4 (edited export)        ${probe(EXPORTED)}s`);
