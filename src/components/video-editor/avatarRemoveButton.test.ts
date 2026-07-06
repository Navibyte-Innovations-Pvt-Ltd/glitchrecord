// Regression evidence for "avatar preview shows with no way to remove it".
//
// Root cause: the "Remove avatar" (X) button in VideoPlayback.tsx was nested
// INSIDE the `{avatarVideoPath ? (<>...</>) : null}` branch, alongside the
// mute button. avatarVideoPath is only set once a clip is GENERATED — before
// that, the user sees just the placeholder look image (avatarPreviewUrl), and
// neither button rendered at all. There was no way to dismiss a preview-only
// avatar. Fix: the remove button must be a SIBLING of that branch, so it
// renders whenever the bubble shows (preview OR generated clip) — matching its
// own "Remove the avatar PiP entirely" comment.
//
// Full DOM rendering needs Pixi + video/canvas mocking this component doesn't
// have test infra for, so — like avatarAudioRegionStability.test.ts — this
// asserts the source-level structural invariant directly.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "VideoPlayback.tsx"), "utf8");

describe("avatar PiP remove button is NOT gated behind a generated clip", () => {
	it("the avatarVideoPath fragment closes BEFORE the remove button appears", () => {
		const videoOpenIdx = src.indexOf("{avatarVideoPath ? (");
		expect(videoOpenIdx).toBeGreaterThan(-1);

		// The mute button (inside the avatarVideoPath branch) closes with this
		// exact fragment-close sequence — unique to that branch's end.
		const videoBranchCloseIdx = src.indexOf("</>\n\t\t\t\t\t\t\t\t) : null}", videoOpenIdx);
		expect(videoBranchCloseIdx).toBeGreaterThan(videoOpenIdx);

		const removeButtonIdx = src.indexOf('aria-label="Remove avatar"');
		expect(removeButtonIdx).toBeGreaterThan(-1);

		// The bug: removeButtonIdx was BETWEEN videoOpenIdx and videoBranchCloseIdx
		// (nested inside). The fix: it must come AFTER the branch closes (sibling).
		expect(removeButtonIdx).toBeGreaterThan(videoBranchCloseIdx);
	});

	it("the remove button is gated on onAvatarRemove only — not re-wrapped in avatarVideoPath", () => {
		const removeButtonIdx = src.indexOf('aria-label="Remove avatar"');
		const precedingCode = src.slice(0, removeButtonIdx);
		// Its own guard is the last `{onAvatarRemove ? (` before the button — that
		// must be closer than any dangling `{avatarVideoPath ? (` re-open.
		const lastOnAvatarRemoveGuard = precedingCode.lastIndexOf("{onAvatarRemove ? (");
		const lastAvatarVideoPathGuard = precedingCode.lastIndexOf("{avatarVideoPath ? (");
		expect(lastOnAvatarRemoveGuard).toBeGreaterThan(lastAvatarVideoPathGuard);
	});
});
