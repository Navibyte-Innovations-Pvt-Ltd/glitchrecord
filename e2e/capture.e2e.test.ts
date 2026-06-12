// END-TO-END capture test for GlitchRecord.
//
// This is the real thing the user does, automated: a real Chromium with the
// real Glitchgrab extension loaded acts on a page, and we assert the events
// flow all the way through the real bridge into a recording session.
//
//   real Chrome + extension → ws://localhost:7337 → real bridge → session.events
//
// Headed + local only (MV3 service worker needs a display). Run with:
//   bun run test:e2e          (from apps/glitchrecord)
// GlitchRecord dev must be CLOSED first — it owns port 7337.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { launchHarness, waitUntil, type Harness } from "./helpers/harness";

// ── Mock the Electron + web-API surface so the bridge runs in plain Node ──
// app.getPath → temp dir (debug log + session cache land there).
vi.mock("electron", () => ({
  app: { getPath: () => path.join(os.tmpdir(), "gg-e2e-bridge") },
}));
// Not logged in → capture+persist path only: no DB upload, no AI, no GitHub.
// (Real-AI script/refine is a separate, opt-in lane — see script.e2e.test.ts.)
const mocks = vi.hoisted(() => ({
  loadAuth: vi.fn(() => null),
  validateToken: vi.fn(async () => null),
  getRepos: vi.fn(async () => []),
  uploadSession: vi.fn(async () => null),
  generateScript: vi.fn(async () => ({ error: "not logged in" })),
}));
vi.mock("../electron/glitchbridge/api", () => ({
  validateToken: mocks.validateToken,
  getRepos: mocks.getRepos,
  uploadSession: mocks.uploadSession,
  generateScript: mocks.generateScript,
  BASE: "http://localhost:3000",
}));
vi.mock("../electron/glitchbridge/auth", () => ({ loadAuth: mocks.loadAuth }));

import {
  startBridgeServer,
  stopBridgeServer,
  broadcastRecordingStart,
  broadcastRecordingStop,
  getCurrentSession,
  resetBridgeSession,
} from "../electron/glitchbridge/server";

// Live events streamed from the extension while recording (the HUD feed).
const liveEvents: Array<{ type: string }> = [];
let harness: Harness;

beforeAll(async () => {
  resetBridgeSession();
  startBridgeServer({
    onScriptReady: () => {},
    onIssueCreated: () => {},
    onLiveEvent: (e) => liveEvents.push(e as { type: string }),
    onEventsReady: () => {},
  });
  harness = await launchHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
  stopBridgeServer();
  resetBridgeSession();
});

const typesSeen = () => new Set(liveEvents.map((e) => e.type));

describe("GlitchRecord capture pipeline (real browser + extension + bridge)", () => {
  it(
    "captures click, input and scroll from a real page into the recording session",
    async () => {
      // 1. Open the playground FIRST so its content script is live before
      //    recording starts (avoids the load-during-recording race).
      const page = await harness.context.newPage();
      await page.goto(harness.fixtureUrl("playground.html"), { waitUntil: "load" });

      // 2. Give the extension's service worker time to connect to the bridge on
      //    7337. Until it's connected, recording:start can't reach it. (Settle,
      //    not poll — the WS handle isn't observable from Node.)
      await page.waitForTimeout(3000);

      // 3. Start the recording. broadcastRecordingStart fans recording:start to
      //    connected chrome clients (and the bridge resyncs any that reconnect).
      const sessionId = broadcastRecordingStart("repo-e2e", "glitchgrab/e2e");
      await page.waitForTimeout(1500); // let CAPTURE_START reach the content script

      // 4. Act like a user; re-run the actions once after a beat so a slow
      //    CAPTURE_START still lands them. Each action emits a live event.
      const act = async () => {
        await page.click("#cta");
        await page.type("#lib", "Study Times Library", { delay: 40 });
        await page.locator("#lib").blur();
        await page.evaluate(() => window.scrollTo(0, 1400));
        await page.mouse.wheel(0, 400);
      };
      await act();

      // 5. Wait for the live feed to show the three core gestures (capture is
      //    async + debounced across the WS boundary — poll, never sleep blindly).
      try {
        await waitUntil(
          () => {
            const t = typesSeen();
            return t.has("click") && t.has("input") && t.has("scroll");
          },
          { timeoutMs: 12_000, label: "click+input+scroll on live feed" },
        );
      } catch {
        await act(); // second pass in case the first round preceded CAPTURE_START
        await waitUntil(
          () => {
            const t = typesSeen();
            return t.has("click") && t.has("input") && t.has("scroll");
          },
          { timeoutMs: 12_000, label: "click+input+scroll on live feed (retry)" },
        );
      }

      // 5. Stop. The extension uploads the full buffered event list to the bridge.
      broadcastRecordingStop(sessionId, { cutRanges: [] });
      await waitUntil(() => (getCurrentSession()?.events.length ?? 0) > 0, {
        timeoutMs: 8000,
        label: "events:upload received by bridge",
      });

      // 6. Assert the persisted session captured the real interactions.
      const events = getCurrentSession()?.events ?? [];
      const persisted = new Set(events.map((e) => e.type));
      expect(persisted.has("click")).toBe(true);
      expect(persisted.has("input")).toBe(true);
      expect(persisted.has("scroll")).toBe(true);

      // The click should carry a usable label built by describeElement().
      const click = events.find((e) => e.type === "click");
      expect(click?.label ?? "").toMatch(/Start Free Trial|cta/i);

      // The typed value rides along on the input event's preview.
      const input = events.find((e) => e.type === "input");
      expect(input?.preview ?? "").toContain("Study Times");
    },
    90_000,
  );

  // ADVERSARIAL PROBE — the #1 documented silent-failure gotcha: a page that
  // LOADS mid-recording (full navigation) gets a fresh content script that
  // missed the one-time CAPTURE_START. The re-arm on tabs.onUpdated "complete"
  // must catch it, or the new page captures NOTHING. Written to fail loudly if
  // that path ever regresses.
  it(
    "still captures a click on a page navigated to DURING recording",
    async () => {
      const page = await harness.context.newPage();
      await page.goto(harness.fixtureUrl("playground.html"), { waitUntil: "load" });
      await page.waitForTimeout(3000); // SW → bridge connect

      const sessionId = broadcastRecordingStart("repo-e2e-nav", "glitchgrab/e2e");
      await page.waitForTimeout(1500);
      await page.click("#cta"); // confirm capture is live on page 1

      // Full navigation mid-recording → brand-new content script on page 2.
      await page.goto(harness.fixtureUrl("playground2.html"), { waitUntil: "load" });
      await page.waitForTimeout(1500); // let the onUpdated re-arm resend CAPTURE_START
      await page.click("#page2cta");
      await page.click("#page2cta"); // twice — second lands even if the first raced the re-arm

      broadcastRecordingStop(sessionId, { cutRanges: [] });
      await waitUntil(() => (getCurrentSession()?.events.length ?? 0) > 0, {
        timeoutMs: 8000,
        label: "events:upload after mid-recording navigation",
      });

      const events = getCurrentSession()?.events ?? [];
      // The decisive assertion: an event captured on the SECOND page.
      const onPage2 = events.some(
        (e) => /playground2/.test(e.url ?? "") || /Second Page Action/i.test(e.label ?? ""),
      );
      expect(onPage2).toBe(true);
    },
    90_000,
  );
});
