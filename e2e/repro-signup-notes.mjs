// REPRODUCTION — "my 3 shift-marks on the signup options were ignored".
//
// Mirrors the user's REAL flow on the dev app (localhost:3333):
//   home → click "Sign Up" → on the signup screen, HOLD Shift (~700ms, a PROPER
//   hold, not a tap) over each auth option (Google / Phone / Email), one after
//   another → stop → dump the captured events.
//
// It DISCRIMINATES the two competing root causes for the missing marks:
//   • TAP theory   — capturing stayed ON; the user TAPPED Shift (<400ms) so the
//                    hold threshold dropped the marks. (Then proper holds here
//                    WILL capture 3 notes → fix is "make taps count".)
//   • RACE theory  — a capturing-OFF window after the Sign-Up navigation ate the
//                    gestures. (Then proper holds STILL miss → fix is in capture.)
// The deciding signal it prints: did a navigate to /signup appear, and how many
// notes landed on the signup screen despite PROPER holds.
//
// Run (from apps/glitchrecord, with GlitchRecord dev CLOSED so :7337 is free):
//   node e2e/repro-signup-notes.mjs
// Needs: dev app on :3333 (with /signup), built extension (packages/extension/dist).
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
const SITE = process.env.REPRO_SITE ?? "http://localhost:3333/";
// Shift dwell in ms. Default 80 = a quick TAP (below the 400ms hold threshold) —
// this is what the user actually does ("clicked shift 3 times"). Set REPRO_HOLD_MS
// to 700 to test the proper-HOLD path instead.
const HOLD_MS = Number(process.env.REPRO_HOLD_MS ?? 80);
const SIZE = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  throw new Error(`Port ${port} in use. Close GlitchRecord dev (or: lsof -ti :${port} | xargs kill -9) and re-run.`);
}

const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u ?? ""; } };

