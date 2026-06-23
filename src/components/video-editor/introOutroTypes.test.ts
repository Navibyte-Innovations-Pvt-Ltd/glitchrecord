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

	it("falls back to defaults for invalid preset / position / layout", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: { preset: "explode", position: "diagonal", layout: "nope" },
		});
		expect(normalized.intro.preset).toBe("fade");
		expect(normalized.intro.position).toBe("center");
		expect(normalized.intro.layout).toBe(DEFAULT_INTRO_OUTRO.intro.layout);
	});

	it("migrates legacy flat backgroundColor into background.color1", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: { backgroundColor: "FF8800" },
		});
		expect(normalized.intro.background.color1).toBe("#ff8800");
		expect(normalized.intro.background.type).toBe(DEFAULT_INTRO_OUTRO.intro.background.type);
	});

	it("normalizes nested background + text + rejects non-image logo", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:text/html;base64,AAAA",
			intro: {
				background: { type: "solid", color1: "AABBCC", angle: 9999 },
				text: { brandName: "Acme", tagline: "Ship it", color: "00FF00" },
			},
		});
		expect(normalized.logoDataUrl).toBe(""); // non-image dropped
		expect(normalized.intro.background.type).toBe("solid");
		expect(normalized.intro.background.color1).toBe("#aabbcc");
		expect(normalized.intro.background.angle).toBe(360); // clamped
		expect(normalized.intro.text.brandName).toBe("Acme");
		expect(normalized.intro.text.color).toBe("#00ff00");
	});

	it("preserves a valid round-trip", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: {
				...DEFAULT_INTRO_OUTRO.intro,
				enabled: true,
				mode: "video",
				videoPath: "/x.mp4",
			},
			outro: { ...DEFAULT_INTRO_OUTRO.outro },
		});
		expect(normalized.intro.mode).toBe("video");
		expect(normalized.intro.videoPath).toBe("/x.mp4");
		expect(normalized.outro).toEqual(DEFAULT_INTRO_OUTRO.outro);
	});

	it("normalizes audio config", () => {
		const normalized = normalizeIntroOutro({
			logoDataUrl: "data:image/png;base64,AAAA",
			intro: {
				audio: { mode: "builtin", trackId: "riser", volume: 2, dataUrl: "not-audio" },
			},
		});
		expect(normalized.intro.audio.mode).toBe("builtin");
		expect(normalized.intro.audio.trackId).toBe("riser");
		expect(normalized.intro.audio.volume).toBe(1); // clamped
		expect(normalized.intro.audio.dataUrl).toBe(""); // non-audio data URL dropped
	});
});

describe("introOutroIsActive", () => {
	const logo = "data:image/png;base64,AAAA";

	it("is false without a logo or text even if a side is enabled (card mode)", () => {
		expect(
			introOutroIsActive({
				...DEFAULT_INTRO_OUTRO,
				intro: { ...DEFAULT_INTRO_OUTRO.intro, enabled: true },
			}),
		).toBe(false);
	});

	it("is true when enabled with a logo (card mode)", () => {
		expect(
			introOutroIsActive({
				logoDataUrl: logo,
				intro: { ...DEFAULT_INTRO_OUTRO.intro, enabled: true },
				outro: DEFAULT_INTRO_OUTRO.outro,
			}),
		).toBe(true);
	});

	it("is true when enabled with only brand text (no logo)", () => {
		expect(
			introOutroIsActive({
				logoDataUrl: "",
				intro: {
					...DEFAULT_INTRO_OUTRO.intro,
					enabled: true,
					text: { ...DEFAULT_INTRO_OUTRO.intro.text, brandName: "Acme" },
				},
				outro: DEFAULT_INTRO_OUTRO.outro,
			}),
		).toBe(true);
	});

	it("video mode needs a videoPath", () => {
		const base = { logoDataUrl: "", outro: DEFAULT_INTRO_OUTRO.outro };
		expect(
			introOutroIsActive({
				...base,
				intro: {
					...DEFAULT_INTRO_OUTRO.intro,
					enabled: true,
					mode: "video",
					videoPath: "",
				},
			}),
		).toBe(false);
		expect(
			introOutroIsActive({
				...base,
				intro: {
					...DEFAULT_INTRO_OUTRO.intro,
					enabled: true,
					mode: "video",
					videoPath: "/v.mp4",
				},
			}),
		).toBe(true);
	});

	it("handles null / undefined", () => {
		expect(introOutroIsActive(null)).toBe(false);
		expect(introOutroIsActive(undefined)).toBe(false);
	});
});
