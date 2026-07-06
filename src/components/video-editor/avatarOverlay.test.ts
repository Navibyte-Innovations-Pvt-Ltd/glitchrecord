import { describe, expect, it } from "vitest";
import {
	applyNarrationMute,
	buildExportAudioRegions,
	getAvatarBubbleLayout,
	getAvatarFullFrameLayout,
	getAvatarObjectPosition,
	getAvatarSpotlightProgress,
	isAvatarOverlayVisible,
	lerpAvatarLayout,
	panAvatarFraming,
} from "./avatarOverlay";
import type { AudioRegion } from "./types";
import { DEFAULT_AVATAR_OVERLAY } from "./types";

const base = { ...DEFAULT_AVATAR_OVERLAY, enabled: true };

describe("applyNarrationMute", () => {
	const narration: AudioRegion = { id: "n", startMs: 0, endMs: 5000, audioPath: "narr.wav", volume: 1, isNarration: true };
	const manual: AudioRegion = { id: "m", startMs: 0, endMs: 5000, audioPath: "sfx.wav", volume: 1 };
	const music: AudioRegion = { id: "bg", startMs: 0, endMs: 5000, audioPath: "song.mp3", volume: 0.3, loop: true };

	it("keeps everything when not silencing", () => {
		expect(applyNarrationMute([narration, manual, music], false)).toHaveLength(3);
	});

	it("drops ONLY the narration when silencing — manual audio + music survive", () => {
		const out = applyNarrationMute([narration, manual, music], true);
		expect(out.map((r) => r.id)).toEqual(["m", "bg"]);
		expect(out.some((r) => r.isNarration)).toBe(false);
	});

	it("is a no-op when there is no narration region", () => {
		expect(applyNarrationMute([manual, music], true)).toHaveLength(2);
	});
});

describe("isAvatarOverlayVisible", () => {
	it("hidden when settings missing", () => {
		expect(isAvatarOverlayVisible(undefined, null)).toBe(false);
		expect(isAvatarOverlayVisible(null, "clip.mp4")).toBe(false);
	});

	it("hidden when disabled even with a source", () => {
		expect(isAvatarOverlayVisible({ ...base, enabled: false, previewUrl: "p.jpg" }, null)).toBe(
			false,
		);
	});

	it("hidden when enabled but no clip and no preview", () => {
		// This is the 'I selected a look but nothing shows' case — must have a source.
		expect(isAvatarOverlayVisible({ ...base, previewUrl: null }, null)).toBe(false);
	});

	it("visible from a look-thumbnail placeholder before generation", () => {
		expect(
			isAvatarOverlayVisible({ ...base, previewUrl: "https://heygen/look.webp" }, null),
		).toBe(true);
	});

	it("visible from the generated clip even without a preview", () => {
		expect(isAvatarOverlayVisible({ ...base, previewUrl: null }, "file:///avatar.mp4")).toBe(
			true,
		);
	});
});

describe("getAvatarObjectPosition (face framing inside the box)", () => {
	it("formats both axes as percentages", () => {
		expect(getAvatarObjectPosition({ ...base, framingX: 50, framingY: 22 })).toBe("50% 22%");
		expect(getAvatarObjectPosition({ ...base, framingX: 0, framingY: 100 })).toBe("0% 100%");
	});
	it("clamps out-of-range values", () => {
		expect(getAvatarObjectPosition({ ...base, framingX: -20, framingY: 180 })).toBe("0% 100%");
	});
	it("falls back when NaN (so the style is never 'NaN%')", () => {
		expect(
			getAvatarObjectPosition({ ...base, framingX: Number.NaN, framingY: Number.NaN }),
		).toBe("50% 22%");
	});
});

