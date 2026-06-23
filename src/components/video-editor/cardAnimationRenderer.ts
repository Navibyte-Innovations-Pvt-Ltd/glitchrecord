import { getCardAnimation, resolveAnimation } from "./cardAnimations";
import type { IntroOutroPosition, IntroOutroSideConfig } from "./introOutroTypes";

/**
 * Canvas renderer for intro/outro cards — the single source of truth for both the
 * editor PREVIEW and (later) the export. Draws a gradient/solid background, an
 * optional styled logo container, the logo, and brand name/tagline text, laid out
 * per `layout` and animated per `preset`.
 */

export interface CardRenderInput {
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
	logo: HTMLImageElement | null;
	side: IntroOutroSideConfig;
	/** Playback position within the card, 0 → 1 across its full duration. */
	progress: number;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.arcTo(x + w, y, x + w, y + h, radius);
	ctx.arcTo(x + w, y + h, x, y + h, radius);
	ctx.arcTo(x, y + h, x, y, radius);
	ctx.arcTo(x, y, x + w, y, radius);
	ctx.closePath();
}

function paintBackground(
	ctx: CanvasRenderingContext2D,
	W: number,
	H: number,
	side: IntroOutroSideConfig,
): void {
	const bg = side.background;
	if (bg.type === "gradient") {
		const rad = (bg.angle * Math.PI) / 180;
		// Direction vector → endpoints across the frame.
		const cx = W / 2;
		const cy = H / 2;
		const len = (Math.abs(Math.cos(rad)) * W + Math.abs(Math.sin(rad)) * H) / 2;
		const dx = Math.cos(rad) * len;
		const dy = Math.sin(rad) * len;
		const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
		grad.addColorStop(0, bg.color1);
		grad.addColorStop(1, bg.color2);
		ctx.fillStyle = grad;
	} else {
		ctx.fillStyle = bg.color1;
	}
	ctx.fillRect(0, 0, W, H);

	// Soft radial accent glow behind the content for depth (minimal-premium).
	if (bg.glow > 0) {
		const r = Math.max(W, H) * 0.62;
		const glow = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, r);
		glow.addColorStop(0, `rgba(150,170,255,${(bg.glow * 0.5).toFixed(3)})`);
		glow.addColorStop(1, "rgba(150,170,255,0)");
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, W, H);
	}
	// Edge vignette.
	if (bg.vignette > 0) {
		const r = Math.hypot(W, H) / 2;
		const vig = ctx.createRadialGradient(W / 2, H / 2, r * 0.55, W / 2, H / 2, r);
		vig.addColorStop(0, "rgba(0,0,0,0)");
		vig.addColorStop(1, `rgba(0,0,0,${bg.vignette.toFixed(3)})`);
		ctx.fillStyle = vig;
		ctx.fillRect(0, 0, W, H);
	}
}

interface GroupMetrics {
	width: number;
	height: number;
	logoW: number;
	logoH: number;
	nameSize: number;
	taglineSize: number;
	hasLogo: boolean;
	hasName: boolean;
	hasTagline: boolean;
}

function measureGroup(
	ctx: CanvasRenderingContext2D,
	H: number,
	side: IntroOutroSideConfig,
	logo: HTMLImageElement | null,
): GroupMetrics {
	const showLogo = side.layout !== "text-only" && !!logo && logo.naturalWidth > 0;
	const logoH = showLogo ? Math.max(2, Math.round(H * clamp01(side.size))) : 0;
	const logoW = showLogo ? Math.round(logoH * (logo.naturalWidth / logo.naturalHeight)) : 0;

	const hasName = Boolean(side.text.brandName.trim());
	const hasTagline = Boolean(side.text.tagline.trim());
	const showText = side.layout !== "logo-only";
	const nameSize = showText && hasName ? Math.round(H * 0.085) : 0;
	const taglineSize = showText && hasTagline ? Math.round(H * 0.045) : 0;

	let nameW = 0;
	let taglineW = 0;
	if (nameSize) {
		ctx.font = `700 ${nameSize}px Inter, system-ui, sans-serif`;
		nameW = ctx.measureText(side.text.brandName).width;
	}
	if (taglineSize) {
		ctx.font = `400 ${taglineSize}px Inter, system-ui, sans-serif`;
		taglineW = ctx.measureText(side.text.tagline).width;
	}

	const gap = Math.round(H * 0.035);
	const textBlockH = (nameSize ? nameSize : 0) + (taglineSize ? taglineSize + gap * 0.45 : 0);
	const textBlockW = Math.max(nameW, taglineW);

	let width = 0;
	let height = 0;
	if (side.layout === "logo-left") {
		width = logoW + (textBlockW ? gap + textBlockW : 0);
		height = Math.max(logoH, textBlockH);
	} else {
		// logo-only / logo-top / text-only stack vertically.
		width = Math.max(logoW, textBlockW);
		height = logoH + (logoH && textBlockH ? gap : 0) + textBlockH;
	}

	return {
		width,
		height,
		logoW,
		logoH,
		nameSize,
		taglineSize,
		hasLogo: showLogo,
		hasName: hasName && nameSize > 0,
		hasTagline: hasTagline && taglineSize > 0,
	};
}

