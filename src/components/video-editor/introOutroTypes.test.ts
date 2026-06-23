import { describe, expect, it } from "vitest";
import {
	DEFAULT_INTRO_OUTRO,
	INTRO_OUTRO_MAX_DURATION_MS,
	INTRO_OUTRO_MAX_SIZE,
	INTRO_OUTRO_MIN_DURATION_MS,
	INTRO_OUTRO_MIN_SIZE,
	introOutroIsActive,
	normalizeIntroOutro,
} from "./introOutroTypes";

describe("normalizeIntroOutro", () => {
	it("returns defaults for empty / garbage input", () => {
		expect(normalizeIntroOutro(undefined)).toEqual(DEFAULT_INTRO_OUTRO);
		expect(normalizeIntroOutro(null)).toEqual(DEFAULT_INTRO_OUTRO);
		expect(normalizeIntroOutro("nonsense")).toEqual(DEFAULT_INTRO_OUTRO);
		expect(normalizeIntroOutro(42)).toEqual(DEFAULT_INTRO_OUTRO);
	});

	it("clamps duration and size into range", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: { durationMs: 999_999, size: 5 },
			outro: { durationMs: -100, size: 0.01 },
		});
		expect(normalized.intro.durationMs).toBe(INTRO_OUTRO_MAX_DURATION_MS);
		expect(normalized.intro.size).toBe(INTRO_OUTRO_MAX_SIZE);
		expect(normalized.outro.durationMs).toBe(INTRO_OUTRO_MIN_DURATION_MS);
		expect(normalized.outro.size).toBe(INTRO_OUTRO_MIN_SIZE);
	});

	it("falls back to defaults for invalid preset / position / color", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: { preset: "explode", position: "diagonal", backgroundColor: "not-a-color" },
		});
		expect(normalized.intro.preset).toBe("fade");
		expect(normalized.intro.position).toBe("center");
		expect(normalized.intro.backgroundColor).toBe(DEFAULT_INTRO_OUTRO.intro.backgroundColor);
	});

	it("normalizes hex color to lowercase #rrggbb and rejects non-image data URLs", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:text/html;base64,AAAA",
			intro: { backgroundColor: "FF8800" },
		});
		expect(normalized.intro.backgroundColor).toBe("#ff8800");
		// non-image data URL is dropped, so the logo is treated as absent.
		expect(normalized.logoDataUrl).toBe("");
	});

	it("preserves a valid round-trip", () => {
		const valid = {
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: {
				enabled: true,
				preset: "scale-pop" as const,
				durationMs: 2000,
				backgroundColor: "#101820",
				position: "top" as const,
				size: 0.3,
			},
			outro: {
				enabled: false,
				preset: "glitch" as const,
				durationMs: 1200,
				backgroundColor: "#0b1020",
				position: "bottom" as const,
				size: 0.2,
			},
		};
		expect(normalizeIntroOutro(valid)).toEqual(valid);
	});
});

describe("introOutroIsActive", () => {
	const logo = "data:image/png;base64,AAAA";

	it("is false without a logo even if a side is enabled", () => {
		expect(
			introOutroIsActive({
				...DEFAULT_INTRO_OUTRO,
				intro: { ...DEFAULT_INTRO_OUTRO.intro, enabled: true },
			}),
		).toBe(false);
	});

	it("is false with a logo but no side enabled", () => {
		expect(introOutroIsActive({ ...DEFAULT_INTRO_OUTRO, logoDataUrl: logo })).toBe(false);
	});

	it("is true with a logo and at least one side enabled", () => {
		expect(
			introOutroIsActive({
				logoDataUrl: logo,
				intro: { ...DEFAULT_INTRO_OUTRO.intro, enabled: true },
				outro: DEFAULT_INTRO_OUTRO.outro,
			}),
		).toBe(true);
		expect(
			introOutroIsActive({
				logoDataUrl: logo,
				intro: DEFAULT_INTRO_OUTRO.intro,
				outro: { ...DEFAULT_INTRO_OUTRO.outro, enabled: true },
			}),
		).toBe(true);
	});

	it("handles null / undefined", () => {
		expect(introOutroIsActive(null)).toBe(false);
		expect(introOutroIsActive(undefined)).toBe(false);
	});
});
