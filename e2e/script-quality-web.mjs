// TEXT-MODE script-quality harness — GENERIC public-web stress test for the
// GlitchGrab "scripter" (AI narration). Drives a real Chrome (with the
// GlitchGrab extension capturing events) over a LIST of ~10 diverse public
// sites, uploads the captured events as a DB capture-session, asks the web API
// to GENERATE an ENGLISH narration script (lang:"en"), and PRINTS it. NO video.
//
// This is a sibling of script-quality.mjs (which is myabhyasika-specific, lang:"hi").
// Do NOT modify script-quality.mjs.
//
// Run (from apps/glitchrecord):  bun run script-quality:web   (or: node e2e/script-quality-web.mjs)
// Needs: web API on :3000, built extension (packages/extension/dist), logged-in
//        glitchgrab-auth.json. Port 7337 freed per-site by the runner.
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import net from "node:net";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const EXT = path.resolve(APP, "../../packages/extension/dist");
const SIZE = { width: 1280, height: 800 };
const API_BASE = process.env.GLITCHGRAB_API_URL ?? "http://localhost:3000";
const AUTH_SRC = path.join(os.homedir(), "Library/Application Support/GlitchRecord-dev/glitchgrab-auth.json");
const LANG = "en"; // English scripts — legible + tests the English framing path.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The ~10 diverse public sites to stress the scripter.
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

// Synthetic cursor (Playwright doesn't render the OS pointer) — cosmetic, kept
// so capture sees a visible interaction context like the real flow.
const CURSOR_JS = `(() => {
  if (window.__ggCursor) return; window.__ggCursor = 1;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:-100px;top:-100px;width:20px;height:20px;border-radius:50%;background:rgba(255,40,40,.5);border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%)';
  (document.body||document.documentElement).appendChild(d);
  addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';},true);
})();`;

function killPort(port) {
  try {
    // NEVER kill our own PID — the in-process WS server (ws on :7337) means
    // lsof reports THIS script. Filter self out (else we SIGKILL the harness;
    // this was the real site-N crash, not "Chromium pressure"). assertPortFree
    // then waits out the in-process release.
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8", shell: "/bin/bash" });
    const pids = out.split("\n").map((s) => s.trim()).filter(Boolean).filter((p) => p !== String(process.pid));
    if (pids.length) execSync(`kill -9 ${pids.join(" ")}`, { stdio: "ignore", shell: "/bin/bash" });
  } catch { /* nothing bound — fine */ }
}

// Fail fast if the bridge port is taken; also used as a gate BETWEEN sites
// (wss.close() doesn't release the port synchronously).
async function assertPortFree(port) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port);
    });
    if (ok) return;
    await sleep(300);
  }
  throw new Error(`Port ${port} stayed in use. Close GlitchRecord dev (or: lsof -ti :${port} | xargs kill -9) and re-run.`);
}

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_SRC, "utf8")).token ?? null;
  } catch { return null; }
}

async function uploadSession(events, site) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/capture-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, meta: { source: "script-test-web", site } }),
    });
    const data = await res.json().catch(() => null);
    return data?.success ? (data.data?.sessionId ?? null) : null;
  } catch (e) { console.log("  uploadSession failed:", e.message); return null; }
}

async function generateScript(token, sessionId, durationSec) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/capture-sessions/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lang: LANG, durationSec, zooms: [] }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.data?.script) {
      return { error: data?.error || `Script API ${res.status}` };
    }
    return { script: data.data.script };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
  }
}