/** Top-left origin of the content group, honoring placement (15% margins). */
function groupOrigin(
	position: IntroOutroPosition,
	W: number,
	H: number,
	gw: number,
	gh: number,
): { x: number; y: number } {
	let x = (W - gw) / 2;
	let y = (H - gh) / 2;
	if (position === "top") y = H * 0.15;
	else if (position === "bottom") y = H * 0.85 - gh;
	else if (position === "left") x = W * 0.15;
	else if (position === "right") x = W * 0.85 - gw;
	return { x, y };
}

function drawLogoWithContainer(
	ctx: CanvasRenderingContext2D,
	logo: HTMLImageElement,
	x: number,
	y: number,
	w: number,
	h: number,
	style: IntroOutroSideConfig["logoContainer"],
): void {
	if (style === "panel") {
		// Filled rounded card behind the logo with a soft shadow + hairline ring —
		// makes white-bg / busy logos look intentional and premium.
		const pad = Math.round(Math.min(w, h) * 0.18);
		const radius = Math.round(Math.min(w, h) * 0.18) + pad;
		ctx.save();
		ctx.shadowColor = "rgba(0,0,0,0.45)";
		ctx.shadowBlur = Math.round(h * 0.22);
		ctx.shadowOffsetY = Math.round(h * 0.06);
		ctx.fillStyle = "#FFFFFF";
		roundRectPath(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, radius);
		ctx.fill();
		ctx.restore();
		ctx.save();
		roundRectPath(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, radius);
		ctx.lineWidth = Math.max(1, Math.round(h * 0.012));
		ctx.strokeStyle = "rgba(255,255,255,0.14)";
		ctx.stroke();
		ctx.restore();
		ctx.drawImage(logo, x, y, w, h);
		return;
	}
	if (style === "rounded") {
		ctx.save();
		roundRectPath(ctx, x, y, w, h, Math.round(Math.min(w, h) * 0.16));
		ctx.clip();
		ctx.drawImage(logo, x, y, w, h);
		ctx.restore();
		return;
	}
	ctx.drawImage(logo, x, y, w, h);
}

type CtxWithLetterSpacing = CanvasRenderingContext2D & { letterSpacing?: string };

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
	(ctx as CtxWithLetterSpacing).letterSpacing = `${px}px`;
}

function drawName(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
	ctx.fillStyle = color;
	ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
	setLetterSpacing(ctx, -size * 0.02);
	ctx.fillText(text, x, y);
	setLetterSpacing(ctx, 0);
}

function drawTagline(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
	ctx.fillStyle = color;
	ctx.font = `400 ${size}px Inter, system-ui, sans-serif`;
	setLetterSpacing(ctx, size * 0.01);
	const prev = ctx.globalAlpha;
	ctx.globalAlpha = prev * 0.72;
	ctx.fillText(text, x, y);
	ctx.globalAlpha = prev;
	setLetterSpacing(ctx, 0);
}

