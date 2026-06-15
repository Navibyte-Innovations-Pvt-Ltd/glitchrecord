// Boots the REAL GlitchRecord app on its HOME launcher with a seeded project,
// then clicks the project card's Delete (trash) button and asserts the card
// disappears from the list AND the file is removed from disk. This is the UI
// wiring for the "delete project" feature (mirrors the existing delete-recording
// button) — the path-guard math is unit-tested in deleteGuard.test.ts.
//
// Run with `bun run test:e2e:ui` — GlitchRecord dev MUST be closed (port 7337).
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchHome, type HomeApp } from "./helpers/electron";

let home: HomeApp;
const PROJECT_FILE = "recording-1781497310079.glitchrecord";

beforeAll(async () => {
  home = await launchHome({
    seedProjects: [
      { name: PROJECT_FILE, content: "{}" },
      { name: "keep-me.glitchrecord", content: "{}" },
    ],
  });
}, 90_000);

afterAll(async () => {
  await home?.close();
});

describe("GlitchRecord home — delete project (real Electron app)", () => {
  it("shows seeded projects on the launcher", async () => {
    const { window } = home;
    const cards = window.locator('[data-testid="project-card"]');
    await cards.first().waitFor({ state: "visible", timeout: 30_000 });
    expect(await cards.count()).toBe(2);
  });

  it("deletes a project from the list AND from disk when its trash is clicked", async () => {
    const { window, projectsDir } = home;
    const onDisk = path.join(projectsDir, PROJECT_FILE);
    // The card's display name strips the .glitchrecord extension (matches the
    // launcher UI). Match on that — avoids /var→/private/var path canonicalization.
    const displayName = PROJECT_FILE.replace(/\.glitchrecord$/, "");
    const target = window.locator(`[data-testid="project-card"][data-project-name="${displayName}"]`);
    await target.waitFor({ state: "visible", timeout: 10_000 });
    expect(fs.existsSync(onDisk)).toBe(true);

    // Hover to reveal the trash, then click it.
    await target.hover();
    await target.locator('[data-testid="project-delete"]').click();

    // Card gone from the list, the OTHER project survives.
    await target.waitFor({ state: "detached", timeout: 10_000 });
    expect(await window.locator('[data-testid="project-card"]').count()).toBe(1);
    // File (and it alone) removed on disk.
    expect(fs.existsSync(onDisk)).toBe(false);
    expect(fs.existsSync(path.join(projectsDir, "keep-me.glitchrecord"))).toBe(true);
  });
});
