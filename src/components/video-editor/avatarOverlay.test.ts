import { describe, expect, it } from "vitest";
import {
	getAvatarBubbleLayout,
	getAvatarObjectPosition,
	isAvatarOverlayVisible,
	panAvatarFraming,
} from "./avatarOverlay";
import { DEFAULT_AVATAR_OVERLAY } from "./types";

const base = { ...DEFAULT_AVATAR_OVERLAY, enabled: true };

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
		for (const v of [layout.x, layout.y, layout.size, layout.borderRadius]) {
			expect(Number.isFinite(v)).toBe(true);
		}
		expect(layout.size).toBeGreaterThan(0);
		expect(layout.x).toBeGreaterThanOrEqual(0);
		expect(layout.y).toBeGreaterThanOrEqual(0);
		expect(layout.x + layout.size).toBeLessThanOrEqual(1280);
		expect(layout.y + layout.size).toBeLessThanOrEqual(720);
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
		expect(circle.borderRadius).toBeCloseTo(circle.size / 2);
		expect(box.borderRadius).toBeLessThan(box.size / 2);
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
