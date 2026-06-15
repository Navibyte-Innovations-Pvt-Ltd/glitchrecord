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
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const EXT = path.resolve(APP, "../../packages/extension/dist");
const OUT = path.join(APP, "demo-videos");
const AUDIO_DIR = path.join(os.tmpdir(), "demo-narration");
const SIZE = { width: 1280, height: 800 };
fs.mkdirSync(OUT, { recursive: true });

// The 10 validated public sites. Each iteration produces TWO videos:
//   routine-<slug>.mp4   — chrome browse + editing, combined
//   exported-<slug>.mp4  — the edited export (captions + Ritu narration)
// → 20 videos per `demo:videos` run.
const SITES = [
  "https://stripe.com",
  "https://vercel.com",
  "https://tailwindcss.com",
  "https://news.ycombinator.com",
  "https://en.wikipedia.org/wiki/Public_library",
  "https://www.notion.com",
  "https://linear.app",
  "https://www.figma.com",
  "https://www.bbc.com/news",
  "https://resend.com",
];
const slugOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0].toLowerCase(); } catch { return "site"; } };

// Per-site paths — reassigned by setSite() at the start of each iteration.
let SITE, BROWSE_MP4, EDIT_MP4, ROUTINE, EXPORTED, FOOTAGE, PROJECT;
function setSite(url) {
  SITE = url;
  const s = slugOf(url);
  BROWSE_MP4 = path.join(OUT, `r1-${s}.mp4`);
  EDIT_MP4 = path.join(OUT, `r2-${s}.mp4`);
  ROUTINE = path.join(OUT, `routine-${s}.mp4`);
  EXPORTED = path.join(OUT, `exported-${s}.mp4`);
  FOOTAGE = path.join(os.tmpdir(), `demo-footage-${s}.mp4`);
  PROJECT = `${FOOTAGE}.project.json`;
}

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

