// ⌘⇧G inside GlitchRecord opens Report Bug.
//
// The shortcut lives on the native app menu, which synthetic page input never
// reaches — so the keypress here is a REAL macOS keystroke sent through System
// Events to the app, not a Playwright keyboard event.
//
// Needs: GlitchRecord dev CLOSED (port 7337), the app built, and Accessibility
// permission for the terminal running the test (System Events keystrokes).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchHome, type HomeApp } from "./helpers/electron";

let home: HomeApp;

beforeAll(async () => {
  home = await launchHome();
}, 90_000);

afterAll(async () => {
  await home?.close();
});

describe("Report Bug shortcut (real Electron app)", () => {
  it("puts Report Bug on ⌘⇧G in the File menu", async () => {
    const accelerator = await home.app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("report-bug")?.accelerator ?? null,
    );
    expect(accelerator).toBe("CmdOrCtrl+Shift+G");
  });

  it.runIf(process.platform === "darwin")(
    "opens the Report Bug window when ⌘⇧G is pressed with GlitchRecord in front",
    async () => {
      const pid = home.app.process()?.pid;
      expect(pid).toBeTruthy();
      await home.app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()[0]?.focus();
      });

      const opened = home.app.waitForEvent("window", { timeout: 20_000 });
      execFileSync("osascript", [
        "-e",
        `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
        "-e",
        "delay 0.5",
        "-e",
        'tell application "System Events" to keystroke "g" using {command down, shift down}',
      ]);

      const report = await opened;
      await report.waitForLoadState("domcontentloaded");
      expect(report.url()).toContain("windowType=report");

      // A fresh profile is signed out: the window must offer a way forward,
      // not a bare message on an empty window.
      await report.getByRole("button", { name: "Connect Glitchgrab" }).waitFor({ state: "visible", timeout: 15_000 });
      await report.getByRole("button", { name: "Close" }).waitFor({ state: "visible", timeout: 5_000 });

      // Optional evidence for a human: GG_SHOT_DIR=<dir> saves what opened.
      const shotDir = process.env.GG_SHOT_DIR;
      if (shotDir) {
        await report.waitForTimeout(2500);
        fs.mkdirSync(shotDir, { recursive: true });
        await report.screenshot({ path: path.join(shotDir, "report-bug-cmd-shift-g.png") });
      }
    },
    60_000,
  );
});