// ───────────────────────── per-site core ──────────────────────────────────────
// Mirrors script-quality.mjs runScenario: stands up the WS bridge, launches a
// persistent Chrome with the extension, waits for the extension to connect, does
// the landing goto (grounding the home-navigate/hero event), then runs `flow`.
async function runSite(n, url) {
  killPort(7337);
  await assertPortFree(7337);
  const events = [];
  const wss = new WebSocketServer({ port: 7337 });
  const sid = `script-test-web-${process.pid}-${n}`;
  const chromeClients = new Set();
  let connected = false;
  wss.on("connection", (ws, req) => {
    const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
    if (role === "chrome") {
      connected = true;
      chromeClients.add(ws);
      ws.on("close", () => chromeClients.delete(ws));
      ws.send(JSON.stringify({ type: "recording:start", sessionId: sid, repoId: "web", repoName: "web" }));
    }
    ws.on("message", (r) => {
      try { const m = JSON.parse(r.toString()); if (m.type === "event:live" && m.event) events.push(m.event); } catch { /* */ }
    });
  });
  const stopAll = () => {
    for (const c of chromeClients) {
      try { c.send(JSON.stringify({ type: "recording:stop", sessionId: sid })); } catch { /* */ }
    }
  };

  const udd = fs.mkdtempSync(path.join(os.tmpdir(), `sqw-${n}-`));
  const ctx = await chromium.launchPersistentContext(udd, {
    headless: false, viewport: SIZE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
  });
  await ctx.addInitScript({ content: CURSOR_JS });
  let [w] = ctx.serviceWorkers(); if (!w) await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => {});
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  // Helpers (best-effort: never throw, degrade gracefully on a missing element).
  const hoverEl = async (loc) => { const box = await loc.boundingBox().catch(() => null); if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 }); await sleep(300); } };
  const clickEl = async (loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await hoverEl(loc); await loc.click({ timeout: 6000 }).catch(() => {}); await sleep(900); };
  const scrollBy = async (dy) => { for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dy / 6); await sleep(180); } await sleep(600); };

  // Generic consent/cookie banner dismisser. Prefer DECLINE for privacy; fall
  // back to accept variants. Best-effort, never throws.
  const dismissBanner = async () => {
    const tries = [
      /^Reject all$/i, /^Reject$/i, /^Decline$/i, /^Decline all$/i, /Only necessary/i,
      /Reject non-essential/i, /^No,? thanks$/i,
      /^Accept all$/i, /^Accept$/i, /^Got it$/i, /^I agree$/i, /^Agree$/i, /^Allow all$/i, /^OK$/i,
    ];
    for (const re of tries) {
      try {
        const btn = page.getByRole("button", { name: re }).first();
        if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 3000 }).catch(() => {}); await sleep(700); return; }
        const txt = page.getByText(re).first();
        if (await txt.count().catch(() => 0)) { await txt.click({ timeout: 3000 }).catch(() => {}); await sleep(700); return; }
      } catch { /* keep trying */ }
    }
  };

  const helpers = { page, hoverEl, clickEl, scrollBy, dismissBanner, sleep, url, CURSOR_JS };

  // Landing goto FIRST + wait for the extension to actually be capturing before
  // driving the flow — otherwise the home navigate (carrying the hero/title that
  // grounds product framing) is missed.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  for (let i = 0; i < 30 && !connected; i++) await sleep(500);
  await sleep(2500); // recording:start → CAPTURE_START → content script attaches + emits navigate

  try {
    await genericFlow(helpers);
  } catch (e) {
    console.log(`  site ${n} flow partial:`, String(e.message).split("\n")[0], "at", page.url());
  }
  await sleep(1000);
  if (!connected) await sleep(2000);

  stopAll();
  await sleep(800);
  await ctx.close();
  wss.close();
  fs.rmSync(udd, { recursive: true, force: true });

  return { events, connected };
}

// ───────────────────────── the generic flow ───────────────────────────────────
// Core already navigated + waited for connect. We just interact:
//  1. dismiss consent banner (prefer decline)
//  2. scroll down/up to view the page
//  3. click 1-2 same-origin in-site nav links/buttons
//  4. hold-Shift over the main H1 (or primary CTA) → "explain this" note
async function genericFlow({ page, clickEl, hoverEl, scrollBy, dismissBanner }) {
  await page.evaluate(CURSOR_JS).catch(() => {});
  await dismissBanner();
  await sleep(400);

  // 2. View the page.
  await scrollBy(700);
  await scrollBy(-300);
  await sleep(300);

  // 3. Click 1-2 visible IN-SITE nav links/buttons (same-origin href matching keywords).
  const origin = new URL(page.url()).origin;
  const navHrefs = await page.locator("header a, nav a, a").evaluateAll(
    (els, originArg) => {
      const re = /product|features|pricing|docs|about|learn|explore|home|blog|sign|get started/i;
      const out = [];
      const seen = new Set();
      for (const e of els) {
        const href = e.getAttribute("href");
        const text = (e.textContent || "").trim();
        if (!href || !text) continue;
        let abs;
        try { abs = new URL(href, location.href).href; } catch { continue; }
        if (!abs.startsWith(originArg)) continue;        // same-origin only
        if (abs === location.href) continue;             // skip self
        if (!re.test(text) && !re.test(href)) continue;  // keyword match
        if (seen.has(abs)) continue;
        seen.add(abs);
        out.push({ href, text });
      }
      return out.slice(0, 6);
    },
    origin,
  ).catch(() => []);

  let clicks = 0;
  for (const { text } of navHrefs) {
    if (clicks >= 2) break;
    const link = page.getByRole("link", { name: text, exact: true }).first();
    const cnt = await link.count().catch(() => 0);
    const target = cnt ? link : page.getByText(text, { exact: true }).first();
    if (!(await target.count().catch(() => 0))) continue;
    await clickEl(target);
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await sleep(1200);
    await page.evaluate(CURSOR_JS).catch(() => {});
    await dismissBanner();
    await scrollBy(400);
    clicks++;
  }

  // 4. Hold-Shift "explain this" over the main H1 (prefer) or the primary CTA.
  //    H1 injects the page's hero text into the note event → grounds product framing.
  let target = null, label = "";
  const h1 = page.locator("h1").first();
  if (await h1.count().catch(() => 0) && await h1.isVisible().catch(() => false)) {
    target = h1; label = "main H1";
  } else {
    const cta = page.getByRole("button").first();
    if (await cta.count().catch(() => 0)) { target = cta; label = "primary button"; }
  }
  if (!target) { console.log("  no hold-Shift target found"); return; }
  console.log(`  hold-Shift target = "${label}"`);
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox().catch(() => null);
  if (!box) { console.log("  hold-Shift target had no bounding box"); return; }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await sleep(1000);
  await page.keyboard.down("Shift");
  await sleep(1200); // ≥400ms hold → "note"/"explain" event
  await page.keyboard.up("Shift");
  await sleep(1000);
  await scrollBy(200);
  await sleep(600);
}