async function main() {
  await assertPortFree(7337);
  const events = [];
  const wss = new WebSocketServer({ port: 7337 });
  const sid = `repro-signup-${process.pid}`;
  const chromeClients = new Set();
  let connected = false;
  wss.on("connection", (ws, req) => {
    const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
    if (role !== "chrome") return;
    connected = true;
    chromeClients.add(ws);
    ws.on("close", () => chromeClients.delete(ws));
    ws.send(JSON.stringify({ type: "recording:start", sessionId: sid, repoId: "repro", repoName: "repro" }));
    ws.on("message", (r) => {
      try { const m = JSON.parse(r.toString()); if (m.type === "event:live" && m.event) events.push(m.event); } catch { /* */ }
    });
  });
  const stopAll = () => { for (const c of chromeClients) { try { c.send(JSON.stringify({ type: "recording:stop", sessionId: sid })); } catch { /* */ } } };

  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "repro-signup-"));
  const ctx = await chromium.launchPersistentContext(udd, {
    headless: false, viewport: SIZE,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
  });
  let [w] = ctx.serviceWorkers(); if (!w) await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => {});
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const holdShiftOver = async (loc, name) => {
    if (!(await loc.count().catch(() => 0))) { console.log(`  HOLD skip (not found): ${name}`); return false; }
    if (!(await loc.isVisible().catch(() => false))) { console.log(`  HOLD skip (hidden): ${name}`); return false; }
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) { console.log(`  HOLD skip (no box): ${name}`); return false; }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await sleep(500);
    await page.evaluate(() => window.getSelection()?.removeAllRanges()).catch(() => {});
    await sleep(200);
    await page.keyboard.down("Shift");
    await sleep(HOLD_MS);
    await page.keyboard.up("Shift");
    await sleep(600);
    console.log(`  SHIFT ${HOLD_MS < 400 ? "TAP" : "HOLD"} (~${HOLD_MS}ms): ${name} @y=${Math.round(box.y)}`);
    return true;
  };
  const dismissModals = async () => {
    for (let i = 0; i < 6; i++) {
      let did = false;
      for (const re of [/^Not Now$/i, /Skip,?\s*use English/i, /^Skip for now$/i, /^Maybe later$/i, /^Close$/i]) {
        const el = page.getByText(re).first();
        if ((await el.count().catch(() => 0)) && (await el.isVisible().catch(() => false))) { await el.click({ timeout: 3000 }).catch(() => {}); did = true; await sleep(400); }
      }
      if (!did) break; await sleep(400);
    }
  };

  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  for (let i = 0; i < 30 && !connected; i++) await sleep(500);
  await sleep(2500); // recording:start → CAPTURE_START → content script attaches + emits home navigate
  console.log(`connected=${connected} url=${page.url()}`);

  await dismissModals();

  // Click "Sign Up" exactly like the user (a link/button to the signup screen).
  const signup = page.getByRole("link", { name: /^sign ?up$/i }).first();
  const signupBtn = (await signup.count().catch(() => 0)) ? signup : page.getByRole("button", { name: /^sign ?up$/i }).first();
  if (await signupBtn.count().catch(() => 0)) {
    await signupBtn.click({ timeout: 6000 }).catch(() => {});
    await sleep(2500);
  } else {
    console.log("  Sign Up control not found; going to /signup directly");
    await page.goto(new URL("/signup", SITE).href, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(2500);
  }
  await dismissModals();
  console.log(`after Sign Up: url=${page.url()}`);

  // HOLD Shift over each auth option, one after another (a CLUSTER).
  const optionMatchers = [
    { re: /continue with google|google/i, name: "Google" },
    { re: /phone|mobile|otp/i, name: "Phone" },
    { re: /email|e-?mail/i, name: "Email" },
  ];
  let marked = 0;
  for (const { re, name } of optionMatchers) {
    const loc = page.getByText(re).first();
    if (await holdShiftOver(loc, name)) marked++;
  }
  console.log(`  marked ${marked}/3 signup auth options with PROPER holds`);

  await sleep(1000);
  stopAll();
  await sleep(800);
  await ctx.close();
  wss.close();
  fs.rmSync(udd, { recursive: true, force: true });

  // ── Verdict ──────────────────────────────────────────────────────────────
  console.log("\n===== CAPTURED EVENTS =====");
  for (const e of events) {
    const tag = e.type === "note" ? "NOTE" : e.type;
    console.log(`  ${String(e.t).padStart(6)}ms ${tag.padEnd(9)} ${pathOf(e.url).padEnd(14)} ${(e.label ?? "").slice(0, 48)}`);
  }
  const navs = events.filter((e) => e.type === "navigate");
  const signupNav = navs.find((e) => /signup/i.test(pathOf(e.url)) || /signup/i.test(e.url ?? ""));
  const notesOnSignup = events.filter((e) => e.type === "note" && /signup/i.test(e.url ?? ""));
  const allNotes = events.filter((e) => e.type === "note");
  console.log("\n===== VERDICT =====");
  console.log(`navigate events: ${navs.map((e) => pathOf(e.url)).join(", ") || "(none)"}`);
  console.log(`navigate to /signup present? ${signupNav ? "YES" : "NO"}`);
  console.log(`notes on /signup screen: ${notesOnSignup.length} (labels: ${notesOnSignup.map((e) => e.label).join(" | ") || "—"})`);
  console.log(`total notes captured: ${allNotes.length} (labels: ${allNotes.map((e) => e.label).join(" | ") || "—"})`);
  const mode = HOLD_MS < 400 ? `quick TAP (~${HOLD_MS}ms)` : `proper HOLD (~${HOLD_MS}ms)`;
  console.log("\nINTERPRETATION:");
  if (notesOnSignup.length >= 2) {
    console.log(`  → ${mode} on each option DID capture ≥2 notes on signup. ✔`);
    if (HOLD_MS < 400) console.log("    The tap-as-mark fix works: a quick Shift tap on a control now marks it (matches what the user does).");
  } else {
    console.log(`  → ${mode} MISSED on signup (${notesOnSignup.length} notes).`);
    console.log(`    (signup navigate ${signupNav ? "present" : "MISSING"}).`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("repro failed:", e); process.exit(1); });
