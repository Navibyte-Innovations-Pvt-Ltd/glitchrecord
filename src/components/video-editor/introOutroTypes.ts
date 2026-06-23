/**
 * Per-project intro/outro logo cards. Renderer-side mirror of the main-process
 * config in electron/ipc/export/introOutro.ts (the two communicate over the
 * `finalize-exported-video` IPC). The logo travels as a base64 data URL embedded
 * in the project JSON, so projects stay portable when moved/shared.
 */

export type IntroOutroPreset = "fade" | "scale-pop" | "slide" | "glitch";

export type IntroOutroPosition = "center" | "top" | "bottom" | "left" | "right";

export const INTRO_OUTRO_PRESETS: IntroOutroPreset[] = ["fade", "scale-pop", "slide", "glitch"];

export const INTRO_OUTRO_POSITIONS: IntroOutroPosition[] = [
	"center",
	"top",
	"bottom",
	"left",
	"right",
];

export const INTRO_OUTRO_MIN_DURATION_MS = 500;
export const INTRO_OUTRO_MAX_DURATION_MS = 5000;
export const INTRO_OUTRO_MIN_SIZE = 0.1;
export const INTRO_OUTRO_MAX_SIZE = 0.8;

export interface IntroOutroSideConfig {
	enabled: boolean;
	preset: IntroOutroPreset;
	/** Card duration in milliseconds (clamped 500–5000). */
	durationMs: number;
	/** Background hex color, e.g. "#0B1020". */
	backgroundColor: string;
	/** Logo placement for static presets; slide enters from this edge. */
	position: IntroOutroPosition;
	/** Logo height as a fraction of frame height (clamped 0.1–0.8). */
	size: number;
}

export interface IntroOutroConfig {
	/** "data:image/png;base64,..." — the user's transparent logo, or "" if none. */
	logoDataUrl: string;
	intro: IntroOutroSideConfig;
	outro: IntroOutroSideConfig;
}

export const DEFAULT_INTRO_OUTRO_SIDE: IntroOutroSideConfig = {
	enabled: false,
	preset: "fade",
	durationMs: 1500,
	backgroundColor: "#0B1020",
	position: "center",
	size: 0.25,
};

export const DEFAULT_INTRO_OUTRO: IntroOutroConfig = {
	logoDataUrl: "",
	intro: { ...DEFAULT_INTRO_OUTRO_SIDE },
	outro: { ...DEFAULT_INTRO_OUTRO_SIDE },
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.min(max, Math.max(min, value));
	}
	return fallback;
}

function normalizePreset(value: unknown): IntroOutroPreset {
	return INTRO_OUTRO_PRESETS.includes(value as IntroOutroPreset)
		? (value as IntroOutroPreset)
		: DEFAULT_INTRO_OUTRO_SIDE.preset;
}

function normalizePosition(value: unknown): IntroOutroPosition {
	return INTRO_OUTRO_POSITIONS.includes(value as IntroOutroPosition)
		? (value as IntroOutroPosition)
		: DEFAULT_INTRO_OUTRO_SIDE.position;
}

function normalizeHexColor(value: unknown): string {
	if (typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
		const hex = value.trim().replace(/^#/, "");
		return `#${hex.toLowerCase()}`;
	}
	return DEFAULT_INTRO_OUTRO_SIDE.backgroundColor;
}

function normalizeSide(value: unknown): IntroOutroSideConfig {
	const side = (value ?? {}) as Partial<IntroOutroSideConfig>;
	return {
		enabled: side.enabled === true,
		preset: normalizePreset(side.preset),
		durationMs: clampNumber(
			side.durationMs,
			INTRO_OUTRO_MIN_DURATION_MS,
			INTRO_OUTRO_MAX_DURATION_MS,
			DEFAULT_INTRO_OUTRO_SIDE.durationMs,
		),
		backgroundColor: normalizeHexColor(side.backgroundColor),
		position: normalizePosition(side.position),
		size: clampNumber(
			side.size,
			INTRO_OUTRO_MIN_SIZE,
			INTRO_OUTRO_MAX_SIZE,
			DEFAULT_INTRO_OUTRO_SIDE.size,
		),
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

/** True when at least one side is enabled and a logo is present. */
export function introOutroIsActive(config: IntroOutroConfig | null | undefined): boolean {
	if (!config || !config.logoDataUrl) {
		return false;
	}
	return config.intro.enabled || config.outro.enabled;
}