// Auto-dismiss the on-load modals (location prompt, language picker, and the
// library-page "Welcome / Login … Skip for now" dialog) for the WHOLE session —
// they reappear after navigation and a one-shot dismiss misses them, leaving the
// dialog stuck over the page while we scroll/act. A MutationObserver + 1s tick
// clicks whichever dismiss control is visible, whenever it appears.
const MODAL_DISMISS_JS = `(() => {
  if (window.__ggModalKiller) return; window.__ggModalKiller = 1;
  let last = 0;
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const DECLINE = /^(Skip for now|Not Now|Skip, use English|Maybe later|Dismiss|No,? thanks|Close)$/i;
  const kill = () => {
    const now = Date.now(); if (now - last < 200) return;
    // 1. text dismiss/decline buttons (location "Not Now", login "Skip for now", language…)
    for (const el of document.querySelectorAll('button, a, [role="button"], span, div, p')) {
      const t = (el.textContent || '').trim();
      if (t.length <= 24 && DECLINE.test(t) && vis(el)) { try { el.click(); } catch (e) {} last = now; return; }
    }
    // 2. icon close buttons (the "Autopilot" promo + modal ✕) — aria-label or a lone ✕/×
    for (const el of document.querySelectorAll('button, [role="button"], [aria-label]')) {
      const al = (el.getAttribute('aria-label') || '').trim();
      const t = (el.textContent || '').trim();
      if ((/^(close|dismiss)$/i.test(al) || /^[✕✖×⨯]$/.test(t)) && vis(el)) { try { el.click(); } catch (e) {} last = now; return; }
    }
  };
  const start = () => { try { new MutationObserver(kill).observe(document.body, { childList: true, subtree: true }); } catch (e) {} kill(); };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
  setInterval(kill, 800);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fail fast with a clear message if the bridge port is taken (GlitchRecord dev
// running, or a stale run) — otherwise WSS creation throws a raw EADDRINUSE.
import net from "node:net";
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (e) =>
      e.code === "EADDRINUSE"
        ? reject(new Error(`Port ${port} is in use. Close the GlitchRecord dev app (or kill the stale process: \`lsof -ti :${port} | xargs kill -9\`) and re-run.`))
        : reject(e),
    );
    srv.once("listening", () => srv.close(() => resolve()));
    srv.listen(port);
  });
}
function toMp4(webm, mp4) {
  execFileSync("ffmpeg", ["-y", "-i", webm, "-vf", "scale=1280:800,setsar=1,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
}

// ───────────────────────── PART A: public browse on the live site ─────────────
async function recordBrowse() {
  const events = [];
  const wss = new WebSocketServer({ port: 7337 });
  const sid = `demo-${process.pid}`;
  // The bridge port (7337) is shared: the USER'S real Chrome extension also
  // connects here, so a recording:start reaches it too and turns its icon red.
  // Track every chrome client and send recording:stop to ALL of them on teardown
  // so no extension (demo's or the user's) is left stuck recording.
  const chromeClients = new Set();
  const stopAll = () => {
    for (const c of chromeClients) {
      try { c.send(JSON.stringify({ type: "recording:stop", sessionId: sid })); } catch { /* */ }
    }
  };
  wss.on("connection", (ws, req) => {
    const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
    if (role === "chrome") {
      chromeClients.add(ws);
      ws.on("close", () => chromeClients.delete(ws));
      ws.send(JSON.stringify({ type: "recording:start", sessionId: sid, repoId: slugOf(SITE), repoName: slugOf(SITE) }));
    }
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
  // POLL-dismiss the on-load modals with REAL clicks (location "Not Now", language
  // "Skip, use English", library login "Skip for now", promo ✕). Loops so LATE +
  // per-page modals are caught and actually closed — not left over the recording.
  // Dismiss on-load modals + cookie/consent banners across ANY site. Prefer
  // DECLINE for cookies (privacy); also handle app modals + close ✕.
  const dismissModals = async () => {
    for (let i = 0; i < 6; i++) {
      let did = false;
      const tryClick = async (loc) => {
        if ((await loc.count().catch(() => 0)) && (await loc.isVisible().catch(() => false))) {
          await loc.click({ timeout: 2500 }).catch(() => {}); await sleep(400); return true;
        }
        return false;
      };
      // cookie consent — decline first, then accept
      for (const re of [/^(Reject all|Decline|Only necessary|Reject)$/i, /^(Accept all|Accept|I agree|Got it|Allow all)$/i]) {
        if (await tryClick(page.getByRole("button", { name: re }).first())) { did = true; break; }
        if (await tryClick(page.getByText(re).first())) { did = true; break; }
      }
      // app modals (location/language/login) + close ✕
      for (const re of [/^Not Now$/i, /Skip,?\s*use English/i, /^Skip for now$/i, /^Maybe later$/i]) {
        if (await tryClick(page.getByText(re).first())) did = true;
      }
      if (await tryClick(page.getByRole("button", { name: /^close$/i }).first())) did = true;
      if (!did) break;
      await sleep(300);
    }
  };

  const visitedNames = [];
  try {
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2800);
    await page.evaluate(CURSOR_JS).catch(() => {});
    await dismissModals();                  // cookie/consent/app modals
    await sleep(400);
    await scrollBy(700); await scrollBy(-300); // view the page
    // Click 1–2 visible IN-SITE nav links (same-origin, keyword match).
    const origin = new URL(page.url()).origin;
    const navTargets = await page.locator("header a, nav a, a").evaluateAll((els, originArg) => {
      const re = /product|features|pricing|docs|about|learn|explore|home|blog|sign|get started/i;
      const out = [], seen = new Set();
      for (const e of els) {
        const href = e.getAttribute("href"); const text = (e.textContent || "").trim();
        if (!href || !text || text.length > 24) continue;
        let abs; try { abs = new URL(href, location.href).href; } catch { continue; }
        if (!abs.startsWith(originArg) || abs === location.href) continue;
        if (!re.test(text) && !re.test(href)) continue;
        if (seen.has(text)) continue; seen.add(text); out.push(text);
      }
      return out.slice(0, 4);
    }, origin).catch(() => []);
    for (const text of navTargets.slice(0, 2)) {
      const link = page.getByRole("link", { name: text, exact: true }).first();
      await clickEl(link).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await sleep(1200); await page.evaluate(CURSOR_JS).catch(() => {});
      await dismissModals();
      await scrollBy(500);
      visitedNames.push(text);
    }
    // hold-Shift on the main heading (or primary CTA) → an "explain this" note.
    let mark = page.locator("h1").first();
    if (!(await mark.count().catch(() => 0))) mark = page.getByRole("button").first();
    if (await mark.count().catch(() => 0)) {
      await mark.scrollIntoViewIfNeeded().catch(() => {});
      const b = await mark.boundingBox().catch(() => null);
      if (b && b.y > 60) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
        await sleep(700);
        await page.keyboard.down("Shift"); await sleep(1100); await page.keyboard.up("Shift");
        await sleep(800);
      }
    }
    await scrollBy(400);
    console.log("  browse FINAL:", page.url(), "| nav clicks", visitedNames.length);
  } catch (e) { console.log("  browse partial:", e.message.split("\n")[0], "at", page.url()); }
  await sleep(1500);

  // Stop recording on every connected extension (incl. the user's real one) and
  // give the messages a beat to flush BEFORE closing anything → no stuck-red icon.
  stopAll();
  await sleep(800);
  const video = page.video();
  await ctx.close(); wss.close();
  const webm = await video.path();
  toMp4(webm, BROWSE_MP4);
  fs.copyFileSync(BROWSE_MP4, FOOTAGE); // the recording the editor opens + exports
  fs.rmSync(PROJECT, { force: true });
  fs.rmSync(udd, { recursive: true, force: true });
  console.log(`  browse recorded → ${BROWSE_MP4} | events captured: ${events.length}`);
  return { visitedNames, events };
}

const API_BASE = process.env.GLITCHGRAB_API_URL ?? "http://localhost:3000";
const AUTH_SRC = path.join(os.homedir(), "Library/Application Support/GlitchRecord-dev/glitchgrab-auth.json");

// Create a real DB capture session from the browse events (unauthenticated, like
// the bridge's uploadSession) → returns its id so the editor can generate a script.
async function uploadSession(events) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/capture-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, meta: { source: "demo", site: "myabhyasika.in" } }),
    });
    const data = await res.json().catch(() => null);
    return data?.success ? (data.data?.sessionId ?? null) : null;
  } catch (e) { console.log("  uploadSession failed:", e.message); return null; }
}