describe("panAvatarFraming (Shift+drag to slide the face)", () => {
	it("dragging right reveals the left side (framingX decreases)", () => {
		const r = panAvatarFraming({
			startX: 50,
			startY: 50,
			deltaXpx: 100,
			deltaYpx: 0,
			boxW: 200,
			boxH: 200,
		});
		expect(r.framingX).toBe(0); // 50 - (100/200)*100 = 0
		expect(r.framingY).toBe(50);
	});
	it("dragging down reveals the top (framingY decreases)", () => {
		const r = panAvatarFraming({
			startX: 50,
			startY: 50,
			deltaXpx: 0,
			deltaYpx: 50,
			boxW: 200,
			boxH: 200,
		});
		expect(r.framingY).toBe(25); // 50 - (50/200)*100
	});
	it("clamps to 0–100", () => {
		const r = panAvatarFraming({
			startX: 10,
			startY: 90,
			deltaXpx: 500,
			deltaYpx: -500,
			boxW: 200,
			boxH: 200,
		});
		expect(r.framingX).toBe(0);
		expect(r.framingY).toBe(100);
	});
});

describe("getAvatarSpotlightProgress (corner ↔ full animation envelope)", () => {
	const regions = [{ id: "a", startMs: 1000, endMs: 5000 }];

	it("is 0 outside any region", () => {
		expect(getAvatarSpotlightProgress(regions, 0)).toBe(0);
		expect(getAvatarSpotlightProgress(regions, 6000)).toBe(0);
		expect(getAvatarSpotlightProgress([], 2000)).toBe(0);
	});
	it("is 1 (full) in the held middle of a region", () => {
		expect(getAvatarSpotlightProgress(regions, 3000, 450)).toBeCloseTo(1);
	});
	it("ramps up after the start and down before the end", () => {
		const justIn = getAvatarSpotlightProgress(regions, 1100, 450); // 100ms into 450 ease
		const justOut = getAvatarSpotlightProgress(regions, 4900, 450);
		expect(justIn).toBeGreaterThan(0);
		expect(justIn).toBeLessThan(1);
		expect(justOut).toBeGreaterThan(0);
		expect(justOut).toBeLessThan(1);
	});
	it("never exceeds [0,1] and handles a zero-length region", () => {
		expect(getAvatarSpotlightProgress([{ id: "z", startMs: 2000, endMs: 2000 }], 2000)).toBe(0);
		for (let t = 0; t <= 6000; t += 250) {
			const p = getAvatarSpotlightProgress(regions, t);
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThanOrEqual(1);
		}
	});
});

describe("lerpAvatarLayout + getAvatarFullFrameLayout", () => {
	const cornerLayout = { x: 900, y: 500, width: 180, height: 180, borderRadius: 21 };
	it("t=0 is the corner, t=1 is full-frame", () => {
		const full = getAvatarFullFrameLayout(1280, 720);
		expect(lerpAvatarLayout(cornerLayout, full, 0)).toEqual(cornerLayout);
		const atFull = lerpAvatarLayout(cornerLayout, full, 1);
		expect(atFull).toEqual({ x: 0, y: 0, width: 1280, height: 720, borderRadius: 0 });
	});
	it("t=0.5 is halfway (the slide/grow midpoint)", () => {
		const full = getAvatarFullFrameLayout(1280, 720);
		const mid = lerpAvatarLayout(cornerLayout, full, 0.5);
		expect(mid.x).toBeCloseTo(450);
		expect(mid.width).toBeCloseTo((180 + 1280) / 2);
	});
	it("clamps t outside [0,1]", () => {
		const full = getAvatarFullFrameLayout(1280, 720);
		expect(lerpAvatarLayout(cornerLayout, full, 2)).toEqual(
			lerpAvatarLayout(cornerLayout, full, 1),
		);
	});
});

