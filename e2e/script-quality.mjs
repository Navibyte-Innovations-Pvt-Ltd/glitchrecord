// TEXT-MODE script-quality harness for the GlitchGrab "scripter" (AI narration).
//
// Drives a real Chrome (with the GlitchGrab extension capturing events) over the
// PUBLIC, no-login https://www.myabhyasika.in/ site across 3 scenarios, uploads
// the captured events as a DB capture-session, asks the web API to GENERATE a
// narration script, and PRINTS it. NO video is recorded or rendered.
//
// Run (from apps/glitchrecord):  bun run script-quality   (or: node e2e/script-quality.mjs)
// Needs: web API on :3000, built extension (packages/extension/dist), logged-in
//        glitchgrab-auth.json. Port 7337 must be free (close GlitchRecord dev).
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const EXT = path.resolve(APP, "../../packages/extension/dist");
const SITE = "https://www.myabhyasika.in/";
const SIZE = { width: 1280, height: 800 };
const API_BASE = process.env.GLITCHGRAB_API_URL ?? "http://localhost:3000";
const AUTH_SRC = path.join(os.homedir(), "Library/Application Support/GlitchRecord-dev/glitchgrab-auth.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Synthetic cursor (Playwright doesn't render the OS pointer) — purely cosmetic,
// kept so the capture sees a visible interaction context like the real flow.
const CURSOR_JS = `(() => {
  if (window.__ggCursor) return; window.__ggCursor = 1;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:-100px;top:-100px;width:20px;height:20px;border-radius:50%;background:rgba(255,40,40,.5);border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%)';
  (document.body||document.documentElement).appendChild(d);
  addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';},true);
})();`;

// Fail fast if the bridge port is taken; also used as a gate BETWEEN scenarios
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

async function uploadSession(events) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/capture-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, meta: { source: "script-test", site: "myabhyasika.in" } }),
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
      body: JSON.stringify({ lang: "hi", durationSec, zooms: [] }),
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