// Seed the editor's userData so it launches LOGGED IN with the captured session —
// the script panel needs the auth token + a sessionId to generate from events.
function seedEditorUserData(udd, events, sessionId) {
  try {
    if (fs.existsSync(AUTH_SRC)) fs.copyFileSync(AUTH_SRC, path.join(udd, "glitchgrab-auth.json"));
    fs.writeFileSync(path.join(udd, "glitchgrab-last-session.json"), JSON.stringify({ events, sessionId }));
    return fs.existsSync(AUTH_SRC);
  } catch (e) { console.log("  seed failed:", e.message); return false; }
}

// slug → readable name fallback, e.g. "brains-hub-libraryreaders-lounge" → "Brains Hub".
function slugToName(href) {
  const slug = (href || "").split("/").filter(Boolean).pop() || "this library";
  return slug.replace(/-+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).split(" ").slice(0, 2).join(" ").trim();
}

// ───────────────────────── PART B: GlitchRecord real edits ─────────────────────
async function recordEdits(events, sessionId) {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "demo-ed-"));
  const loggedIn = seedEditorUserData(udd, events ?? [], sessionId); // log in + load the session
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

  // EDIT 1 — speed the clip up to 2x via the speed panel. (Deterministic: a
  // pixel-drag's speed depends on the timeline zoom and could blow the duration
  // up; the drag-stretch gesture itself is covered by clip-stretch.e2e.test.ts.)
  const clip = win.locator('[data-item-kind="clip"]').first();
  await clip.click(); await sleep(800);
  await win.locator('[data-testid="clip-speed-2"]').first().click().catch(() => {});
  await sleep(1500);
  const sp1 = await win.locator('[data-testid="clip-speed-badge"]').first().textContent().catch(() => "?");
  console.log("  EDIT1 speed 2x via panel:", sp1);

  // EDIT 2 — shift+click two points to carve a segment, THEN slow it to 0.5x so
  // the stretch is VISIBLE. (Carving alone keeps the segment at the clip's current
  // speed — if everything's already 2x, the carved clip looks identical. Changing
  // its speed is what demonstrates the per-segment stretch.) Carve auto-selects
  // the carved clip, so the speed panel acts on it.
  box = await canvas.boundingBox();
  await win.keyboard.down("Shift");
  await move(box.x + box.width * 0.4, box.y + 6); await win.mouse.click(box.x + box.width * 0.4, box.y + 6); await sleep(500);
  await move(box.x + box.width * 0.55, box.y + 6); await win.mouse.click(box.x + box.width * 0.55, box.y + 6);
  await win.keyboard.up("Shift"); await sleep(1500);
  await win.locator('[data-testid="clip-speed-0.5"]').first().click().catch(() => {});
  await sleep(1500);
  const carvedSpeeds = await win.locator('[data-testid="clip-speed-badge"]').allTextContents().catch(() => []);
  console.log("  EDIT2 carve → slow 0.5x | clip speeds:", JSON.stringify(carvedSpeeds));

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

  // SCRIPT PANEL — the in-app flow, on camera: open the writer and GENERATE a
  // narration script FROM the captured events (real Claude via the logged-in
  // session). Voice defaults to Ritu (F).
  let aiScript = "";
  let rituWav = "";
  if (loggedIn && sessionId) {
    // Open the GlitchGrab Log panel from the rail (it hosts the script writer).
    await win.locator('[title="GlitchGrab Log"]').first().click().catch(() => {});
    await sleep(1200);
    await win.locator('[data-testid="gg-script-toggle"]').first().click().catch(() => {});
    await sleep(1500);
    await win.locator('[data-testid="gg-generate-script"]').first().click().catch(() => {});
    // A hold-Shift NOTE triggers a "you marked N spots — what should I explain?"
    // interstitial that BLOCKS generation until answered. It renders a beat after
    // the click (the marked notes are detected async), so we POLL: every second,
    // (a) if the script already landed in the textarea → done; (b) if the
    // interstitial is up → pick the first suggested option + click "Write script".
    // The old single 2500ms check raced the interstitial and left it un-answered →
    // the whole run hung on that site until its timeout.
    const ta = win.locator('[data-testid="gg-narration-textarea"]').first();
    let answeredNoteQuestions = false;
    // ~150s window: v4-flash answers in ~8s, but a real noisy capture + the
    // Devanagari retry + network can stack up. A short window (was 60) timed out
    // before the script landed → false "0 chars". Defense-in-depth.
    for (let i = 0; i < 150; i++) {
      aiScript = (await ta.inputValue().catch(() => "")) || "";
      if (aiScript.trim().length > 20) break; // script generated → done
      const writeScriptBtn = win.getByRole("button", { name: /^Write script$/i }).first();
      if (
        (await writeScriptBtn.count().catch(() => 0)) &&
        (await writeScriptBtn.isVisible().catch(() => false))
      ) {
        // Pick the first suggested answer (labels start Explain/Describe/Mention/…),
        // then Write script. Selecting an option grounds the explanation in a pick.
        const opt = win
          .getByText(/^(Explain|Describe|Mention|Show|Point out|Highlight|Tell)\b/i)
          .first();
        if (await opt.count().catch(() => 0)) await opt.click().catch(() => {});
        await sleep(400);
        await writeScriptBtn.click().catch(() => {});
        if (!answeredNoteQuestions) console.log("  note-questions: answered first option + Write script");
        answeredNoteQuestions = true;
      }
      await sleep(1000);
    }
    console.log(`  SCRIPT from events (${aiScript.length} chars): ${JSON.stringify(aiScript.slice(0, 240))}`);
    // Persist the generated narration so script QUALITY can be reviewed per site
    // (the console log is lost when each site runs in its own spawned process).
    try {
      fs.writeFileSync(
        path.join(OUT, `script-${slugOf(SITE)}.txt`),
        `# ${SITE}\n# ${aiScript.length} chars · note-questions answered: ${answeredNoteQuestions}\n\n${aiScript}\n`,
        "utf8",
      );
    } catch { /* best effort */ }
    // Diagnostics: dump the bridge's generate-script log lines + any panel error.
    try {
      const dbg = fs.readFileSync(path.join(udd, "glitchgrab-debug.log"), "utf8").split("\n")
        .filter((l) => /generate-script|note-questions|auth|Log in|currentUser|Connected|token/i.test(l));
      console.log("  DEBUG:", JSON.stringify(dbg.slice(-8)));
    } catch { /* no log */ }
    const errTxt = await win.locator("text=/failed|error|log in|relaunch|balance/i").first().textContent().catch(() => null);
    if (errTxt) console.log("  PANEL ERROR:", errTxt.trim().slice(0, 160));

    // NARRATION on camera — the narrate + attach controls live in the NARRATION
    // tab (left panel), not the Script Writer drawer. Close the drawer, switch to
    // Narration, generate the Ritu voiceover, then add it to the timeline. Detect
    // "synth done" by the Generate-narration button re-enabling (disabled while
    // narrating) so we don't hang.
    if (aiScript.trim().length > 10) {
      await win.locator('[title="Close"]').first().click().catch(() => {}); // close Script Writer drawer
      await sleep(800);
      await win.getByRole("button", { name: /^Narration/ }).first().click().catch(() => {}); // Narration tab
      await sleep(1000);
      const narrateBtn = win.getByRole("button", { name: /Generate narration/i }).first();
      await narrateBtn.click().catch(() => {});
      await sleep(3000); // let `narrating` flip on (button disables)
      for (let i = 0; i < 150; i++) {
        const disabled = await narrateBtn.isDisabled().catch(() => false);
        if (!disabled) break; // re-enabled → synth finished
        await sleep(1000);
      }
      await sleep(1500);
      await win.getByRole("button", { name: /Add narration to video/i }).first().click().catch(() => {});
      await sleep(2500);
      console.log("  NARRATION (Ritu) generated + added to timeline on camera");
    }
  } else {
    console.log(`  SCRIPT panel skipped (loggedIn=${loggedIn}, sessionId=${sessionId})`);
  }
  await sleep(1500);

  // Save so the edits persist into <footage>.project.json → exported video bakes them in.
  await win.keyboard.press("Meta+s").catch(() => {});
  await sleep(2500);

  // Copy the Ritu narration wav OUT of the (about-to-be-deleted) udd via the audio
  // region the editor just added — used for the reliable export mux.
  try {
    const proj = JSON.parse(fs.readFileSync(PROJECT, "utf8"));
    const ar = (proj.editor?.audioRegions || []).find((a) => /narration-.*\.wav$/.test(a.audioPath || ""));
    if (ar && fs.existsSync(ar.audioPath)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      rituWav = path.join(AUDIO_DIR, "ritu-narration.wav");
      fs.copyFileSync(ar.audioPath, rituWav);
      console.log(`  ritu wav extracted from timeline (${fs.statSync(rituWav).size} bytes)`);
    } else { console.log("  ritu wav NOT in project audioRegions"); }
  } catch (e) { console.log("  ritu extract failed:", e.message.split("\n")[0]); }

  const video = win.video();
  const pid = app.process()?.pid;
  await app.close().catch(() => {});
  if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* */ } }
  const webm = await video.path();
  toMp4(webm, EDIT_MP4);
  fs.rmSync(udd, { recursive: true, force: true });
  console.log(`  edits recorded → ${EDIT_MP4}${fs.existsSync(PROJECT) ? " | project saved" : " | (no project saved)"}`);
  return { aiScript, rituWav };
}