describe("getAvatarBubbleLayout", () => {
	it("returns null for an unlaid-out container (no NaN drawn)", () => {
		expect(
			getAvatarBubbleLayout({ containerWidth: 0, containerHeight: 0, settings: base }),
		).toBeNull();
		expect(
			getAvatarBubbleLayout({
				containerWidth: Number.NaN,
				containerHeight: 720,
				settings: base,
			}),
		).toBeNull();
	});

	it("produces finite, in-bounds geometry for a normal stage", () => {
		const layout = getAvatarBubbleLayout({
			containerWidth: 1280,
			containerHeight: 720,
			settings: base,
		});
		expect(layout).not.toBeNull();
		if (!layout) return;
		for (const v of [layout.x, layout.y, layout.width, layout.height, layout.borderRadius]) {
			expect(Number.isFinite(v)).toBe(true);
		}
		expect(layout.width).toBeGreaterThan(0);
		expect(layout.width).toBe(layout.height); // PiP is square
		expect(layout.x).toBeGreaterThanOrEqual(0);
		expect(layout.y).toBeGreaterThanOrEqual(0);
		expect(layout.x + layout.width).toBeLessThanOrEqual(1280);
		expect(layout.y + layout.height).toBeLessThanOrEqual(720);
	});

	it("circle shape rounds to a full radius; box uses a small radius", () => {
		const circle = getAvatarBubbleLayout({
			containerWidth: 1280,
			containerHeight: 720,
			settings: { ...base, shape: "circle" },
		});
		const box = getAvatarBubbleLayout({
			containerWidth: 1280,
			containerHeight: 720,
			settings: { ...base, shape: "box" },
		});
		expect(circle && box).toBeTruthy();
		if (!circle || !box) return;
		expect(circle.borderRadius).toBeCloseTo(circle.width / 2);
		expect(box.borderRadius).toBeLessThan(box.width / 2);
	});

	it("custom position honors dragged X/Y fractions", () => {
		const topLeft = getAvatarBubbleLayout({
			containerWidth: 1280,
			containerHeight: 720,
			settings: { ...base, positionPreset: "custom", positionX: 0, positionY: 0 },
		});
		const botRight = getAvatarBubbleLayout({
			containerWidth: 1280,
			containerHeight: 720,
			settings: { ...base, positionPreset: "custom", positionX: 1, positionY: 1 },
		});
		expect(topLeft && botRight).toBeTruthy();
		if (!topLeft || !botRight) return;
		// X=0,Y=0 hugs the top-left margin; X=1,Y=1 pushes to the far corner.
		expect(topLeft.x).toBeLessThan(botRight.x);
		expect(topLeft.y).toBeLessThan(botRight.y);
		expect(topLeft.x).toBeCloseTo(base.margin);
		expect(topLeft.y).toBeCloseTo(base.margin);
	});

	it("bottom-right preset sits in the lower-right quadrant", () => {
		const layout = getAvatarBubbleLayout({
			containerWidth: 1280,
			containerHeight: 720,
			settings: { ...base, positionPreset: "bottom-right" },
		});
		expect(layout).not.toBeNull();
		if (!layout) return;
		expect(layout.x).toBeGreaterThan(1280 / 2);
		expect(layout.y).toBeGreaterThan(720 / 2);
	});
});

describe("buildExportAudioRegions (avatar voice in export)", () => {
	const narration: AudioRegion[] = [
		{ id: "n1", audioPath: "/narration.wav", startMs: 0, endMs: 5_000, volume: 1 },
	];

	it("appends the avatar clip's audio when the avatar is UNMUTED (so export isn't silent)", () => {
		const avatar = {
			...DEFAULT_AVATAR_OVERLAY,
			enabled: true,
			muted: false,
			sourcePath: "/avatars/avatar-x.mp4",
		};
		const out = buildExportAudioRegions([], avatar, 180);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			audioPath: "/avatars/avatar-x.mp4",
			startMs: 0,
			endMs: 180_000, // timeline seconds → ms
			volume: 1,
		});
	});

	it("keeps existing narration AND adds the avatar voice", () => {
		const avatar = {
			...DEFAULT_AVATAR_OVERLAY,
			enabled: true,
			muted: false,
			sourcePath: "/avatars/a.mp4",
		};
		const out = buildExportAudioRegions(narration, avatar, 10);
		expect(out).toHaveLength(2);
		expect(out[0].id).toBe("n1");
		expect(out[1].audioPath).toBe("/avatars/a.mp4");
	});

	it("does NOT add avatar audio when muted (narration carries the voice)", () => {
		const avatar = {
			...DEFAULT_AVATAR_OVERLAY,
			enabled: true,
			muted: true,
			sourcePath: "/avatars/a.mp4",
		};
		expect(buildExportAudioRegions(narration, avatar, 10)).toBe(narration);
	});

	it("does NOT add avatar audio when there is no generated clip", () => {
		const avatar = { ...DEFAULT_AVATAR_OVERLAY, enabled: true, muted: false, sourcePath: null };
		expect(buildExportAudioRegions(narration, avatar, 10)).toBe(narration);
	});
});
