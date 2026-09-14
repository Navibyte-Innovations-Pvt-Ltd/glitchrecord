// ⌘⇧G inside GlitchRecord opens Report Bug as a side sheet in the window you
// are in — not a separate window.
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
    "opens the Report Bug sheet inside Home when ⌘⇧G is pressed — no new window",
    async () => {
      const pid = home.app.process()?.pid;
      expect(pid).toBeTruthy();
      await home.window.waitForTimeout(2000);
      const windowsBefore = home.app.windows().length;

      await home.app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()[0]?.focus();
      });
      execFileSync("osascript", [
        "-e",
        `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
        "-e",
        "delay 0.5",
        "-e",
        'tell application "System Events" to keystroke "g" using {command down, shift down}',
      ]);

      // A fresh profile is signed out: the sheet slides in over Home and offers
      // a way forward. Scoped to the sheet — Home's own header has a
      // "Connect Glitchgrab" button too when signed out.
      const sheet = home.window.locator(".gg-inline-report-panel");
      await sheet
        .getByRole("button", { name: "Connect Glitchgrab" })
        .waitFor({ state: "visible", timeout: 15_000 });
      await sheet.getByRole("button", { name: "Close" }).waitFor({ state: "visible", timeout: 5_000 });
      expect(home.app.windows().length).toBe(windowsBefore);

      // Optional evidence for a human: GG_SHOT_DIR=<dir> saves what opened.
      const shotDir = process.env.GG_SHOT_DIR;
      if (shotDir) {
        fs.mkdirSync(shotDir, { recursive: true });
        await home.window.screenshot({ path: path.join(shotDir, "sheet-signed-out-in-home.png") });
      }

      await sheet.getByRole("button", { name: "Close" }).click();
      await sheet.waitFor({ state: "detached", timeout: 5_000 });
    },
    60_000,
  );
});