// Synthesize the Ritu (F) voiceover OFF-CAMERA by running tts/narrate.py directly
// (same engine the app uses). Keeps the recorded editor session short — the slow
// TTS synth isn't worth watching. Returns the wav path or "" on failure.
function ttsNarrate(aiScript) {
  if (!aiScript || aiScript.trim().length < 10) return "";
  const py = path.join(APP, "tts", ".venv", "bin", "python");
  const script = path.join(APP, "tts", "narrate.py");
  if (!fs.existsSync(py) || !fs.existsSync(script)) { console.log("  narrate.py/venv missing"); return ""; }
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const txt = path.join(AUDIO_DIR, "ritu-script.txt");
  const wav = path.join(AUDIO_DIR, "ritu-narration.wav");
  fs.writeFileSync(txt, aiScript, "utf8");
  try {
    execFileSync(py, [script, "--engine", "sarvam", "--lang", "hi", "--voice", "ritu", "--speaker", "ritu", "--text-file", txt, "--out", wav], {
      cwd: path.join(APP, "tts"), stdio: "ignore", timeout: 180000,
    });
    if (fs.existsSync(wav)) { console.log(`  Ritu voiceover synthesized (${fs.statSync(wav).size} bytes)`); return wav; }
  } catch (e) { console.log("  ttsNarrate failed:", e.message.split("\n")[0]); }
  return "";
}

