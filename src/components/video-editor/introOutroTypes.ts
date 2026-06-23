/**
 * Per-project intro/outro cards. Renderer-side mirror of the main-process config
 * in electron/ipc/export/introOutro.ts (communicate over `finalize-exported-video`).
 * The logo travels as a base64 data URL in the project JSON so projects stay
 * portable; uploaded videos are referenced by path (too big to embed).
 */

import type { AnimationSpec } from "./cardAnimations";

export type IntroOutroMode = "card" | "video";
/**
 * Animation ids — keys into the spec library in cardAnimations.ts. Add a new
 * animation by adding an id here + a spec there; no renderer changes needed.
 */
export const CARD_ANIMATION_IDS = [
	"fade",
	"zoom-in",
	"scale-pop",
	"slide",
	"slide-up",
	"rise",
	"bounce",
	"zoom-out",
	"spin-in",
	"reveal",
	"glitch",
	"drop",
] as const;
export type IntroOutroPreset = (typeof CARD_ANIMATION_IDS)[number];
export type IntroOutroPosition = "center" | "top" | "bottom" | "left" | "right";
export type CardLayout = "logo-only" | "logo-top" | "logo-left" | "text-only";
export type BackgroundType = "solid" | "gradient";
/** Styled container behind the logo — `panel` fixes white-bg / busy logos. */
export type LogoContainerStyle = "none" | "rounded" | "panel";
export type CardAudioMode = "none" | "builtin" | "upload";

export const INTRO_OUTRO_PRESETS: readonly IntroOutroPreset[] = CARD_ANIMATION_IDS;
export const INTRO_OUTRO_POSITIONS: IntroOutroPosition[] = [
	"center",
	"top",
	"bottom",
	"left",
	"right",
];
export const CARD_LAYOUTS: CardLayout[] = ["logo-only", "logo-top", "logo-left", "text-only"];
export const LOGO_CONTAINER_STYLES: LogoContainerStyle[] = ["none", "rounded", "panel"];

export const INTRO_OUTRO_MIN_DURATION_MS = 500;
export const INTRO_OUTRO_MAX_DURATION_MS = 8000;
export const INTRO_OUTRO_MIN_SIZE = 0.1;
export const INTRO_OUTRO_MAX_SIZE = 0.8;

/** Bundled music stings (assets wired in a later phase). */
export interface BuiltinTrack {
	id: string;
	label: string;
}
export const BUILTIN_TRACKS: BuiltinTrack[] = [
	{ id: "uplift", label: "Uplift" },
	{ id: "cinematic", label: "Cinematic" },
	{ id: "pop", label: "Pop" },
	{ id: "calm", label: "Calm" },
	{ id: "whoosh", label: "Whoosh" },
];

export interface CardBackground {
	type: BackgroundType;
	color1: string;
	color2: string;
	/** Gradient direction in degrees (0 = left→right). */
	angle: number;
	/** Soft radial accent glow behind the content, 0 (off) → 1. */
	glow: number;
	/** Edge darkening for depth, 0 (off) → 1. */
	vignette: number;
}

export interface CardText {
	brandName: string;
	tagline: string;
	color: string;
}

export interface CardAudio {
	mode: CardAudioMode;
	/** Built-in track id (when mode = "builtin"). */
	trackId: string;
	/** Uploaded audio as a data URL (when mode = "upload"). */
	dataUrl: string;
	/** 0 → 1. */
	volume: number;
}

export interface IntroOutroSideConfig {
	enabled: boolean;
	mode: IntroOutroMode;
	// --- card mode ---
	preset: IntroOutroPreset;
	position: IntroOutroPosition;
	durationMs: number;
	/** Logo height as a fraction of frame height (0.1–0.8). */
	size: number;
	layout: CardLayout;
	background: CardBackground;
	logoContainer: LogoContainerStyle;
	/** Panel padding around the logo as a fraction of logo height (0.05–0.5). */
	logoPadding: number;
	text: CardText;
	/** AI/hand-authored animation overriding `preset` when set. */
	customAnimation: AnimationSpec | null;
	// --- video mode ---
	/** Absolute path to a user-supplied intro/outro clip (not portable). */
	videoPath: string;
	// --- both modes ---
	audio: CardAudio;
}