function typeBreakdown(events) {
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  return Object.entries(counts).map(([t, c]) => `${t}:${c}`).join(", ");
}

function durationSecFor(events) {
  const ts = events.map((e) => e.t).filter((t) => typeof t === "number");
  if (ts.length < 2) return 20;
  return Math.max(5, Math.round((Math.max(...ts) - Math.min(...ts)) / 1000));
}

// ───────────────────────── main ───────────────────────────────────────────────
const token = readToken();
if (!token) { console.error("No auth token in", AUTH_SRC, "— log in to GlitchRecord first."); process.exit(1); }

const apiCode = await fetch(`${API_BASE}/`).then((r) => r.status).catch(() => 0);
if (apiCode !== 200) { console.error(`web app not running on :3000 (got ${apiCode})`); process.exit(1); }

const results = [];
for (let i = 0; i < SITES.length; i++) {
  const url = SITES[i];
  const n = i + 1;
  console.error(`\n[running site ${n}/${SITES.length}: ${url}] …`);
  let events = [], connected = false, fatal = null;
  try {
    ({ events, connected } = await runSite(n, url));
  } catch (e) {
    fatal = String(e.message).split("\n")[0];
    console.error(`  site ${n} FATAL:`, fatal);
  }
  console.error(`  extension connected: ${connected} | events: ${events.length}${fatal ? " | fatal: " + fatal : ""}`);
  const durationSec = durationSecFor(events);
  let sessionId = null, gen = { error: fatal ? `site fatal: ${fatal}` : "skipped (no events)" };
  if (!fatal && events.length > 0) {
    sessionId = await uploadSession(events, url);
    if (!sessionId) gen = { error: "uploadSession returned no sessionId" };
    else gen = await generateScript(token, sessionId, durationSec); // ONE generate per site, no retry
  }
  const r = { n, url, events, connected, durationSec, sessionId, gen, fatal };
  results.push(r);

  // Print THIS site's block IMMEDIATELY after its generate (not batched at the
  // end) — a crash on a later site then can't lose the scripts already produced.
  console.log(`\n=== SITE ${r.n}: ${r.url} ===`);
  console.log(`events: ${r.events.length} | types: ${typeBreakdown(r.events)}`);
  console.log(`durationSec: ${r.durationSec} | sessionId: ${r.sessionId ?? "(none)"} | ext connected: ${r.connected}${r.fatal ? " | FATAL: " + r.fatal : ""}`);
  if ("script" in r.gen) {
    console.log(`SCRIPT:\n${r.gen.script}\n`);
  } else {
    console.log(`SCRIPT GENERATION FAILED/SKIPPED: ${r.gen.error}\n`);
  }
}

// ───────────────────────── summary (scripts already printed per-site) ──────────
const ok = results.filter((r) => "script" in r.gen).length;
console.log(`\n[summary] ${ok}/${results.length} sites produced a script`);
console.log("########################################################################");
process.exit(0);