// Build caption cues from the REAL AI script, timed across the Ritu voiceover's
// duration (so captions and voice are the SAME words, roughly aligned). Splits the
// script into sentence cues with ≥500ms gaps so each shows as its own line.
function buildCuesFromScript(aiScript, rituWav) {
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", rituWav]).toString().trim());
  const durMs = Number.isFinite(dur) ? Math.round(dur * 1000) : 15000;
  const LEAD = 250;
  // Greedily pack words into short lines (≤ MAXCHARS) that each fit ONE caption
  // row, breaking at punctuation. The AI script's sentences are long + uneven, so
  // splitting only on sentence enders clips at maxRows:1.
  const MAXCHARS = 38;
  const words = aiScript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length > MAXCHARS && cur) { lines.push(cur); cur = w; }
    else cur = cand;
    if (/[।.!?—,:]$/.test(w) && cur.length >= 14) { lines.push(cur.replace(/[—,]$/, "")); cur = ""; }
  }
  if (cur.trim()) lines.push(cur.trim());
  if (!lines.length) lines.push(aiScript.trim());
  const span = Math.max(1000, durMs);
  const per = span / lines.length;
  const cues = lines.map((text, i) => {
    const s = Math.round(LEAD + per * i);
    const e = Math.round(LEAD + per * (i + 1) - 520); // ≥500ms gap → separate caption blocks
    const toks = text.split(/\s+/).filter(Boolean);
    const wPer = (e - s) / Math.max(1, toks.length);
    const words = toks.map((t, wi) => ({ text: t, startMs: Math.round(s + wPer * wi), endMs: Math.round(s + wPer * (wi + 1)), leadingSpace: wi > 0 }));
    return { id: `cue-${i}`, startMs: s, endMs: e, text, words };
  });
  return { cues, totalMs: LEAD + durMs, leadMs: LEAD };
}

