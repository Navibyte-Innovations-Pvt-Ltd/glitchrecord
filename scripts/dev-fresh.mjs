#!/usr/bin/env node
// Kill any stale GlitchRecord (Electron) instance, then start a fresh dev session.
// The app enforces a single-instance lock (it owns WS port 7337), so a previous
// instance would make a new launch quit immediately. This guarantees the newest
// build always wins.
import { execSync, spawn } from "node:child_process";
import process from "node:process";

const IS_WIN = process.platform === "win32";

function killStaleElectron() {
  try {
    if (IS_WIN) {
      // Match the GlitchRecord electron main process by its window title / path.
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'glitchrecord' -and $_.CommandLine -match 'electron' -and $_.CommandLine -notmatch 'Helper' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
        { stdio: "ignore" },
      );
    } else {
      // Find the MAIN electron process for this app (not the renderer/GPU helpers).
      // The main runs as: .../glitchrecord/node_modules/electron/.../MacOS/Electron . --no-sandbox
      const out = execSync(
        `ps ax -o pid=,command= | grep 'glitchrecord/node_modules/electron' | grep 'MacOS/Electron ' | grep -v 'Electron Helper' | grep -v 'grep'`,
        { encoding: "utf8" },
      ).trim();
      const pids = out
        .split("\n")
        .map((l) => l.trim().split(/\s+/)[0])
        .filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGTERM");
          console.log(`[dev-fresh] Killed stale GlitchRecord (pid ${pid})`);
        } catch { /* already gone */ }
      }
      if (pids.length === 0) console.log("[dev-fresh] No stale instance — clean start.");
    }
  } catch {
    // grep exits non-zero when nothing matches — that just means no stale instance.
    console.log("[dev-fresh] No stale instance — clean start.");
  }
}

killStaleElectron();

// Give the OS a moment to release the single-instance lock + port 7337.
setTimeout(() => {
  const child = spawn("vite", ["--config", "vite.config.ts"], {
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}, 600);
