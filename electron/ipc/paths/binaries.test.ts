import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Windows native helper path resolution", () => {
	let tempRoot: string;
	let appPath: string;
	const originalPlatform = process.platform;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-helper-paths-"));
		appPath = path.join(tempRoot, "App");
		await fs.mkdir(appPath, { recursive: true });

		// Force the win32 code path regardless of host OS — otherwise on
		// macOS/Linux getNativeArchTag() returns e.g. "darwin-arm64", the prebundled
		// path never matches the staged win32 helper, and the test fails on any
		// non-Windows runner.
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });

		vi.resetModules();
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("prefers the branch-staged helper over a stale local CMake build in dev", async () => {
		const buildOutputPath = path.join(
			appPath,
			"electron",
			"native",
			"wgc-capture",
			"build",
			"Release",
			"wgc-capture.exe",
		);
		const prebundledPath = path.join(
			appPath,
			"electron",
			"native",
			"bin",
			process.arch === "arm64" ? "win32-arm64" : "win32-x64",
			"wgc-capture.exe",
		);
		await fs.mkdir(path.dirname(buildOutputPath), { recursive: true });
		await fs.mkdir(path.dirname(prebundledPath), { recursive: true });
		await fs.writeFile(buildOutputPath, "old-local-build");
		await fs.writeFile(prebundledPath, "branch-staged-helper");

		const { getWindowsCaptureExePath } = await import("./binaries");

		expect(getWindowsCaptureExePath()).toBe(prebundledPath);
	});

	it("falls back to the local CMake build when no staged helper exists", async () => {
		const buildOutputPath = path.join(
			appPath,
			"electron",
			"native",
			"wgc-capture",
			"build",
			"Release",
			"wgc-capture.exe",
		);
		await fs.mkdir(path.dirname(buildOutputPath), { recursive: true });
		await fs.writeFile(buildOutputPath, "local-build");

		const { getWindowsCaptureExePath } = await import("./binaries");

		expect(getWindowsCaptureExePath()).toBe(buildOutputPath);
	});
});