// Mux a SINGLE continuous voiceover wav (the Ritu narration) into the export at
// `leadMs`, and trim the video to the narration length.
function finalizeWithVoiceWav(videoPath, voiceWav, leadMs, totalMs) {
  if (!fs.existsSync(videoPath) || !fs.existsSync(voiceWav)) { console.log("  voice mux: missing input"); return; }
  const endSec = ((totalMs + 500) / 1000).toFixed(2);
  const tmp = `${videoPath}.tmp.mp4`;
  const fc = `[1:a]adelay=${leadMs}|${leadMs}[aout]`;
  try {
    execFileSync("ffmpeg", ["-y", "-i", videoPath, "-i", voiceWav, "-filter_complex", fc, "-map", "0:v", "-map", "[aout]", "-t", endSec, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "160k", tmp], { stdio: "ignore" });
    fs.renameSync(tmp, videoPath);
    console.log(`  voice: muxed Ritu narration + trimmed to ${endSec}s`);
  } catch (e) { console.log("  voice mux failed:", e.message.split("\n")[0]); fs.rmSync(tmp, { force: true }); }
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

// ───────────────────────── narration script: write + refine 3× ────────────────
// We author the script (we know exactly what the demo did) and run it through 3
// refine passes — each pass measurably improves it. The passes ADAPT to the run:
// pass 2 injects the actual libraries that were visited.
function buildAndRefineScript(visited) {
  const libs = (visited && visited.length ? visited : ["this study library"]).slice(0, 3);
  // PASS 1 — rough draft: just name the steps.
  const v1 = [
    "This is MyAbhyasika.",
    "Browse study libraries.",
    "Open a library.",
    "See its details.",
    "Pick one.",
  ];
  // PASS 2 — add specifics: real library names + what each card shows.
  const v2 = [
    "Finding a quiet place to study?",
    "MyAbhyasika lists reading rooms near you.",
    "Scroll the available study libraries.",
    `Open ${libs[0]} to see its details.`,
    libs[1] ? `Compare options like ${libs[1]}.` : "Compare a few options.",
    libs[2] ? `Check ${libs[2]} too — photos, seats, price.` : "Check photos, seats and price.",
  ];
  // PASS 3 — polish: more, SHORTER one-liners (each fits a single caption row) so
  // the voiceover flows continuously across the video instead of a few lines with
  // long silent gaps. Hook up front, closing call-to-action.
  const v3 = [
    "Need a quiet place to study?",
    "MyAbhyasika finds rooms near you.",
    "Browse libraries by location.",
    "Filter by rating and price.",
    `Open ${libs[0]}.`,
    "See its seats and photos.",
    libs[1] ? `Compare ${libs[1]}.` : "Compare nearby options.",
    libs[2] ? `Check ${libs[2]} too.` : "Check a few more.",
    "Reserve your spot in seconds.",
  ];
  console.log("  SCRIPT refine pass 1 (draft):", JSON.stringify(v1));
  console.log("  SCRIPT refine pass 2 (specifics):", JSON.stringify(v2));
  console.log("  SCRIPT refine pass 3 (polished):", JSON.stringify(v3));
  return v3;
}

// Synthesize a line of narration to a wav using macOS `say` (no API key). Returns
// { wav, durMs } or null if TTS is unavailable.
function ttsLine(text, idx) {
  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const aiff = path.join(AUDIO_DIR, `cue-${idx}.aiff`);
    const wav = path.join(AUDIO_DIR, `cue-${idx}.wav`);
    try { execFileSync("say", ["-v", "Samantha", "-r", "175", "-o", aiff, text], { stdio: "ignore" }); }
    catch { execFileSync("say", ["-r", "175", "-o", aiff, text], { stdio: "ignore" }); }
    // STRIP leading + trailing silence (say pads clips) so lines pack tight — this
    // is what kills the "choppy / cutting" gaps. areverse trims the tail.
    const trim = "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB:detection=peak,areverse";
    execFileSync("ffmpeg", ["-y", "-i", aiff, "-af", trim, "-ar", "44100", "-ac", "2", wav], { stdio: "ignore" });
    const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString().trim());
    return { wav, durMs: Number.isFinite(dur) && dur > 0.2 ? Math.round(dur * 1000) : 1400 };
  } catch (e) { console.log("  tts failed:", e.message.split("\n")[0]); return null; }
}

