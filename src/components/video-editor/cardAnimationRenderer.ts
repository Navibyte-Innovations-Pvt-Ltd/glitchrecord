import type { IntroOutroPosition, IntroOutroSideConfig } from "./introOutroTypes";

/**
 * Canvas renderer for intro/outro logo cards — a close JS approximation of the
 * FFmpeg filters in electron/ipc/export/introOutro.ts, used for the editor
 * PREVIEW (button + inline player overlay). The export still renders via FFmpeg;
 * this only needs to look visually equivalent, not be pixel-identical.
 */

export interface CardRenderInput {
	ctx: CanvasRenderingContext2D;
	/** Canvas pixel dimensions to draw into. */
	width: number;
	height: number;
	/** Decoded logo, or null to draw just the background. */
	logo: HTMLImageElement | null;
	side: IntroOutroSideConfig;
	/** Playback position within the card, 0 → 1 across its full duration. */
	progress: number;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) {
		return x < edge0 ? 0 : 1;
	}
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

/** Static placement (top-left px) for a logo of size w×h. Margins are 15%. */
function placement(
	position: IntroOutroPosition,
	W: number,
	H: number,
	w: number,
	h: number,
): { x: number; y: number } {
	switch (position) {
		case "top":
			return { x: (W - w) / 2, y: H * 0.15 };
		case "bottom":
			return { x: (W - w) / 2, y: H * 0.85 - h };
		case "left":
			return { x: W * 0.15, y: (H - h) / 2 };
		case "right":
			return { x: W * 0.85 - w, y: (H - h) / 2 };
		default:
			return { x: (W - w) / 2, y: (H - h) / 2 };
	}
}

/** Off-screen slide-in start position for the placement edge. */
function slideStart(
	position: IntroOutroPosition,
	end: { x: number; y: number },
	W: number,
	H: number,
	w: number,
	h: number,
): { x: number; y: number } {
	switch (position) {
		case "top":
			return { x: end.x, y: -h };
		case "bottom":
			return { x: end.x, y: H };
		case "right":
			return { x: W, y: end.y };
		default:
			// center + left slide in from the left.
			return { x: -w, y: end.y };
	}
}

function normalizeBg(color: string): string {
	if (/^#?[0-9a-fA-F]{6}$/.test(color.trim())) {
		const hex = color.trim().replace(/^#/, "");
		return `#${hex}`;
	}
	return "#0B1020";
}

/**
 * Draw one frame of an intro/outro card. Mirrors the FFmpeg preset timing:
 * fade window = min(0.5s, dur*0.4); scale-pop/slide ease windows match the
 * generator. `progress` is the position across the whole card duration.
 */
export function drawCard({ ctx, width, height, logo, side, progress }: CardRenderInput): void {
	const W = width;
	const H = height;
	const t = clamp01(progress);

	ctx.clearRect(0, 0, W, H);
	ctx.fillStyle = normalizeBg(side.backgroundColor);
	ctx.fillRect(0, 0, W, H);

	if (!logo || !logo.complete || logo.naturalWidth === 0) {
		return;
	}

	const durSec = Math.min(5, Math.max(0.5, side.durationMs / 1000));
	const fadeSec = Math.min(0.5, durSec * 0.4);
	const fadeInEnd = fadeSec / durSec;
	const fadeOutStart = (durSec - fadeSec) / durSec;
	const tSec = t * durSec;

	// Base logo size from the size fraction, preserving aspect.
	const logoH = Math.max(2, Math.round(H * Math.min(0.8, Math.max(0.1, side.size))));
	const logoW = Math.round(logoH * (logo.naturalWidth / logo.naturalHeight));

	// scale-pop centers (matching the generator's zoompan-on-composite).
	const isPop = side.preset === "scale-pop";
	const base = placement(isPop ? "center" : side.position, W, H, logoW, logoH);

	let drawX = base.x;
	let drawY = base.y;
	let scale = 1;
	// fade is symmetric in/out for every preset except slide, which only fades out.
	let opacity =
		side.preset === "slide"
			? 1 - smoothstep(fadeOutStart, 1, t)
			: smoothstep(0, fadeInEnd, t) * (1 - smoothstep(fadeOutStart, 1, t));

	if (isPop) {
		const popFrac = Math.min(0.5, durSec) / durSec;
		const p = clamp01(t / popFrac);
		scale = 0.6 + 0.4 * easeOutCubic(p);
	} else if (side.preset === "slide") {
		const slideSec = Math.min(0.6, durSec * 0.5);
		const slideFrac = slideSec / durSec;
		const start = slideStart(side.position, base, W, H, logoW, logoH);
		const p = easeOutCubic(clamp01(t / slideFrac));
		drawX = start.x + (base.x - start.x) * p;
		drawY = start.y + (base.y - start.y) * p;
	} else if (side.preset === "glitch") {
		const shakeSec = Math.min(0.4, durSec * 0.35);
		if (tSec < shakeSec) {
			drawX = base.x + 18 * Math.sin(tSec * 90) * ((shakeSec - tSec) / shakeSec);
		}
	}

	ctx.save();
	ctx.globalAlpha = clamp01(opacity);
	if (scale !== 1) {
		const cx = drawX + logoW / 2;
		const cy = drawY + logoH / 2;
		ctx.translate(cx, cy);
		ctx.scale(scale, scale);
		ctx.translate(-cx, -cy);
	}
	ctx.drawImage(logo, drawX, drawY, logoW, logoH);
	ctx.restore();
}

/** Total card duration in ms, clamped to the supported range. */
export function cardDurationMs(side: IntroOutroSideConfig): number {
	return Math.min(5000, Math.max(500, side.durationMs));
}
