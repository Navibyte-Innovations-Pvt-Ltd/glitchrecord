// Records the ACTUAL browser footage of an abhyasika flow (not a placeholder)
// while the extension captures events, then converts it to mp4 so the editor can
// open the real video.  node e2e/record-flow.mjs  →  /tmp/abhyasika-signup.mp4
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXT = "/Users/webnaresh/coding-line/glitchgrab/packages/extension/dist";
const VIDDIR = "/tmp/abh-video";
const MP4 = "/tmp/abhyasika-signup.mp4";
const SIZE = { width: 1280, height: 800 };

fs.rmSync(VIDDIR, { recursive: true, force: true });
fs.mkdirSync(VIDDIR, { recursive: true });

// minimal bridge so the extension records events alongside the video
const events = [];
const wss = new WebSocketServer({ port: 7337 });
const sid = `rec-${Date.now()}`;
wss.on("connection", (ws, req) => {
  const role = new URL(req.url ?? "/", "http://localhost").searchParams.get("role");
  if (role === "chrome") ws.send(JSON.stringify({ type: "recording:start", sessionId: sid, repoId: "abhyasika", repoName: "abhyasika" }));
  ws.on("message", (r) => { try { const m = JSON.parse(r.toString()); if (m.type === "event:live" && m.event) events.push(m.event); } catch { /* */ } });
});

const udd = fs.mkdtempSync(path.join(os.tmpdir(), "abh-rec-"));
const ctx = await chromium.launchPersistentContext(udd, {
  headless: false,
  viewport: SIZE,
  recordVideo: { dir: VIDDIR, size: SIZE },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check"],
});
let [w] = ctx.serviceWorkers();
if (!w) w = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function send() { try { await page.getByRole("button", { name: /Send Verification Code/i }).click({ timeout: 4000 }); } catch { await page.mouse.click(944, 461); } }

try {
  await page.goto("http://localhost:3333/signup", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
  await page.mouse.click(944, 326); await page.waitForTimeout(2500);                 // Phone
  await page.fill('input[name="phone_no"]', "9000000007"); await page.waitForTimeout(900);
  await send(); await page.waitForTimeout(4000);
  await page.keyboard.type("1234", { delay: 220 }); await page.waitForTimeout(5000);  // OTP (auto-submits)
  console.log("after OTP:", page.url());
  await page.mouse.click(944, 456); await page.waitForTimeout(3500);                  // Library Owner
  await page.fill('input[name="first_name"]', "Demo"); await page.fill('input[name="last_name"]', "Owner");
  await page.locator('input[type="date"]').first().fill("1995-06-15").catch(() => {}); await page.waitForTimeout(500);
  await page.getByText(/Select source/i).click().catch(() => {}); await page.waitForTimeout(1000);
  await page.mouse.click(934, 397); await page.waitForTimeout(700);                   // Google Search
  await page.getByRole("button", { name: /^Continue/ }).click(); await page.waitForTimeout(3500);
  await page.locator('input[placeholder*="library name" i]').first().click();
  await page.keyboard.type("Sunrise Study Hub", { delay: 35 }); await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /^Continue/ }).click(); await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /Start Free Trial/i }).click(); await page.waitForTimeout(6000);
  console.log("FINAL:", page.url());
} catch (e) { console.log("flow partial:", e.message.split("\n")[0], "at", page.url()); }

const video = page.video();
await ctx.close();           // flushes the .webm
wss.close();
const webm = await video.path();
fs.writeFileSync("/tmp/abhyasika-events.json", JSON.stringify({ count: events.length, events }, null, 2));
execFileSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", MP4], { stdio: "ignore" });
const secs = (fs.statSync(MP4).size / 1e6).toFixed(1);
console.log(`VIDEO: ${MP4} (${secs} MB) | events: ${events.length} | webm: ${webm}`);
try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* */ }