// Synthesize every line, then pack them into a CONTINUOUS timeline (each line
// starts a small GAP after the previous one ends) so the voiceover flows with no
// long silent holes. Returns the cues (with their wav + word timings) and the
// total narration length — the video gets trimmed to that.
function buildNarration(lines) {
  fs.rmSync(AUDIO_DIR, { recursive: true, force: true });
  // GAP ≥ 500ms: keeps each caption its own BLOCK (renderer merges cues with
  // smaller gaps), while a ~0.5s pause between spoken lines is natural, not the
  // 2.5s holes that read as "cutting".
  const LEAD = 300, GAP = 520;
  let cursor = LEAD;
  const cues = [];
  lines.forEach((text, i) => {
    const a = ttsLine(text, i);
    const dur = a ? a.durMs : 1400;
    const s = cursor, e = cursor + dur;
    const toks = text.split(/\s+/).filter(Boolean);
    const wPer = dur / Math.max(1, toks.length);
    const words = toks.map((t, wi) => ({ text: t, startMs: Math.round(s + wPer * wi), endMs: Math.round(s + wPer * (wi + 1)), leadingSpace: wi > 0 }));
    cues.push({ id: `cue-${i}`, startMs: s, endMs: e, text, words, wav: a ? a.wav : null });
    cursor = e + GAP;
  });
  return { cues, totalMs: cursor - GAP };
}

// Write the prebuilt cues into the project as on-screen caption cues (one short
// line at a time) and enable captions.
function injectCaptions(projectPath, cues) {
  if (!fs.existsSync(projectPath)) { console.log("  captions: no project to inject into"); return 0; }
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const ed = project.editor || (project.editor = {});
  // Drop any narration audio region — its wav lived in the (now-deleted) editor
  // userData, so the export would fail with "No decodable audio sources found".
  // We mux the extracted Ritu wav ourselves after export instead.
  ed.audioRegions = [];
  ed.autoCaptions = cues.map(({ id, startMs, endMs, text, words }) => ({ id, startMs, endMs, text, words }));
  // maxRows: 1 → one short line at a time (a 2-row caption shows the current AND
  // previous cue together, which reads as "stacked").
  ed.autoCaptionSettings = { ...(ed.autoCaptionSettings || {}), enabled: true, maxRows: 1, fontSize: 34, bottomOffset: 8 };
  fs.writeFileSync(projectPath, JSON.stringify(project));
  console.log(`  captions: ${cues.length} cues enabled (continuous timeline)`);
}

// Finalize: trim the export to the narration length (no dead tail) AND mux the
// pre-synthesized voiceover (each line delayed to its cue start, mixed into one
// track) — both in a single ffmpeg pass. Done after export (not via editor audio
// regions, which get dropped inside speed-remapped clips, leaving a silent tail).
function finalizeWithNarration(videoPath, cues, totalMs) {
  if (!fs.existsSync(videoPath)) return;
  const withWav = cues.filter((c) => c.wav && fs.existsSync(c.wav));
  if (!withWav.length) { console.log("  narration: TTS unavailable, leaving as-is"); return; }
  const inputs = [], filters = [], labels = [];
  withWav.forEach((c, k) => {
    inputs.push("-i", c.wav);
    filters.push(`[${k + 1}:a]adelay=${c.startMs}|${c.startMs}[d${k}]`);
    labels.push(`[d${k}]`);
  });
  const endSec = ((totalMs + 500) / 1000).toFixed(2); // small tail after the last line
  const tmp = `${videoPath}.tmp.mp4`;
  const fc = `${filters.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0[aout]`;
  try {
    execFileSync("ffmpeg", ["-y", "-i", videoPath, ...inputs, "-filter_complex", fc, "-map", "0:v", "-map", "[aout]", "-t", endSec, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "160k", tmp], { stdio: "ignore" });
    fs.renameSync(tmp, videoPath);
    console.log(`  narration: muxed ${labels.length} lines + trimmed to ${endSec}s`);
  } catch (e) { console.log("  narration/trim failed:", e.message.split("\n")[0]); fs.rmSync(tmp, { force: true }); }
}