/** Short accent divider centered at (cx) on baseline y. */
function drawDivider(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, color: string): void {
	const prev = ctx.globalAlpha;
	ctx.globalAlpha = prev * 0.4;
	ctx.fillStyle = color;
	roundRectPath(ctx, cx - width / 2, y, width, Math.max(2, width * 0.03), 2);
	ctx.fill();
	ctx.globalAlpha = prev;
}

function drawGroup(
	ctx: CanvasRenderingContext2D,
	logo: HTMLImageElement | null,
	side: IntroOutroSideConfig,
	m: GroupMetrics,
	ox: number,
	oy: number,
): void {
	const gap = Math.round(ctx.canvas.height * 0.035);
	const textGap = gap * 0.45;
	ctx.textAlign = side.layout === "logo-left" ? "left" : "center";
	ctx.textBaseline = "top";

	if (side.layout === "logo-left") {
		const logoY = oy + (m.height - m.logoH) / 2;
		if (m.hasLogo && logo) {
			drawLogoWithContainer(ctx, logo, ox, logoY, m.logoW, m.logoH, side.logoContainer);
		}
		const textX = ox + (m.hasLogo ? m.logoW + gap : 0);
		const textBlockH =
			(m.hasName ? m.nameSize : 0) + (m.hasTagline ? m.taglineSize + textGap : 0);
		let ty = oy + (m.height - textBlockH) / 2;
		if (m.hasName) {
			drawName(ctx, side.text.brandName, textX, ty, m.nameSize, side.text.color);
			if (m.hasTagline) {
				drawDivider(ctx, textX + m.nameSize * 0.7, ty + m.nameSize + textGap * 0.35, m.nameSize * 1.2, side.text.color);
			}
			ty += m.nameSize + textGap;
		}
		if (m.hasTagline) {
			drawTagline(ctx, side.text.tagline, textX, ty, m.taglineSize, side.text.color);
		}
		return;
	}

	// vertical stack (logo-only / logo-top / text-only)
	const cx = ox + m.width / 2;
	let y = oy;
	if (m.hasLogo && logo) {
		drawLogoWithContainer(ctx, logo, cx - m.logoW / 2, y, m.logoW, m.logoH, side.logoContainer);
		y += m.logoH + gap;
	}
	if (m.hasName) {
		drawName(ctx, side.text.brandName, cx, y, m.nameSize, side.text.color);
		if (m.hasTagline) {
			drawDivider(ctx, cx, y + m.nameSize + textGap * 0.3, m.nameSize * 1.3, side.text.color);
		}
		y += m.nameSize + textGap;
	}
	if (m.hasTagline) {
		drawTagline(ctx, side.text.tagline, cx, y, m.taglineSize, side.text.color);
	}
}

/** Draw one frame of an intro/outro card. */
export function drawCard({ ctx, width, height, logo, side, progress }: CardRenderInput): void {
	const W = width;
	const H = height;
	const t = clamp01(progress);

	ctx.clearRect(0, 0, W, H);
	paintBackground(ctx, W, H, side);

	const m = measureGroup(ctx, H, side, logo);
	if (m.width <= 0 || m.height <= 0) return;

	const origin = groupOrigin(side.position, W, H, m.width, m.height);
	// The animation is a declarative spec sampled at t (see cardAnimations.ts).
	// Its transform is applied to the whole content group about its center; the
	// resting position comes from `origin`, x/y are frame-fraction offsets.
	const anim = resolveAnimation(side.customAnimation ?? getCardAnimation(side.preset), t);
	const cx = origin.x + m.width / 2;
	const cy = origin.y + m.height / 2;

	ctx.save();
	ctx.globalAlpha = clamp01(anim.opacity);
	if (anim.blur > 0) ctx.filter = `blur(${anim.blur}px)`;
	ctx.translate(cx + anim.x * W, cy + anim.y * H);
	if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
	if (anim.rotate !== 0) ctx.rotate((anim.rotate * Math.PI) / 180);
	ctx.translate(-cx, -cy);
	drawGroup(ctx, logo, side, m, origin.x, origin.y);
	ctx.restore();
}

/** Total card duration in ms, clamped to the supported range. */
export function cardDurationMs(side: IntroOutroSideConfig): number {
	return Math.min(8000, Math.max(500, side.durationMs));
}