export interface IntroOutroConfig {
	/** "data:image/png;base64,..." — the user's logo, or "" if none. */
	logoDataUrl: string;
	intro: IntroOutroSideConfig;
	outro: IntroOutroSideConfig;
}

export const DEFAULT_CARD_BACKGROUND: CardBackground = {
	type: "gradient",
	color1: "#0b1020",
	color2: "#1e293b",
	angle: 135,
	glow: 0.18,
	vignette: 0.28,
};

export const DEFAULT_CARD_TEXT: CardText = {
	brandName: "",
	tagline: "",
	color: "#ffffff",
};

export const DEFAULT_CARD_AUDIO: CardAudio = {
	mode: "none",
	trackId: "uplift",
	dataUrl: "",
	volume: 0.7,
};

export const DEFAULT_INTRO_OUTRO_SIDE: IntroOutroSideConfig = {
	enabled: false,
	mode: "card",
	preset: "zoom-in",
	position: "center",
	durationMs: 2000,
	size: 0.25,
	layout: "logo-top",
	background: { ...DEFAULT_CARD_BACKGROUND },
	logoContainer: "panel",
	logoPadding: 0.18,
	text: { ...DEFAULT_CARD_TEXT },
	customAnimation: null,
	videoPath: "",
	audio: { ...DEFAULT_CARD_AUDIO },
};

export const DEFAULT_INTRO_OUTRO: IntroOutroConfig = {
	logoDataUrl: "",
	intro: { ...DEFAULT_INTRO_OUTRO_SIDE, background: { ...DEFAULT_CARD_BACKGROUND } },
	outro: { ...DEFAULT_INTRO_OUTRO_SIDE, background: { ...DEFAULT_CARD_BACKGROUND } },
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.min(max, Math.max(min, value));
	}
	return fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeHexColor(value: unknown, fallback: string): string {
	if (typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
		return `#${value.trim().replace(/^#/, "").toLowerCase()}`;
	}
	return fallback;
}

/** Collapse whitespace runs (incl. those introduced by repairing wrapped JSON). */
function normalizeDisplayText(value: unknown, max = 120): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalizeBackground(value: unknown, legacyColor?: unknown): CardBackground {
	const bg = (value ?? {}) as Partial<CardBackground>;
	// Migrate the legacy flat `backgroundColor` into color1 when no nested bg.
	const fallback1 =
		value === undefined && legacyColor !== undefined
			? normalizeHexColor(legacyColor, DEFAULT_CARD_BACKGROUND.color1)
			: DEFAULT_CARD_BACKGROUND.color1;
	return {
		type: pick(bg.type, ["solid", "gradient"], DEFAULT_CARD_BACKGROUND.type),
		color1: normalizeHexColor(bg.color1, fallback1),
		color2: normalizeHexColor(bg.color2, DEFAULT_CARD_BACKGROUND.color2),
		angle: clampNumber(bg.angle, 0, 360, DEFAULT_CARD_BACKGROUND.angle),
		glow: clampNumber(bg.glow, 0, 1, DEFAULT_CARD_BACKGROUND.glow),
		vignette: clampNumber(bg.vignette, 0, 1, DEFAULT_CARD_BACKGROUND.vignette),
	};
}

// Shallow pass-through on load — specs are deep-validated in the UI before they
// are ever stored (cardAnimations.normalizeAnimationSpec). Local check avoids a
// value import from cardAnimations (which imports this module).
function normalizeCustomAnimation(value: unknown): AnimationSpec | null {
	return value &&
		typeof value === "object" &&
		Array.isArray((value as { tracks?: unknown }).tracks)
		? (value as AnimationSpec)
		: null;
}

