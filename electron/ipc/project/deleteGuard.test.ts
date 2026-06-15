import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The guard imports ../constants → ../../appPaths, which calls Electron's
// app.getPath at module load. Mock electron (like prune.test.ts) and import the
// guard dynamically so it resolves against the mock.
const PROJECTS_DIR = "/tmp/udd/recordings/Projects";
let isDeletableProjectPath: typeof import("./deleteGuard").isDeletableProjectPath;

beforeEach(async () => {
	vi.resetModules();
	vi.doMock("electron", () => ({
		app: {
			isPackaged: false,
			getAppPath: () => "/tmp/app",
			getPath: () => "/tmp/udd",
			setPath: () => undefined,
		},
	}));
	({ isDeletableProjectPath } = await import("./deleteGuard"));
});

afterEach(() => {
	vi.resetModules();
	vi.doUnmock("electron");
});

describe("isDeletableProjectPath", () => {
	it("accepts a .glitchrecord file inside the projects dir", () => {
		const p = path.join(PROJECTS_DIR, "recording-123.glitchrecord");
		expect(isDeletableProjectPath(p, PROJECTS_DIR)).toBe(path.resolve(p));
	});

	it("accepts legacy project extensions (.recordly / .openscreen)", () => {
		const a = path.join(PROJECTS_DIR, "old.recordly");
		const b = path.join(PROJECTS_DIR, "old.openscreen");
		expect(isDeletableProjectPath(a, PROJECTS_DIR)).toBe(path.resolve(a));
		expect(isDeletableProjectPath(b, PROJECTS_DIR)).toBe(path.resolve(b));
	});

	it("rejects a path OUTSIDE the projects dir", () => {
		const p = "/tmp/udd/recordings/recording-123.mp4";
		expect(isDeletableProjectPath(p, PROJECTS_DIR)).toBeNull();
	});

	it("rejects directory traversal escaping the projects dir", () => {
		const p = path.join(PROJECTS_DIR, "../../../../etc/passwd.glitchrecord");
		expect(isDeletableProjectPath(p, PROJECTS_DIR)).toBeNull();
	});

	it("rejects a wrong extension even inside the projects dir", () => {
		expect(isDeletableProjectPath(path.join(PROJECTS_DIR, "notes.txt"), PROJECTS_DIR)).toBeNull();
		expect(isDeletableProjectPath(path.join(PROJECTS_DIR, "clip.mp4"), PROJECTS_DIR)).toBeNull();
	});

	it("rejects empty / non-string inputs", () => {
		expect(isDeletableProjectPath("", PROJECTS_DIR)).toBeNull();
		expect(isDeletableProjectPath(undefined, PROJECTS_DIR)).toBeNull();
		expect(isDeletableProjectPath(null, PROJECTS_DIR)).toBeNull();
		expect(isDeletableProjectPath(path.join(PROJECTS_DIR, "x.glitchrecord"), "")).toBeNull();
	});
});
