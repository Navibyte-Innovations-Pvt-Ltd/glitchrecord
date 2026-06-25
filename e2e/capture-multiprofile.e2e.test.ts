// END-TO-END multi-profile capture test.
//
// The user's real scenario: TWO separate Chrome profiles, each with the
// Glitchgrab extension installed (e.g. admin logged in one, student in the
// other), both recorded into ONE session. Each profile is a distinct persistent
// context → its own MV3 service worker → its own WS client + clientId. We assert
// events from BOTH profiles land in the single bridge session, tagged by profile.
//
//   Chrome profile A + ext ─┐
//                           ├─→ ws://localhost:7337 → bridge → one session.events
//   Chrome profile B + ext ─┘
//
// Headed + local only (MV3 SW needs a display). GlitchRecord dev must be CLOSED
// (it owns port 7337). Run:  bun run test:e2e:multiprofile
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { launchHarness, waitUntil, type Harness } from "./helpers/harness";

vi.mock("electron", () => ({
  app: { getPath: () => path.join(os.tmpdir(), "gg-e2e-bridge-multi") },
}));
const mocks = vi.hoisted(() => ({
  loadAuth: vi.fn(() => null), // not logged in → capture+persist only
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

let profileA: Harness;
let profileB: Harness;

beforeAll(async () => {
  resetBridgeSession();
  startBridgeServer({
    onScriptReady: () => {},
    onIssueCreated: () => {},
    onLiveEvent: () => {},
    onEventsReady: () => {},
  });
  // Two launchHarness() calls = two separate userDataDirs = two real Chrome
  // profiles, each loading the extension and connecting its own SW to the bridge.
  profileA = await launchHarness();
  profileB = await launchHarness();
}, 120_000);

afterAll(async () => {
  await profileA?.close();
  await profileB?.close();
  stopBridgeServer();
  resetBridgeSession();
});

describe("multi-profile capture (two real Chrome profiles + extensions → one session)", () => {
  it(
    "captures events from BOTH Chrome profiles into one session, tagged per profile",
    async () => {
      const pageA = await profileA.context.newPage();
      await pageA.goto(profileA.fixtureUrl("playground.html"), { waitUntil: "load" });
      const pageB = await profileB.context.newPage();
      await pageB.goto(profileB.fixtureUrl("playground2.html"), { waitUntil: "load" });

      // Let both service workers connect to the bridge before recording starts.
      await pageA.waitForTimeout(3500);

      const sessionId = broadcastRecordingStart("repo-multi", "glitchgrab/e2e");
      await pageA.waitForTimeout(1500); // CAPTURE_START reaches both profiles' tabs

      // Profile A (e.g. admin) acts; Profile B (e.g. student) acts. Re-run once so
      // a slow CAPTURE_START still lands the gestures.
      const actA = async () => {
        await pageA.click("#cta");
        await pageA.type("#lib", "Admin Library", { delay: 30 });
        await pageA.locator("#lib").blur();
      };
      const actB = async () => {
        await pageB.click("#page2cta");
        await pageB.click("#page2cta");
      };
      await actA();
      await actB();

      // Wait until the merged session shows events from BOTH profiles (distinct
      // clientId tags) — capture is async across two SWs + the WS boundary.
      const profilesSeen = () =>
        new Set((getCurrentSession()?.events ?? []).map((e) => e.client).filter(Boolean));
      try {
        await waitUntil(() => profilesSeen().size >= 2, { timeoutMs: 6000, label: "events from 2 profiles (pre-stop live)" });
      } catch {
        // Pre-stop the session only has bulk uploads after stop; re-act then stop.
        await actA();
        await actB();
      }

      // Stop → both profiles upload; the bridge merges within the merge window.
      broadcastRecordingStop(sessionId, { cutRanges: [] });
      await waitUntil(
        () => {
          const evs = getCurrentSession()?.events ?? [];
          const onA = evs.some((e) => /playground\.html/.test(e.url ?? "") || /cta/i.test(e.label ?? ""));
          const onB = evs.some((e) => /playground2/.test(e.url ?? "") || /Second Page Action/i.test(e.label ?? ""));
          return onA && onB;
        },
        { timeoutMs: 12_000, label: "events from BOTH profiles merged into session" },
      );

      const events = getCurrentSession()?.events ?? [];
      // Decisive: at least two distinct profile tags present.
      const profileTags = new Set(events.map((e) => e.client).filter(Boolean));
      expect(profileTags.size).toBeGreaterThanOrEqual(2);

      // And each profile's page is represented.
      expect(events.some((e) => /playground\.html/.test(e.url ?? "") || /cta/i.test(e.label ?? ""))).toBe(true);
      expect(events.some((e) => /playground2/.test(e.url ?? ""))).toBe(true);
    },
    180_000,
  );
});
