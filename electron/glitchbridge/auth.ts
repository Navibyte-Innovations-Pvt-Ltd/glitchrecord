// Glitchgrab auth token storage for GlitchRecord desktop app.
// Token persisted to a JSON file in userData. Survives restarts.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface StoredAuth {
  token: string;
  userId: string;
  name: string;
  selectedRepoId?: string;
  selectedRepoName?: string;
}

function authFilePath(): string {
  return path.join(app.getPath("userData"), "glitchgrab-auth.json");
}

let cache: StoredAuth | null = null;

export function loadAuth(): StoredAuth | null {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(authFilePath(), "utf-8");
    cache = JSON.parse(raw) as StoredAuth;
    return cache;
  } catch {
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  cache = auth;
  try {
    fs.writeFileSync(authFilePath(), JSON.stringify(auth, null, 2), "utf-8");
  } catch (err) {
    console.error("[GlitchBridge] Failed to save auth:", err);
  }
}

export function clearAuth(): void {
  cache = null;
  try {
    fs.unlinkSync(authFilePath());
  } catch {
    // already gone
  }
}

export function setSelectedRepo(repoId: string, repoName: string): void {
  const auth = loadAuth();
  if (!auth) return;
  auth.selectedRepoId = repoId;
  auth.selectedRepoName = repoName;
  saveAuth(auth);
}