// ───────────────────────── per-scenario core ──────────────────────────────────
async function runScenario(n, name, flow) {
  await assertPortFree(7337);
  const events = [];
  const wss = new WebSocketServer({ port: 7337 });
  const sid = `script-test-${process.pid}-${n}`;
  const chromeClients = new Set();
  let connected = false;
  wss.on("connection", (ws, req) => {
    const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
    if (role === "chrome") {
      connected = true;
      chromeClients.add(ws);
      ws.on("close", () => chromeClients.delete(ws));
      ws.send(JSON.stringify({ type: "recording:start", sessionId: sid, repoId: "myabhyasika", repoName: "myabhyasika" }));
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

  const udd = fs.mkdtempSync(path.join(os.tmpdir(), `sq-${n}-`));
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
  const dismiss = async (re) => { const el = page.getByText(re).first(); if (await el.count().catch(() => 0)) { await clickEl(el).catch(() => {}); await sleep(500); } };
  const dismissModals = async () => {
    await dismiss(/^Not Now$/i);            // location prompt — decline (do NOT grant)
    await dismiss(/Skip,?\s*use English/i); // language modal
    await sleep(500);
  };
  const helpers = { page, hoverEl, clickEl, scrollBy, dismiss, dismissModals, sleep, SITE, CURSOR_JS };

  try {
    await flow(helpers);
  } catch (e) {
    console.log(`  scenario ${n} flow partial:`, e.message.split("\n")[0], "at", page.url());
  }
  await sleep(1000);

  // Wait for the extension SW to have connected (capture chain hangs silently otherwise).
  if (!connected) await sleep(2000);

  stopAll();
  await sleep(800);
  await ctx.close();
  wss.close();
  fs.rmSync(udd, { recursive: true, force: true });

  return { events, connected };
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

// ───────────────────────── the 3 scenarios ────────────────────────────────────
// S1 — Owner viewing their own library page: open home, click ONE library card,
// thoroughly view it (overview scroll, AMENITIES/REVIEWS/LOCATION tabs, hover
// price + Book Seat).
async function scenarioOwner({ page, clickEl, hoverEl, scrollBy, dismissModals }) {
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2500);
  await page.evaluate(CURSOR_JS).catch(() => {});
  await dismissModals();
  await scrollBy(500);
  const hrefs = await page.locator('a[href^="/library/"]').evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  ).catch(() => []);
  const href = hrefs[0];
  if (href) {
    const card = page.locator(`a[href="${href}"]`).first();
    await clickEl(card);
    await page.waitForURL((u) => u.pathname.includes("/library/"), { timeout: 8000 }).catch(() => {});
    if (!page.url().includes("/library/")) {
      await page.goto(new URL(href, SITE).href, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  await sleep(1800); await page.evaluate(CURSOR_JS).catch(() => {});
  await scrollBy(500); await sleep(400);          // overview
  for (const tab of [/^AMENITIES$/i, /^REVIEWS$/i, /^LOCATION$/i]) {
    const t = page.getByText(tab).first();
    if (await t.count().catch(() => 0)) { await clickEl(t); await scrollBy(300); }
  }
  const price = page.getByText(/₹.*month/i).first();
  if (await price.count().catch(() => 0)) await hoverEl(price);
  const book = page.getByText(/Book Seat/i).first();
  if (await book.count().catch(() => 0)) await hoverEl(book);
  await sleep(800);
}

// S2 — Student browsing: home, scroll list, open 2 different cards (compare), on
// one view pricing + scroll to seats/timings/Book Seat, go back.
async function scenarioStudent({ page, clickEl, scrollBy, dismissModals }) {
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2500);
  await page.evaluate(CURSOR_JS).catch(() => {});
  await dismissModals();
  await scrollBy(700); await scrollBy(-300);       // browse the list
  const hrefs = await page.locator('a[href^="/library/"]').evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  ).catch(() => []);
  const pick = [hrefs[0], hrefs[3]].filter(Boolean).slice(0, 2);
  let first = true;
  for (const href of pick) {
    if (!/myabhyasika\.in\/?$/.test(page.url())) {
      await page.goto(SITE, { waitUntil: "domcontentloaded" }).catch(() => {});
      await sleep(1500); await page.evaluate(CURSOR_JS).catch(() => {});
      await dismissModals();
    }
    const card = page.locator(`a[href="${href}"]`).first();
    await clickEl(card);
    await page.waitForURL((u) => u.pathname.includes("/library/"), { timeout: 8000 }).catch(() => {});
    if (!page.url().includes("/library/")) {
      await page.goto(new URL(href, SITE).href, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    await sleep(1600); await page.evaluate(CURSOR_JS).catch(() => {});
    if (first) {
      // On the FIRST library, dig into pricing + seats/timings + Book Seat.
      await scrollBy(450);
      const price = page.getByText(/₹.*month/i).first();
      if (await price.count().catch(() => 0)) await price.scrollIntoViewIfNeeded().catch(() => {});
      await scrollBy(400);
      const book = page.getByText(/Book Seat/i).first();
      if (await book.count().catch(() => 0)) await book.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(600);
      first = false;
    } else {
      await scrollBy(400);
    }
  }
}

// S3 — Explain-this on a component: open a library detail page, then HOLD Shift
// (~900ms) over a SPECIFIC component (Book Seat → price → View all photos).
async function scenarioExplain({ page, scrollBy, dismissModals }) {
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 }); await sleep(2500);
  await page.evaluate(CURSOR_JS).catch(() => {});
  await dismissModals();
  const hrefs = await page.locator('a[href^="/library/"]').evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  ).catch(() => []);
  const href = hrefs[0];
  if (href) await page.goto(new URL(href, SITE).href, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1800); await page.evaluate(CURSOR_JS).catch(() => {});
  await scrollBy(300);

  // Pick a target component, in order of preference.
  let target = null, label = "";
  for (const [re, name] of [[/Book Seat/i, "Book Seat"], [/₹.*month/i, "price"], [/View all .*photos/i, "View all photos"]]) {
    const el = page.getByText(re).first();
    if (await el.count().catch(() => 0)) { target = el; label = name; break; }
  }
  if (!target) { console.log("  S3: no explain target found"); return; }
  console.log(`  S3: explain-this target = "${label}"`);
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox().catch(() => null);
  if (!box) { console.log("  S3: target had no bounding box"); return; }
  // Move ONTO the target, settle, then HOLD Shift ~900ms with no other key/move.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await sleep(600);
  await page.keyboard.down("Shift");
  await sleep(900);
  await page.keyboard.up("Shift");
  await sleep(800);
}

// ───────────────────────── main ───────────────────────────────────────────────
const token = readToken();
if (!token) { console.error("No auth token in", AUTH_SRC, "— log in to GlitchRecord first."); process.exit(1); }

const apiCode = await fetch(`${API_BASE}/`).then((r) => r.status).catch(() => 0);
if (apiCode !== 200) { console.error(`web app not running on :3000 (got ${apiCode})`); process.exit(1); }

const scenarios = [
  ["Owner viewing their own library page", scenarioOwner],
  ["Student browsing the site", scenarioStudent],
  ["Explain-this on a component", scenarioExplain],
];

const results = [];
for (let i = 0; i < scenarios.length; i++) {
  const [name, flow] = scenarios[i];
  const n = i + 1;
  console.error(`\n[running scenario ${n}: ${name}] …`);
  const { events, connected } = await runScenario(n, name, flow);
  console.error(`  extension connected: ${connected} | events: ${events.length}`);
  const durationSec = durationSecFor(events);
  let sessionId = null, gen = { error: "skipped (no events)" };
  if (events.length > 0) {
    sessionId = await uploadSession(events);
    if (!sessionId) gen = { error: "uploadSession returned no sessionId" };
    else gen = await generateScript(token, sessionId, durationSec);
  }
  results.push({ n, name, events, connected, durationSec, sessionId, gen });
}

// ───────────────────────── print the deliverable ──────────────────────────────
console.log("\n\n############## SCRIPT-QUALITY RESULTS (lang: hi → Hinglish) ##############");
for (const r of results) {
  console.log(`\n=== SCENARIO ${r.n}: ${r.name} ===`);
  console.log(`events: ${r.events.length} | types: ${typeBreakdown(r.events)}`);
  console.log(`durationSec: ${r.durationSec} | sessionId: ${r.sessionId ?? "(none)"} | ext connected: ${r.connected}`);
  if ("script" in r.gen) {
    console.log(`SCRIPT:\n${r.gen.script}\n`);
  } else {
    console.log(`SCRIPT GENERATION FAILED: ${r.gen.error}\n`);
  }
}
console.log("########################################################################");
process.exit(0);
