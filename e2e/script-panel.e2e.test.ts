// Drives the Script Writer panel in the REAL GlitchRecord editor and asserts
// the "Apply to script" wiring — the exact bug from the screenshot, at the UI
// level: a refined script must land in the narration box when the user clicks
// the button.
//
// The AI response is seeded deterministically by stubbing the refine IPC in the
// main process (no live DeepSeek), so this asserts the BUTTON WIRING, not model
// quality. The complementary `parse-refine.test.ts` pins the parser bug that
// made `script` come back null in the first place. A separate opt-in smoke can
// run this against real AI.
//
// Run with `bun run test:e2e:ui` — GlitchRecord dev MUST be closed (port 7337).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchEditor, type EditorApp } from "./helpers/electron";

const SEEDED_SCRIPT = "मिलिए My Abhyasika से — आपका study room partner. (seeded e2e script)";

let editor: EditorApp;

beforeAll(async () => {
  editor = await launchEditor();
}, 90_000);

afterAll(async () => {
  await editor?.close();
});

describe("Script Writer: Apply to script wiring (real editor)", () => {
  it("a refined script applies into the narration box on click", async () => {
    const { app, window } = editor;

    // Seed the AI: replace the refine IPC handler so Send returns a script.
    await app.evaluate(({ ipcMain }, script) => {
      try { ipcMain.removeHandler("glitchbridge:refine-script"); } catch { /* none yet */ }
      ipcMain.handle("glitchbridge:refine-script", async () => ({
        ok: true,
        reply: "Added the signup options.",
        script,
      }));
    }, SEEDED_SCRIPT);

    // Open the GlitchGrab rail panel, then the Script Writer drawer.
    await window.locator('[data-testid="rail-section-glitchgrab"]').click();
    await window.locator('[data-testid="gg-script-toggle"]').click();

    // Ask the refine chat for a change → Send.
    await window.locator('[data-testid="gg-refine-input"]').fill("add the Google/Email/Phone options");
    await window.locator('[data-testid="gg-refine-send"]').click();

    // The "Apply to script" button only appears when the response carried a
    // non-null script — this is precisely what the ---SCRIPT--- bug suppressed.
    const apply = window.locator('[data-testid="gg-apply-script"]');
    await apply.waitFor({ state: "visible", timeout: 20_000 });
    await apply.click();

    // The narration box now holds the refined script.
    expect(await window.locator('[data-testid="gg-narration-textarea"]').inputValue()).toBe(SEEDED_SCRIPT);
  });
});
