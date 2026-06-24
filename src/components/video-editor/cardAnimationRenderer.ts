import {
	type AnimationSpec,
	getCardAnimation,
	type ResolvedAnimation,
	resolveAnimation,
	resolveGlow,
	resolveTracks,
} from "./cardAnimations";
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
	// Hue follows the palette — lightened toward white so it always blooms, even
	// on dark backgrounds — instead of a fixed blue that clashed with warm/green/
	// violet cards.
	if (bg.glow > 0) {
		const r = Math.max(W, H) * 0.62;
		const tint = lightenHex(bg.type === "gradient" ? bg.color2 : bg.color1, 0.55);
		const glow = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, r);
		glow.addColorStop(0, hexToRgba(tint, bg.glow * 0.5));
		glow.addColorStop(1, hexToRgba(tint, 0));
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
	/** Panel padding around the logo (0 unless logoContainer === "panel"). */
	panelPad: number;
	/** Logo + panel-padding box dimensions (what the layout reserves). */
	logoBoxW: number;
	logoBoxH: number;
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
	const panelPad =
		showLogo && side.logoContainer === "panel"
			? Math.round(logoH * Math.min(0.5, Math.max(0.05, side.logoPadding)))
			: 0;
	const logoBoxW = logoW + panelPad * 2;
	const logoBoxH = logoH + panelPad * 2;

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
		width = logoBoxW + (textBlockW ? gap + textBlockW : 0);
		height = Math.max(logoBoxH, textBlockH);
	} else {
		// logo-only / logo-top / text-only stack vertically.
		width = Math.max(logoBoxW, textBlockW);
		height = logoBoxH + (logoBoxH && textBlockH ? gap : 0) + textBlockH;
	}

	return {
		width,
		height,
		logoW,
		logoH,
		panelPad,
		logoBoxW,
		logoBoxH,
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
	pad: number,
): void {
	if (style === "panel") {
		// Filled rounded card behind the logo with a soft shadow + hairline ring —
		// makes white-bg / busy logos look intentional and premium. `pad` comes
		// from the layout so the panel box is reserved in spacing (no text overlap).
		const radius = Math.round(Math.min(w, h) * 0.14) + pad;
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

function smoothstep01(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) return x < edge0 ? 0 : 1;
	const u = clamp01((x - edge0) / (edge1 - edge0));
	return u * u * (3 - 2 * u);
}

/** Apply a per-element transform (around its center) then run the draw. */
function withElement(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	anim: ResolvedAnimation,
	draw: () => void,
): void {
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	ctx.save();
	ctx.globalAlpha *= clamp01(anim.opacity);
	if (anim.blur > 0) ctx.filter = `blur(${anim.blur}px)`;
	ctx.translate(cx + anim.x * W, cy + anim.y * H);
	if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
	if (anim.rotate !== 0) ctx.rotate((anim.rotate * Math.PI) / 180);
	ctx.translate(-cx, -cy);
	draw();
	ctx.restore();
}

/** Colored radial glow behind the logo; `intensity` 0..1. */
function drawLogoGlow(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	radius: number,
	color: string,
	intensity: number,
): void {
	if (intensity <= 0 || radius <= 0) return;
	const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
	const a = clamp01(intensity);
	g.addColorStop(0, hexToRgba(color, 0.55 * a));
	g.addColorStop(1, hexToRgba(color, 0));
	const prev = ctx.globalCompositeOperation;
	ctx.globalCompositeOperation = "lighter";
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalCompositeOperation = prev;
}

function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace(/^#/, "");
	const r = parseInt(h.slice(0, 2), 16) || 0;
	const g = parseInt(h.slice(2, 4), 16) || 0;
	const b = parseInt(h.slice(4, 6), 16) || 0;
	return `rgba(${r},${g},${b},${alpha})`;
}

/** Mix a hex color toward white by `amount` (0..1). Keeps the palette hue while
 *  guaranteeing the result is bright enough to read as a glow on dark cards. */
function lightenHex(hex: string, amount: number): string {
	const h = hex.replace(/^#/, "");
	const r = parseInt(h.slice(0, 2), 16) || 0;
	const g = parseInt(h.slice(2, 4), 16) || 0;
	const b = parseInt(h.slice(4, 6), 16) || 0;
	const mix = (c: number) => Math.round(c + (255 - c) * amount);
	const to2 = (n: number) => mix(n).toString(16).padStart(2, "0");
	return `#${to2(r)}${to2(g)}${to2(b)}`;
}

interface TextStyle {
	size: number;
	weight: 800 | 400;
	dim: number; // base alpha multiplier (tagline = 0.72)
	letter: number; // letter-spacing px
}

/** Draw a text element with optional word/char reveal stagger + shine sweep. */
function drawText(
	ctx: CanvasRenderingContext2D,
	text: string,
	leftX: number,
	topY: number,
	style: TextStyle,
	color: string,
	reveal: { mode: "word" | "char"; start: number; durationFrac: number } | null,
	shine: { start: number; durationFrac: number; intensity: number } | null,
	t: number,
): void {
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.font = `${style.weight} ${style.size}px Inter, system-ui, sans-serif`;
	setLetterSpacing(ctx, style.letter);
	const prevAlpha = ctx.globalAlpha;
	const base = prevAlpha * style.dim;
	const totalW = ctx.measureText(text).width;

	if (reveal) {
		const units = reveal.mode === "char" ? Array.from(text) : text.split(" ");
		const n = Math.max(1, units.length);
		const spaceW = ctx.measureText(" ").width;
		const window = Math.max(0.05, reveal.durationFrac);
		// Heavily overlap each unit's fade (≈half the window) so the reveal reads as
		// one smooth cascade instead of words hard-popping one at a time.
		const unitFade = Math.max(0.12, window * 0.5);
		let penX = leftX;
		ctx.fillStyle = color;
		for (let i = 0; i < n; i++) {
			const u = units[i];
			const startI = reveal.start + (i / n) * window;
			const op = smoothstep01(startI, startI + unitFade, t);
			const rise = (1 - op) * style.size * 0.18;
			ctx.globalAlpha = base * op;
			ctx.fillText(u, penX, topY + rise);
			penX += ctx.measureText(u).width + (reveal.mode === "char" ? 0 : spaceW);
		}
	} else {
		ctx.globalAlpha = base;
		ctx.fillStyle = color;
		ctx.fillText(text, leftX, topY);
	}

	// Shine: a moving bright band re-filling the glyphs (composite lighter).
	if (shine && t >= shine.start && t <= shine.start + shine.durationFrac) {
		const p = (t - shine.start) / Math.max(0.001, shine.durationFrac); // 0..1
		const bandX = leftX - totalW * 0.3 + p * totalW * 1.6;
		const half = totalW * 0.18;
		const grad = ctx.createLinearGradient(bandX - half, 0, bandX + half, 0);
		grad.addColorStop(0, "rgba(255,255,255,0)");
		grad.addColorStop(0.5, `rgba(255,255,255,${clamp01(shine.intensity)})`);
		grad.addColorStop(1, "rgba(255,255,255,0)");
		const prevOp = ctx.globalCompositeOperation;
		ctx.globalCompositeOperation = "lighter";
		ctx.fillStyle = grad;
		if (reveal) {
			// Gate the sweep by each unit's reveal progress so the bright band can
			// never expose words the reveal hasn't shown yet (caused ghost text).
			const units = reveal.mode === "char" ? Array.from(text) : text.split(" ");
			const n = Math.max(1, units.length);
			const spaceW = ctx.measureText(" ").width;
			const window = Math.max(0.05, reveal.durationFrac);
			const unitFade = Math.max(0.12, window * 0.5);
			let penX = leftX;
			for (let i = 0; i < n; i++) {
				const startI = reveal.start + (i / n) * window;
				const op = smoothstep01(startI, startI + unitFade, t);
				ctx.globalAlpha = prevAlpha * op;
				ctx.fillText(units[i], penX, topY);
				penX += ctx.measureText(units[i]).width + (reveal.mode === "char" ? 0 : spaceW);
			}
		} else {
			ctx.globalAlpha = prevAlpha;
			ctx.fillText(text, leftX, topY);
		}
		ctx.globalCompositeOperation = prevOp;
	}

	ctx.globalAlpha = prevAlpha;
	setLetterSpacing(ctx, 0);
}

/** Short accent divider centered at (cx) on baseline y. */
function drawDivider(
	ctx: CanvasRenderingContext2D,
	cx: number,
	y: number,
	width: number,
	color: string,
): void {
	const prev = ctx.globalAlpha;
	ctx.globalAlpha = prev * 0.4;
	ctx.fillStyle = color;
	roundRectPath(ctx, cx - width / 2, y, width, Math.max(2, width * 0.03), 2);
	ctx.fill();
	ctx.globalAlpha = prev;
}

function revealFor(
	spec: AnimationSpec,
	role: "name" | "tagline",
): { mode: "word" | "char"; start: number; durationFrac: number } | null {
	const r = spec.reveal;
	if (!r) return null;
	if (r.target === role || r.target === "both") {
		return { mode: r.mode, start: r.start, durationFrac: r.durationFrac };
	}
	return null;
}
function shineFor(
	spec: AnimationSpec,
	role: "name" | "tagline",
): { start: number; durationFrac: number; intensity: number } | null {
	const s = spec.shine;
	if (!s) return null;
	if (s.target === role || s.target === "both") {
		return { start: s.start, durationFrac: s.durationFrac, intensity: s.intensity };
	}
	return null;
}

function drawGroup(
	ctx: CanvasRenderingContext2D,
	logo: HTMLImageElement | null,
	side: IntroOutroSideConfig,
	m: GroupMetrics,
	ox: number,
	oy: number,
	spec: AnimationSpec,
	t: number,
): void {
	const gap = Math.round(ctx.canvas.height * 0.035);
	const textGap = gap * 0.45;
	const color = side.text.color;
	const nameStyle: TextStyle = {
		size: m.nameSize,
		weight: 800,
		dim: 1,
		letter: -m.nameSize * 0.02,
	};
	const tagStyle: TextStyle = {
		size: m.taglineSize,
		weight: 400,
		dim: 0.72,
		letter: m.taglineSize * 0.01,
	};
	const logoAnim = resolveTracks(spec.elements?.logo, t);
	const nameAnim = resolveTracks(spec.elements?.name, t);
	const tagAnim = resolveTracks(spec.elements?.tagline, t);
	const glowIntensity = resolveGlow(spec, t);
	const glowColor = spec.glow?.color ?? "#6478ff";

	// (boxX, boxY) = top-left of the logo's reserved box (logo + panel padding).
	const drawLogo = (boxX: number, boxY: number) => {
		if (!m.hasLogo || !logo) return;
		const imgX = boxX + m.panelPad;
		const imgY = boxY + m.panelPad;
		const cx = imgX + m.logoW / 2;
		const cy = imgY + m.logoH / 2;
		withElement(ctx, cx, cy, logoAnim, () => {
			drawLogoGlow(ctx, cx, cy, m.logoH * 0.95, glowColor, glowIntensity);
			drawLogoWithContainer(
				ctx,
				logo,
				imgX,
				imgY,
				m.logoW,
				m.logoH,
				side.logoContainer,
				m.panelPad,
			);
		});
	};

	if (side.layout === "logo-left") {
		drawLogo(ox, oy + (m.height - m.logoBoxH) / 2);
		const textX = ox + (m.hasLogo ? m.logoBoxW + gap : 0);
		const textBlockH =
			(m.hasName ? m.nameSize : 0) + (m.hasTagline ? m.taglineSize + textGap : 0);
		let ty = oy + (m.height - textBlockH) / 2;
		if (m.hasName) {
			ctx.font = `800 ${m.nameSize}px Inter, system-ui, sans-serif`;
			setLetterSpacing(ctx, -m.nameSize * 0.02);
			const nw = ctx.measureText(side.text.brandName).width;
			setLetterSpacing(ctx, 0);
			const ny = ty;
			withElement(ctx, textX + nw / 2, ny + m.nameSize / 2, nameAnim, () =>
				drawText(
					ctx,
					side.text.brandName,
					textX,
					ny,
					nameStyle,
					color,
					revealFor(spec, "name"),
					shineFor(spec, "name"),
					t,
				),
			);
			if (m.hasTagline) {
				drawDivider(
					ctx,
					textX + m.nameSize * 0.7,
					ty + m.nameSize + textGap * 0.35,
					m.nameSize * 1.2,
					color,
				);
			}
			ty += m.nameSize + textGap;
		}
		if (m.hasTagline) {
			const gy = ty;
			ctx.font = `400 ${m.taglineSize}px Inter, system-ui, sans-serif`;
			const tw = ctx.measureText(side.text.tagline).width;
			withElement(ctx, textX + tw / 2, gy + m.taglineSize / 2, tagAnim, () =>
				drawText(
					ctx,
					side.text.tagline,
					textX,
					gy,
					tagStyle,
					color,
					revealFor(spec, "tagline"),
					shineFor(spec, "tagline"),
					t,
				),
			);
		}
		return;
	}

	// vertical stack (logo-only / logo-top / text-only)
	const cx = ox + m.width / 2;
	let y = oy;
	if (m.hasLogo && logo) {
		drawLogo(cx - m.logoBoxW / 2, y);
		y += m.logoBoxH + gap;
	}
	if (m.hasName) {
		ctx.font = `800 ${m.nameSize}px Inter, system-ui, sans-serif`;
		setLetterSpacing(ctx, -m.nameSize * 0.02);
		const nw = ctx.measureText(side.text.brandName).width;
		setLetterSpacing(ctx, 0);
		const ny = y;
		withElement(ctx, cx, ny + m.nameSize / 2, nameAnim, () =>
			drawText(
				ctx,
				side.text.brandName,
				cx - nw / 2,
				ny,
				nameStyle,
				color,
				revealFor(spec, "name"),
				shineFor(spec, "name"),
				t,
			),
		);
		if (m.hasTagline) {
			drawDivider(ctx, cx, y + m.nameSize + textGap * 0.3, m.nameSize * 1.3, color);
		}
		y += m.nameSize + textGap;
	}
	if (m.hasTagline) {
		ctx.font = `400 ${m.taglineSize}px Inter, system-ui, sans-serif`;
		const tw = ctx.measureText(side.text.tagline).width;
		const gy = y;
		withElement(ctx, cx, gy + m.taglineSize / 2, tagAnim, () =>
			drawText(
				ctx,
				side.text.tagline,
				cx - tw / 2,
				gy,
				tagStyle,
				color,
				revealFor(spec, "tagline"),
				shineFor(spec, "tagline"),
				t,
			),
		);
	}
}

/**
 * The STATIC background (gradient + glow + vignette). Cheap to cache: it only
 * changes with size/background config, not per frame — the inline overlay
 * pre-renders this once and blits it each frame instead of recreating gradients.
 */
export function drawCardBackground(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	side: IntroOutroSideConfig,
): void {
	paintBackground(ctx, width, height, side);
}

/** The animated FOREGROUND (logo + text + effects) at progress t. */
export function drawCardForeground(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	logo: HTMLImageElement | null,
	side: IntroOutroSideConfig,
	progress: number,
): void {
	const W = width;
	const H = height;
	const t = clamp01(progress);

	const m = measureGroup(ctx, H, side, logo);
	if (m.width <= 0 || m.height <= 0) return;

	const origin = groupOrigin(side.position, W, H, m.width, m.height);
	const spec = side.customAnimation ?? getCardAnimation(side.preset);
	const anim = resolveAnimation(spec, t);
	const cx = origin.x + m.width / 2;
	const cy = origin.y + m.height / 2;

	// Auto-fit: a long tagline or oversized logo would otherwise spill off-frame
	// (text is single-line, never wraps). Shrink the whole group around its
	// center to stay within 90% of the frame on both axes.
	const fit = Math.min(1, (W * 0.9) / m.width, (H * 0.9) / m.height);
	const scale = anim.scale * fit;

	ctx.save();
	ctx.globalAlpha = clamp01(anim.opacity);
	if (anim.blur > 0) ctx.filter = `blur(${anim.blur}px)`;
	ctx.translate(cx + anim.x * W, cy + anim.y * H);
	if (scale !== 1) ctx.scale(scale, scale);
	if (anim.rotate !== 0) ctx.rotate((anim.rotate * Math.PI) / 180);
	ctx.translate(-cx, -cy);
	drawGroup(ctx, logo, side, m, origin.x, origin.y, spec, t);
	ctx.restore();
}

/** Draw one full frame of an intro/outro card (background + foreground). */
export function drawCard({ ctx, width, height, logo, side, progress }: CardRenderInput): void {
	ctx.clearRect(0, 0, width, height);
	drawCardBackground(ctx, width, height, side);
	drawCardForeground(ctx, width, height, logo, side, progress);
}

/** Total card duration in ms, clamped to the supported range. */
export function cardDurationMs(side: IntroOutroSideConfig): number {
	return Math.min(8000, Math.max(500, side.durationMs));
}