function normalizeText(value: unknown): CardText {
	const text = (value ?? {}) as Partial<CardText>;
	return {
		brandName: normalizeDisplayText(text.brandName),
		tagline: normalizeDisplayText(text.tagline),
		color: normalizeHexColor(text.color, DEFAULT_CARD_TEXT.color),
	};
}

function normalizeAudio(value: unknown): CardAudio {
	const audio = (value ?? {}) as Partial<CardAudio>;
	const dataUrl =
		typeof audio.dataUrl === "string" && /^data:audio\//i.test(audio.dataUrl)
			? audio.dataUrl
			: "";
	return {
		mode: pick(audio.mode, ["none", "builtin", "upload"], DEFAULT_CARD_AUDIO.mode),
		trackId: typeof audio.trackId === "string" ? audio.trackId : DEFAULT_CARD_AUDIO.trackId,
		dataUrl,
		volume: clampNumber(audio.volume, 0, 1, DEFAULT_CARD_AUDIO.volume),
	};
}

function normalizeSide(value: unknown): IntroOutroSideConfig {
	const side = (value ?? {}) as Partial<IntroOutroSideConfig> & { backgroundColor?: unknown };
	return {
		enabled: side.enabled === true,
		mode: pick(side.mode, ["card", "video"], DEFAULT_INTRO_OUTRO_SIDE.mode),
		preset: pick(side.preset, INTRO_OUTRO_PRESETS, DEFAULT_INTRO_OUTRO_SIDE.preset),
		position: pick(side.position, INTRO_OUTRO_POSITIONS, DEFAULT_INTRO_OUTRO_SIDE.position),
		durationMs: clampNumber(
			side.durationMs,
			INTRO_OUTRO_MIN_DURATION_MS,
			INTRO_OUTRO_MAX_DURATION_MS,
			DEFAULT_INTRO_OUTRO_SIDE.durationMs,
		),
		size: clampNumber(
			side.size,
			INTRO_OUTRO_MIN_SIZE,
			INTRO_OUTRO_MAX_SIZE,
			DEFAULT_INTRO_OUTRO_SIDE.size,
		),
		layout: pick(side.layout, CARD_LAYOUTS, DEFAULT_INTRO_OUTRO_SIDE.layout),
		background: normalizeBackground(side.background, side.backgroundColor),
		logoContainer: pick(
			side.logoContainer,
			LOGO_CONTAINER_STYLES,
			DEFAULT_INTRO_OUTRO_SIDE.logoContainer,
		),
		logoPadding: clampNumber(side.logoPadding, 0.05, 0.5, DEFAULT_INTRO_OUTRO_SIDE.logoPadding),
		text: normalizeText(side.text),
		customAnimation: normalizeCustomAnimation(side.customAnimation),
		videoPath: typeof side.videoPath === "string" ? side.videoPath : "",
		audio: normalizeAudio(side.audio),
	};
}

function normalizeLogoDataUrl(value: unknown): string {
	if (typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) {
		return value;
	}
	return "";
}

export function normalizeIntroOutro(value: unknown): IntroOutroConfig {
	const config = (value ?? {}) as Partial<IntroOutroConfig>;
	return {
		logoDataUrl: normalizeLogoDataUrl(config.logoDataUrl),
		intro: normalizeSide(config.intro),
		outro: normalizeSide(config.outro),
	};
}

/** A side contributes something to the export/preview. */
export function sideIsRenderable(
	side: IntroOutroSideConfig | undefined,
	logoDataUrl: string,
): boolean {
	if (!side?.enabled) return false;
	if (side.mode === "video") return Boolean(side.videoPath);
	// Card mode needs at least a logo or brand text.
	return Boolean(logoDataUrl) || Boolean(side.text.brandName) || Boolean(side.text.tagline);
}

/** True when at least one side is enabled and renderable. */
export function introOutroIsActive(config: IntroOutroConfig | null | undefined): boolean {
	if (!config) return false;
	return (
		sideIsRenderable(config.intro, config.logoDataUrl) ||
		sideIsRenderable(config.outro, config.logoDataUrl)
	);
}