function killPort7337() {
  try { execFileSync("bash", ["-c", "lsof -ti :7337 | xargs -r kill -9"], { stdio: "ignore" }); } catch { /* */ }
}
const probe = (f) => fs.existsSync(f) ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim() : "MISSING";

// Run ONE site end-to-end: browse → edit → routine-<slug>.mp4 + exported-<slug>.mp4.
async function runOneSite(url) {
  setSite(url);
  const slug = slugOf(url);
  killPort7337();
  await assertPortFree(7337);
  console.log("PART A — public browse on", SITE, "…");
  const { visitedNames: visited, events } = await recordBrowse();

  console.log("SESSION — uploading captured events…");
  const sessionId = await uploadSession(events);
  console.log(`  sessionId: ${sessionId} (${events.length} events)`);

  console.log("PART B — GlitchRecord edits + AI script + Ritu narration on camera…");
  const { aiScript, rituWav: editorWav } = await recordEdits(events, sessionId);

  let rituWav = editorWav;
  if (!rituWav || !fs.existsSync(rituWav)) {
    console.log("NARRATION — on-camera wav missing, synthesizing off-camera…");
    rituWav = ttsNarrate(aiScript);
  }

  const realFlow = aiScript && aiScript.trim().length > 10 && rituWav && fs.existsSync(rituWav);
  let cues, narrMs, rituLeadMs = 0;
  if (realFlow) {
    console.log("SCRIPT — using AI script from events + Ritu voiceover");
    ({ cues, totalMs: narrMs, leadMs: rituLeadMs } = buildCuesFromScript(aiScript, rituWav));
  } else {
    console.log("SCRIPT — fallback: authored script + local say TTS");
    const script = buildAndRefineScript(visited);
    ({ cues, totalMs: narrMs } = buildNarration(script));
  }
  console.log(`  ${cues.length} caption cues across ${narrMs}ms`);
  injectCaptions(PROJECT, cues);

  const listf = path.join(OUT, `_list-${slug}.txt`);
  fs.writeFileSync(listf, `file '${BROWSE_MP4}'\nfile '${EDIT_MP4}'\n`);
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ROUTINE], { stdio: "ignore" });
  fs.rmSync(listf, { force: true });

  console.log("EXPORT — final export with captions (WebGL)…");
  await exportEdited();
  console.log("NARRATION — muxing voiceover + trimming…");
  if (realFlow) finalizeWithVoiceWav(EXPORTED, rituWav, rituLeadMs, narrMs);
  else finalizeWithNarration(EXPORTED, cues, narrMs);
  console.log(`  ✓ ${slug}: routine (${probe(ROUTINE)}s) + exported (${probe(EXPORTED)}s)`);
}

// ── Dispatcher ──────────────────────────────────────────────────────────────
// SINGLE-SITE mode (spawned by the runner): `node demo-videos.mjs <url>` runs ONE
// site in its OWN process, then exits — a crash/hang/leak can't derail the others.
const arg = process.argv[2];
if (arg && /^https?:/.test(arg)) {
  try { await runOneSite(arg); }
  catch (e) { console.log(`  ✗ ${slugOf(arg)} FAILED:`, String(e.message || e).split("\n")[0]); }
  finally { killPort7337(); }
  process.exit(0);
}

// RUNNER mode: spawn one isolated process per site, sequentially (port 7337 is a
// singleton). Each has a hard timeout so a hung site can't stall the batch.
const self = fileURLToPath(import.meta.url);
for (let i = 0; i < SITES.length; i++) {
  const url = SITES[i];
  console.log(`\n################ SITE ${i + 1}/${SITES.length}: ${url} (${slugOf(url)}) ################`);
  killPort7337();
  const r = spawnSync(process.execPath, [self, url], { stdio: "inherit", timeout: 6 * 60 * 1000 });
  if (r.status !== 0 || r.signal) console.log(`  ✗ ${slugOf(url)} process ended (status=${r.status} signal=${r.signal || "—"})`);
  killPort7337();
}

const done = SITES.map(slugOf).filter((s) =>
  fs.existsSync(path.join(OUT, `routine-${s}.mp4`)) && fs.existsSync(path.join(OUT, `exported-${s}.mp4`)),
);
console.log(`\n################ DONE: ${done.length}/${SITES.length} sites → ${done.length * 2} videos in ${OUT} ################`);
for (const s of done) {
  console.log(`  ${s}: routine-${s}.mp4 (${probe(path.join(OUT, `routine-${s}.mp4`))}s) + exported-${s}.mp4 (${probe(path.join(OUT, `exported-${s}.mp4`))}s)`);
}
