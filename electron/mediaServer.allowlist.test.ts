// Regression for the avatar PiP "transparent / lips don't move" bug. The real
// cause (found via runtime logs) was the media server returning 403 for the
// generated avatar clip: its path was never in the per-session approved set
// (which is reset on project load), so the <video> URL was Forbidden and never
// loaded. The fix permanently allows the app's avatars dir.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/userdata" } }));

const { approvedLocalReadPaths } = await import("./ipc/state");
const { isAllowedMediaPath } = await import("./mediaServer");

describe("isAllowedMediaPath", () => {
	beforeEach(() => approvedLocalReadPaths.clear());

	it("allows a generated avatar clip even when NOT in the session approved set", () => {
		// This is exactly the 403 case that broke avatar playback.
		expect(isAllowedMediaPath("/tmp/userdata/avatars/avatar-abc.mp4")).toBe(true);
	});

	it("allows narration audio even when NOT in the session approved set", () => {
		// Same 403 → file:// → SILENT-audio case for the narration track.
		expect(isAllowedMediaPath("/tmp/userdata/narrations/narration-123.wav")).toBe(true);
	});

	it("denies an unrelated path that isn't approved", () => {
		expect(isAllowedMediaPath("/tmp/userdata/recordings/rec.system.webm")).toBe(false);
	});

	it("still honors the session approved set (recordings/webcam)", () => {
		approvedLocalReadPaths.add("/tmp/userdata/recordings/rec.system.webm");
		expect(isAllowedMediaPath("/tmp/userdata/recordings/rec.system.webm")).toBe(true);
	});

	it("does NOT allow a sibling dir that merely shares the avatars prefix", () => {
		expect(isAllowedMediaPath("/tmp/userdata/avatars-evil/x.mp4")).toBe(false);
	});

	it("allows the avatars dir itself", () => {
		expect(isAllowedMediaPath("/tmp/userdata/avatars")).toBe(true);
	});
});
