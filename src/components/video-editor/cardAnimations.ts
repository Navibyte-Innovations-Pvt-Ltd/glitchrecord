import type { AudioAnalysis } from "./analyzeAudio";
import {
	CARD_ANIMATION_IDS,
	CARD_LAYOUTS,
	type CardBackground,
	type CardLayout,
	type CardText,
	DEFAULT_CARD_BACKGROUND,
	DEFAULT_CARD_TEXT,
	INTRO_OUTRO_MAX_DURATION_MS,
	INTRO_OUTRO_MAX_SIZE,
	INTRO_OUTRO_MIN_DURATION_MS,
	INTRO_OUTRO_MIN_SIZE,
	INTRO_OUTRO_POSITIONS,
	type IntroOutroPosition,
	type IntroOutroPreset,
	type IntroOutroSideConfig,
	LOGO_CONTAINER_STYLES,
	type LogoContainerStyle,
} from "./introOutroTypes";

/**
 * Standardized declarative animation system for intro/outro cards.
 *
 * An animation is a set of TRACKS, one per animatable property, each a list of
 * KEYFRAMES over normalized time t∈[0,1] (the card's full duration). The renderer
 * samples every track at the current t and applies the resolved transform to the
 * whole content group (logo + text). Adding an animation = adding a spec to
 * CARD_ANIMATIONS keyed by its id in introOutroTypes — no renderer changes.
 *
 * Property semantics (resting state = identity):
 *   opacity 0..1 · scale multiplier (1 = natural) · x/y offset as a FRACTION of
 *   frame width/height (−1 = one frame off-screen) · rotate degrees · blur px.
 */

export type Easing =
	| "linear"
	| "easeIn"
	| "easeOut"
	| "easeInOut"
	| "easeOutCubic"
	| "easeOutBack"
	| "easeOutExpo"
	| "easeOutBounce";

export type AnimatableProperty = "opacity" | "scale" | "x" | "y" | "rotate" | "blur";

export interface Keyframe {
	/** Normalized time 0..1 over the card duration. */
	t: number;
	value: number;
	/** Easing applied on the segment leading INTO this keyframe. */
	easing?: Easing;
}

export interface AnimationTrack {
	property: AnimatableProperty;
	keyframes: Keyframe[];
}

export type TextTarget = "name" | "tagline" | "both";

/** Per-element extra transforms layered on top of the group `tracks`. */
export interface ElementTracks {
	logo?: AnimationTrack[];
	name?: AnimationTrack[];
	tagline?: AnimationTrack[];
}

/** Staggered text entrance: words or characters reveal one after another. */
export interface TextReveal {
	target: TextTarget;
	mode: "word" | "char";
	/** When the reveal starts (0..1). */
	start: number;
	/** Fraction of the timeline over which all units finish revealing (0..1). */
	durationFrac: number;
}

/** A moving highlight band that sweeps across the text glyphs ("flare"). */
export interface Shine {
	target: TextTarget;
	start: number;
	durationFrac: number;
	/** 0..1 brightness of the sweep. */
	intensity: number;
}

/** Colored glow halo behind the logo; intensity animates over t (e.g. pulses). */
export interface GlowPulse {
	color: string;
	keyframes: Keyframe[];
}

export interface AnimationSpec {
	/** Library id, or "custom" for AI/hand-authored specs. */
	id: string;
	label: string;
	/** Group-level transform applied to the whole card content. */
	tracks: AnimationTrack[];
	/** Optional extra transforms per element (logo/name/tagline). */
	elements?: ElementTracks;
	reveal?: TextReveal;
	shine?: Shine;
	glow?: GlowPulse;
}

export interface ResolvedAnimation {
	opacity: number;
	scale: number;
	x: number;
	y: number;
	rotate: number;
	blur: number;
}

const IDENTITY: ResolvedAnimation = { opacity: 1, scale: 1, x: 0, y: 0, rotate: 0, blur: 0 };

function clamp01(v: number): number {
	return Math.min(1, Math.max(0, v));
}

function applyEasing(easing: Easing | undefined, t: number): number {
	const x = clamp01(t);
	switch (easing) {
		case "easeIn":
			return x * x;
		case "easeOut":
			return 1 - (1 - x) * (1 - x);
		case "easeInOut":
			return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
		case "easeOutCubic":
			return 1 - (1 - x) ** 3;
		case "easeOutBack": {
			const c1 = 1.70158;
			const c3 = c1 + 1;
			return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
		}
		case "easeOutExpo":
			return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
		case "easeOutBounce": {
			const n1 = 7.5625;
			const d1 = 2.75;
			if (x < 1 / d1) return n1 * x * x;
			if (x < 2 / d1) {
				const u = x - 1.5 / d1;
				return n1 * u * u + 0.75;
			}
			if (x < 2.5 / d1) {
				const u = x - 2.25 / d1;
				return n1 * u * u + 0.9375;
			}
			const u = x - 2.625 / d1;
			return n1 * u * u + 0.984375;
		}
		default:
			return x;
	}
}

/** Sample a single track at normalized time t. */
function sampleTrack(track: AnimationTrack, t: number): number {
	const kf = track.keyframes;
	if (kf.length === 0) return defaultFor(track.property);
	if (t <= kf[0].t) return kf[0].value;
	if (t >= kf[kf.length - 1].t) return kf[kf.length - 1].value;
	for (let i = 1; i < kf.length; i++) {
		const a = kf[i - 1];
		const b = kf[i];
		if (t <= b.t) {
			const span = b.t - a.t;
			const local = span <= 0 ? 1 : (t - a.t) / span;
			const eased = applyEasing(b.easing, local);
			return a.value + (b.value - a.value) * eased;
		}
	}
	return kf[kf.length - 1].value;
}

function defaultFor(p: AnimatableProperty): number {
	return p === "opacity" || p === "scale" ? 1 : 0;
}

/** Resolve a list of tracks at normalized time t into a transform. */
export function resolveTracks(tracks: AnimationTrack[] | undefined, t: number): ResolvedAnimation {
	const out: ResolvedAnimation = { ...IDENTITY };
	if (!tracks) return out;
	for (const track of tracks) {
		out[track.property] = sampleTrack(track, t);
	}
	return out;
}

/** Resolve the group-level tracks of a spec at normalized time t. */
export function resolveAnimation(spec: AnimationSpec | undefined, t: number): ResolvedAnimation {
	return resolveTracks(spec?.tracks, t);
}

/** Sample the glow-pulse intensity (0..1) at t, or 0 if no glow. */
export function resolveGlow(spec: AnimationSpec | undefined, t: number): number {
	if (!spec?.glow?.keyframes?.length) return 0;
	return clamp01(sampleTrack({ property: "opacity", keyframes: spec.glow.keyframes }, t));
}

// Shared tail fade-out so every animation exits cleanly.
const FADE_OUT: Keyframe[] = [
	{ t: 0.82, value: 1 },
	{ t: 1, value: 0, easing: "easeIn" },
];
const fadeIn = (end: number): Keyframe[] => [
	{ t: 0, value: 0 },
	{ t: end, value: 1, easing: "easeOut" },
];
const opacity = (inEnd: number): AnimationTrack => ({
	property: "opacity",
	keyframes: [...fadeIn(inEnd), ...FADE_OUT],
});

export const CARD_ANIMATIONS: Record<IntroOutroPreset, AnimationSpec> = {
	fade: {
		id: "fade",
		label: "Fade",
		tracks: [opacity(0.25)],
	},
	"zoom-in": {
		id: "zoom-in",
		label: "Zoom in",
		tracks: [
			opacity(0.2),
			{
				property: "scale",
				keyframes: [
					{ t: 0, value: 0.55 },
					{ t: 0.5, value: 1, easing: "easeOutBack" },
				],
			},
		],
		// Premium default: a colored halo pulses behind the logo as it settles, the
		// brand name reveals word-by-word, then a light flare sweeps across it.
		glow: {
			color: "#7c83ff",
			keyframes: [
				{ t: 0.05, value: 0 },
				{ t: 0.45, value: 0.85, easing: "easeOut" },
				{ t: 0.75, value: 0.3 },
				{ t: 1, value: 0 },
			],
		},
		reveal: { target: "name", mode: "word", start: 0.22, durationFrac: 0.4 },
		shine: { target: "name", start: 0.72, durationFrac: 0.34, intensity: 0.55 },
	},
	"scale-pop": {
		id: "scale-pop",
		label: "Pop",
		tracks: [
			opacity(0.15),
			{
				property: "scale",
				keyframes: [
					{ t: 0, value: 0 },
					{ t: 0.45, value: 1.12, easing: "easeOutBack" },
					{ t: 0.6, value: 1, easing: "easeOut" },
				],
			},
		],
	},
	slide: {
		id: "slide",
		label: "Slide in",
		tracks: [
			opacity(0.2),
			{
				property: "x",
				keyframes: [
					{ t: 0, value: -0.7 },
					{ t: 0.5, value: 0, easing: "easeOutCubic" },
				],
			},
		],
	},
	"slide-up": {
		id: "slide-up",
		label: "Slide up",
		tracks: [
			opacity(0.2),
			{
				property: "y",
				keyframes: [
					{ t: 0, value: 0.5 },
					{ t: 0.5, value: 0, easing: "easeOutCubic" },
				],
			},
		],
	},
	rise: {
		id: "rise",
		label: "Rise",
		tracks: [
			opacity(0.35),
			{
				property: "y",
				keyframes: [
					{ t: 0, value: 0.18 },
					{ t: 0.6, value: 0, easing: "easeOut" },
				],
			},
		],
	},
	bounce: {
		id: "bounce",
		label: "Bounce",
		tracks: [
			opacity(0.15),
			{
				property: "y",
				keyframes: [
					{ t: 0, value: -0.6 },
					{ t: 0.6, value: 0, easing: "easeOutBounce" },
				],
			},
		],
	},
	"zoom-out": {
		id: "zoom-out",
		label: "Zoom out",
		tracks: [
			opacity(0.2),
			{
				property: "scale",
				keyframes: [
					{ t: 0, value: 1.6 },
					{ t: 0.5, value: 1, easing: "easeOutExpo" },
				],
			},
		],
	},
	"spin-in": {
		id: "spin-in",
		label: "Spin in",
		tracks: [
			opacity(0.2),
			{
				property: "rotate",
				keyframes: [
					{ t: 0, value: -160 },
					{ t: 0.55, value: 0, easing: "easeOutBack" },
				],
			},
			{
				property: "scale",
				keyframes: [
					{ t: 0, value: 0.4 },
					{ t: 0.55, value: 1, easing: "easeOut" },
				],
			},
		],
	},
	reveal: {
		id: "reveal",
		label: "Reveal",
		tracks: [
			opacity(0.3),
			{
				property: "scale",
				keyframes: [
					{ t: 0, value: 0.92 },
					{ t: 0.6, value: 1, easing: "easeOut" },
				],
			},
			{
				property: "blur",
				keyframes: [
					{ t: 0, value: 12 },
					{ t: 0.5, value: 0, easing: "easeOut" },
				],
			},
		],
	},
	glitch: {
		id: "glitch",
		label: "Glitch",
		tracks: [
			{
				property: "opacity",
				keyframes: [
					{ t: 0, value: 0 },
					{ t: 0.05, value: 1 },
					{ t: 0.1, value: 0.3 },
					{ t: 0.15, value: 1 },
					...FADE_OUT,
				],
			},
			{
				property: "x",
				keyframes: [
					{ t: 0, value: 0.04 },
					{ t: 0.06, value: -0.03 },
					{ t: 0.12, value: 0.02 },
					{ t: 0.2, value: 0, easing: "easeOut" },
				],
			},
		],
	},
	drop: {
		id: "drop",
		label: "Drop",
		tracks: [
			opacity(0.12),
			{
				property: "y",
				keyframes: [
					{ t: 0, value: -0.5 },
					{ t: 0.5, value: 0, easing: "easeOutBounce" },
				],
			},
			{
				property: "scale",
				keyframes: [
					{ t: 0, value: 1.1 },
					{ t: 0.55, value: 1, easing: "easeOut" },
				],
			},
		],
	},
};

export function getCardAnimation(id: IntroOutroPreset): AnimationSpec {
	return CARD_ANIMATIONS[id] ?? CARD_ANIMATIONS.fade;
}

/** {value,label} list for animation pickers, in declaration order. */
export const ANIMATION_OPTIONS: { value: IntroOutroPreset; label: string }[] =
	CARD_ANIMATION_IDS.map((id) => ({ value: id, label: CARD_ANIMATIONS[id].label }));

// ── Animation "language": validate + round-trip with any external AI ─────────

const EASINGS: Easing[] = [
	"linear",
	"easeIn",
	"easeOut",
	"easeInOut",
	"easeOutCubic",
	"easeOutBack",
	"easeOutExpo",
	"easeOutBounce",
];
const PROPS: AnimatableProperty[] = ["opacity", "scale", "x", "y", "rotate", "blur"];

function clampValue(p: AnimatableProperty, v: number): number {
	const ranges: Record<AnimatableProperty, [number, number]> = {
		opacity: [0, 1],
		scale: [0, 4],
		x: [-2, 2],
		y: [-2, 2],
		rotate: [-720, 720],
		blur: [0, 40],
	};
	const [min, max] = ranges[p];
	return Math.min(max, Math.max(min, v));
}

/**
 * Tolerant JSON-object parse for AI output: accepts an object, or a string that
 * may include markdown ```fences```, prose, or extra whitespace — extracts the
 * outermost {…} and parses it. Returns null if no valid object is found.
 */
function coerceJsonObject(raw: unknown): Record<string, unknown> | null {
	if (raw && typeof raw === "object") return raw as Record<string, unknown>;
	if (typeof raw !== "string") return null;
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	const normalized = raw
		.slice(start, end + 1)
		// Normalize smart quotes / non-breaking spaces that sneak in via copy-paste.
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/ /g, " ");
	const slice = collapseInStringWhitespace(normalized);
	try {
		const parsed = JSON.parse(slice);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function collapseInStringWhitespace(s: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	for (const ch of s) {
		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			out += ch;
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			out += ch;
			continue;
		}
		if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
			out += " ";
			continue;
		}
		out += ch;
	}
	return out;
}

/**
 * Validate + sanitize an animation spec (e.g. JSON pasted back from an AI).
 * Returns a clean AnimationSpec or null if it isn't usable. Lenient: drops bad
 * tracks/keyframes rather than rejecting the whole thing.
 */
function unit(v: unknown, fb: number): number {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fb;
}

function parseTracks(raw: unknown): AnimationTrack[] {
	if (!Array.isArray(raw)) return [];
	const tracks: AnimationTrack[] = [];
	for (const t of raw as unknown[]) {
		if (!t || typeof t !== "object") continue;
		const tr = t as { property?: unknown; keyframes?: unknown };
		const property = tr.property as AnimatableProperty;
		if (!PROPS.includes(property)) continue;
		const kfRaw = Array.isArray(tr.keyframes) ? (tr.keyframes as unknown[]) : [];
		const keyframes: Keyframe[] = kfRaw
			.map((k) => k as { t?: unknown; value?: unknown; easing?: unknown })
			.filter((k) => Number.isFinite(k.t as number) && Number.isFinite(k.value as number))
			.map((k) => ({
				t: Math.min(1, Math.max(0, k.t as number)),
				value: clampValue(property, k.value as number),
				easing: EASINGS.includes(k.easing as Easing) ? (k.easing as Easing) : undefined,
			}))
			.sort((a, b) => a.t - b.t);
		if (keyframes.length > 0) tracks.push({ property, keyframes });
	}
	return tracks;
}

function parseTextTarget(v: unknown): TextTarget {
	return v === "name" || v === "tagline" ? v : "both";
}

function parseReveal(raw: unknown): TextReveal | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	return {
		target: parseTextTarget(r.target),
		mode: r.mode === "char" ? "char" : "word",
		start: unit(r.start, 0),
		durationFrac: unit(r.durationFrac, 0.4),
	};
}

function parseShine(raw: unknown): Shine | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	return {
		target: parseTextTarget(r.target),
		start: unit(r.start, 0.3),
		durationFrac: unit(r.durationFrac, 0.4),
		intensity: unit(r.intensity, 0.7),
	};
}

function parseGlow(raw: unknown): GlowPulse | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const keyframes = parseTracks([{ property: "opacity", keyframes: r.keyframes }])[0]?.keyframes;
	if (!keyframes || keyframes.length === 0) return undefined;
	return { color: hexOr(r.color, "#6478ff"), keyframes };
}

export function normalizeAnimationSpec(raw: unknown): AnimationSpec | null {
	const obj = coerceJsonObject(raw);
	if (!obj) return null;
	const r = obj as Record<string, unknown>;

	const tracks = parseTracks(r.tracks);
	const elements: ElementTracks = {};
	if (r.elements && typeof r.elements === "object") {
		const er = r.elements as Record<string, unknown>;
		for (const key of ["logo", "name", "tagline"] as const) {
			const et = parseTracks(er[key]);
			if (et.length > 0) elements[key] = et;
		}
	}
	const hasElements = Object.keys(elements).length > 0;
	const reveal = parseReveal(r.reveal);
	const shine = parseShine(r.shine);
	const glow = parseGlow(r.glow);

	if (tracks.length === 0 && !hasElements && !reveal && !shine && !glow) return null;

	const spec: AnimationSpec = {
		id: "custom",
		label: typeof r.label === "string" && r.label.trim() ? r.label.slice(0, 40) : "Custom",
		tracks,
	};
	if (hasElements) spec.elements = elements;
	if (reveal) spec.reveal = reveal;
	if (shine) spec.shine = shine;
	if (glow) spec.glow = glow;
	return spec;
}

/** Shallow check used on project load (already-validated specs). */
export function isAnimationSpecLike(value: unknown): value is AnimationSpec {
	return (
		!!value &&
		typeof value === "object" &&
		Array.isArray((value as { tracks?: unknown }).tracks)
	);
}

/** The schema documentation an external AI needs to read + edit an animation. */
export const ANIMATION_LANGUAGE_DOC = `You are editing a GlitchGrab intro/outro card animation.

An animation is a JSON object: { "label": string, "tracks": Track[] }.
A Track animates ONE property over the card's lifetime: { "property": Property, "keyframes": Keyframe[] }.
A Keyframe: { "t": 0..1, "value": number, "easing"?: Easing } where t is normalized time (0 = card start, 1 = card end) and easing applies on the segment leading INTO this keyframe.

Property (resting/identity state in parentheses):
- "opacity" (1): 0..1
- "scale" (1): multiplier, 1 = natural size
- "x" (0): horizontal offset as a FRACTION of frame width (-1 = one full frame left, off-screen)
- "y" (0): vertical offset as a FRACTION of frame height (-1 = one frame up)
- "rotate" (0): degrees
- "blur" (0): pixels

Easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "easeOutCubic" | "easeOutBack" | "easeOutExpo" | "easeOutBounce".

Rules:
- Always end with the card fully visible then fading out near t=1 (e.g. opacity keyframes [{t:0,value:0},{t:0.2,value:1},{t:0.85,value:1},{t:1,value:0}]) unless told otherwise.
- Only include tracks you actually animate; omitted properties stay at their resting value.
- Keep it smooth and tasteful for a brand logo card.
- Return ONLY the JSON object, no prose, no markdown fences.`;

/** Build the full prompt for the user to paste into any AI. */
export function buildAnimationPrompt(spec: AnimationSpec, audio?: AudioAnalysis | null): string {
	let audioBlock = "";
	if (audio && audio.points.length > 0) {
		const envelope = audio.points.map((p) => `${p.t}:${p.level}`).join("  ");
		const beats = audio.beats.length ? audio.beats.join(", ") : "none detected";
		audioBlock = `

The card has background music (${audio.durationSec}s). Its loudness over the card timeline
(format t:level, t=0..1 normalized to the card, level=0..1 peak-normalized):
${envelope}
Energy peaks (good moments to emphasize / hit) at t: ${beats}

Design the animation so the logo's motion EMPHASIZES the louder moments and lands accents on
the energy peaks (e.g. a scale bump or settle on each peak, build with the swell). Keep it tasteful.`;
	}

	return `${ANIMATION_LANGUAGE_DOC}

Here is the current animation:
${JSON.stringify({ label: spec.label, tracks: spec.tracks }, null, 2)}${audioBlock}

Now apply this change: <describe what you want, e.g. "make the logo bounce in harder and spin slightly"${audio ? '; or just "sync the logo motion to the music"' : ""}>

Return the full updated JSON object only.`;
}

// ── Full card design round-trip (background + text + layout + animation) ─────

function clampNum(v: unknown, min: number, max: number, fb: number): number {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
}
function hexOr(v: unknown, fb: string): string {
	return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim())
		? `#${v.trim().replace(/^#/, "").toLowerCase()}`
		: fb;
}

/** The complete, JSON-editable card design (everything the AI can change). */
export interface CardDesign {
	background: CardBackground;
	text: CardText;
	layout: CardLayout;
	logoContainer: LogoContainerStyle;
	/** Panel padding around the logo (0.05–0.5 of logo height). */
	logoPadding: number;
	size: number;
	position: IntroOutroPosition;
	/** Card length in milliseconds (500–8000). */
	durationMs: number;
	animation: Omit<AnimationSpec, "id">;
}

/** Snapshot the current side as an editable design object. */
export function sideToDesign(side: IntroOutroSideConfig): CardDesign {
	const anim = side.customAnimation ?? getCardAnimation(side.preset);
	const animation: Omit<AnimationSpec, "id"> = { label: anim.label, tracks: anim.tracks };
	if (anim.elements) animation.elements = anim.elements;
	if (anim.reveal) animation.reveal = anim.reveal;
	if (anim.shine) animation.shine = anim.shine;
	if (anim.glow) animation.glow = anim.glow;
	return {
		background: side.background,
		text: side.text,
		layout: side.layout,
		logoContainer: side.logoContainer,
		logoPadding: side.logoPadding,
		size: side.size,
		position: side.position,
		durationMs: side.durationMs,
		animation,
	};
}

/** Validate a pasted design → a Partial side patch (or null if unusable). */
export function normalizeCardDesign(raw: unknown): Partial<IntroOutroSideConfig> | null {
	const r = coerceJsonObject(raw);
	if (!r) return null;
	const patch: Partial<IntroOutroSideConfig> = {};

	if (r.background && typeof r.background === "object") {
		const b = r.background as Partial<CardBackground>;
		patch.background = {
			type:
				b.type === "solid" || b.type === "gradient" ? b.type : DEFAULT_CARD_BACKGROUND.type,
			color1: hexOr(b.color1, DEFAULT_CARD_BACKGROUND.color1),
			color2: hexOr(b.color2, DEFAULT_CARD_BACKGROUND.color2),
			angle: clampNum(b.angle, 0, 360, DEFAULT_CARD_BACKGROUND.angle),
			glow: clampNum(b.glow, 0, 1, DEFAULT_CARD_BACKGROUND.glow),
			vignette: clampNum(b.vignette, 0, 1, DEFAULT_CARD_BACKGROUND.vignette),
		};
	}
	if (r.text && typeof r.text === "object") {
		const tx = r.text as Partial<CardText>;
		const collapse = (v: unknown) =>
			typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 120) : "";
		patch.text = {
			brandName: collapse(tx.brandName),
			tagline: collapse(tx.tagline),
			color: hexOr(tx.color, DEFAULT_CARD_TEXT.color),
		};
	}
	if (CARD_LAYOUTS.includes(r.layout as CardLayout)) patch.layout = r.layout as CardLayout;
	if (LOGO_CONTAINER_STYLES.includes(r.logoContainer as LogoContainerStyle)) {
		patch.logoContainer = r.logoContainer as LogoContainerStyle;
	}
	if (Number.isFinite(r.logoPadding)) {
		patch.logoPadding = clampNum(r.logoPadding, 0.05, 0.5, 0.1);
	}
	if (INTRO_OUTRO_POSITIONS.includes(r.position as IntroOutroPosition)) {
		patch.position = r.position as IntroOutroPosition;
	}
	if (Number.isFinite(r.size)) {
		patch.size = clampNum(r.size, INTRO_OUTRO_MIN_SIZE, INTRO_OUTRO_MAX_SIZE, 0.25);
	}
	if (Number.isFinite(r.durationMs)) {
		patch.durationMs = clampNum(
			r.durationMs,
			INTRO_OUTRO_MIN_DURATION_MS,
			INTRO_OUTRO_MAX_DURATION_MS,
			2000,
		);
	}
	const anim = normalizeAnimationSpec(r.animation);
	if (anim) patch.customAnimation = anim;

	return Object.keys(patch).length > 0 ? patch : null;
}

const CARD_DESIGN_DOC = `You are designing ONE GlitchGrab intro/outro brand card. This is a data task, NOT a coding task.

OUTPUT CONTRACT (read first):
- Return EXACTLY ONE JSON "design" object and NOTHING else — no prose, no explanation, no markdown fences.
- Do NOT build a tool, app, widget, UI, component, or script. Do NOT write code. Do NOT call any API.
- Just emit the updated design JSON. That single object is consumed directly by the renderer.

HOW IT RENDERS (so your numbers actually look right):
- The card fills the whole video frame (16:9 landscape). Everything is drawn on one flat frame.
- Background = a linear gradient (color1→color2 along "angle") + a soft radial GLOW bloom + an edge VIGNETTE. The glow hue is derived automatically from your gradient — you do NOT set a background glow color, only its strength 0..1.
- Text is ONE line and never wraps; the whole card auto-scales to fit, so SHORTER copy renders BIGGER (see TYPOGRAPHY).
- "size" is the logo height as a fraction of frame height; per-layout ranges are in LOGO GEOMETRY below.
- The logo's pixels are FIXED (it's the user's real logo) — you control its size, container, and motion, never its colors.

SCHEMA — return this shape:
{
  "background": { "type": "gradient"|"solid", "color1": "#hex", "color2": "#hex", "angle": 0..360, "glow": 0..1, "vignette": 0..1 },
  "text": { "brandName": string, "tagline": string, "color": "#hex" },
  "layout": "logo-top"|"logo-left"|"logo-only"|"text-only",
  "logoContainer": "panel"|"rounded"|"none",   // panel = white rounded plate behind the logo
  "logoPadding": 0.05..0.5,                      // padding inside the panel (fraction of logo height)
  "size": 0.1..0.8,                              // logo height as a fraction of frame height
  "position": "center"|"top"|"bottom"|"left"|"right",
  "durationMs": 500..8000,                        // total card length; match the music if given
  "animation": {
    "label": string,
    "tracks": Track[],                              // group motion (whole card moves together)
    "elements": { "logo": Track[], "name": Track[], "tagline": Track[] },  // OPTIONAL per-element motion
    "reveal": { "target": "name"|"tagline"|"both", "mode": "word"|"char", "start": 0..1, "durationFrac": 0..1 },  // staggered text reveal
    "shine": { "target": "name"|"tagline"|"both", "start": 0..1, "durationFrac": 0..1, "intensity": 0..1 },        // light sweep across text
    "glow": { "color": "#hex", "keyframes": Keyframe[] }                                                          // colored HALO behind the logo (this one IS colored; value 0..1 over t)
  }
}
A Track animates ONE property: { "property": Property, "keyframes": [{ "t": 0..1, "value": number, "easing"?: Easing }] }.
t is normalized time (0 = card start, 1 = card end); easing applies INTO the keyframe.
Property (resting value): "opacity"(1) 0..1 | "scale"(1) multiplier | "x"(0)/"y"(0) offset as FRACTION of frame | "rotate"(0) deg | "blur"(0) px.
Easing (use ONLY these): linear | easeIn | easeOut | easeInOut | easeOutCubic | easeOutBack | easeOutExpo | easeOutBounce.

LOGO GEOMETRY — size, padding & spacing (this is where cards look cheap):
SIZE (logo height / frame height) — pick by layout, not one value:
- logo-only: 0.34–0.46 (no text, let the logo own the frame).
- logo-top: 0.24–0.30 (logo sits ABOVE the name; bigger collides with the text below).
- logo-left: 0.26–0.34 (logo beside the text, a touch larger is fine).
- text-only: size is ignored (no logo drawn).
Above ~0.5 always looks oversized.
PADDING — logoPadding ONLY does something when logoContainer is "panel".
- With "none" or "rounded", logoPadding is IGNORED — the logo box hugs the logo and the only space before the text is the fixed layout gap. If a busy/edge-bleeding logo needs breathing room, you MUST use "panel".
- For "panel": padding = logoPadding × logoHeight, added on all sides as the white plate. Use 0.12–0.20 for a premium, un-cramped plate. 0.08 is tight; below 0.06 the logo touches the plate edge.
SPACING (logo ↔ name) — the gap is proportional to the logo (you cannot set it directly). If the logo feels like it touches the name, the fix is: use "panel" and raise logoPadding toward 0.18, and/or drop size one notch.

BRAND-AWARE REASONING — do this silently, emit NO reasoning (only the JSON):
1. Read the brand from up to three signals (brandName meaning, tagline meaning, logo dominant color — any may be empty). Name ONE mood word in your head: calm, trustworthy, energetic, premium-dark, playful, clinical, earthy, luxurious.
2. The mood picks your PALETTE (deck below) and MOTION character: calm/trustworthy → slow gentle easeOut, longer durationMs (2600–3400); energetic/playful → faster springy easeOutBack, shorter durationMs; premium → slow confident build then a clean hold.
3. Write the mood into "animation.label" (≤40 chars, e.g. "Calm trust — deep teal"). That is the ONLY place your reasoning surfaces.
Two different brands MUST produce two visibly different palettes and motion feels.

PALETTE DECK — pick by mood, do NOT default to indigo (color1→color2 / text.color / glow.color / mood):
- INDIGO NIGHT  #0b1020→#312e81 / #ffffff / #7c83ff  (techy)
- VIOLET SMOKE  #15101f→#6d28d9 / #f5f3ff / #a78bfa  (creative)
- FOREST DEEP   #07140f→#047857 / #ecfdf5 / #34d399  (calm)
- SLATE TEAL    #0a1416→#0e7490 / #ecfeff / #22d3ee  (clean SaaS)
- OXBLOOD       #1a0a0f→#9f1239 / #fff1f2 / #fb7185  (bold)
- WARM SAND     #fff7ed→#fed7aa / #7c2d12 / #fb923c  (friendly light)
- IVORY MONO    #fafafa→#e5e7eb / #111827 / #6b7280  (minimal light)
- CARBON        #000000→#1f2937 / #f9fafb / #9ca3af  (luxury)
BACKGROUND STYLE — DEFAULT TO RESTRAINT (this is what actually reads professional):
- SOLID is often MORE professional than a gradient. Any deck palette works flat: set "type":"solid" and color1 = the DARKER tone (color2 is ignored for solids). ALTERNATE solid and gradient across cards — do NOT reflexively pick gradient; a clean flat color + good type + one accent is the most premium look.
- When you DO use a gradient, keep it SUBTLE: color1 and color2 in the SAME tone family with a small brightness delta. AVOID the amateur "dark corner → bright corner" diagonal blast (a near-black color1 to a saturated color2 is exactly the cheap look to avoid).
- Keep effects QUIET: glow ≤0.2, vignette ≤0.26. A heavy vignette is a cheap spotlight, not professional. Less is more.
Pairing rules: text.color contrasts the background; glow.color is the LOGO halo — use the accent hex, never the dark base. LIGHT palettes (WARM SAND, IVORY) set background.glow ≤0.12 and vignette ≤0.16; DARK palettes set glow 0.12–0.22, vignette 0.18–0.28. The background glow HUE is auto-derived from the background — you only set its STRENGTH.
Logo routing: pick a palette whose color2 differs from the logo in BOTH hue and brightness. Dark/near-black logo on a dark palette → set logoContainer "panel" (plate is white, so it only adds contrast over DARK/MEDIUM backgrounds, not light ones). Bright logo → a dark palette frames it best; tint glow.color toward the logo. Do NOT default to INDIGO NIGHT — rotate by mood.

ANTI-GENERIC — DO NOT SHIP THE DEFAULT LOOK:
The "Current design" shown below is a STALE placeholder (navy→indigo, logo-top, white panel, centered). It is NOT a template — move AWAY from it unless the brand genuinely calls for it. Treat every field as a fresh decision.
- BANNED unless the brand justifies it: a reflexive navy→indigo / tech-blue gradient. Pick a deck palette that fits THIS brand.
- Do NOT reflexively reach for "gradient". Roughly half of professional cards are SOLID flat backgrounds — actively consider solid first, then gradient only if a subtle one adds depth.
- Do NOT default angle to 135. Choose direction deliberately (a near-vertical 100–120 or flat 90 often reads calmer/more premium).
- Do NOT auto-pick {layout:"logo-top", position:"center", logoContainer:"panel"}. Vary at least ONE.
- Use "panel" only when the logo does NOT already contrast the background; a floating "none" logo reads more premium when contrast already holds.
COMPOSITION — choose placement on purpose (position anchors the group to a 15% margin on one axis, centering the other; the empty side becomes intentional negative space):
- centered stack (logo-top + center): classic/corporate or long copy.
- centered lockup (logo-left + center): short name + tagline, editorial.
- left/right anchor (position left/right): modern asymmetric — ONLY with compact copy (brandName ≤~12 chars, short/no tagline) and size 0.24–0.32.
- upper/lower third (position top/bottom): title-card / cinematic feel.
- icon hero (logo-only + center, size 0.4–0.55, no text): iconic logos.
Vary intro vs outro composition so the pair feels designed, not duplicated.

TYPOGRAPHY — the brand NAME and TAGLINE wording ARE the typography:
- The renderer FIXES type (size, weight, tight tracking, font). The ONLY type levers you hold are the two STRINGS and whether the tagline exists.
- BREVITY IS PREMIUM. Text is one line and never wraps; the card auto-scales to fit, so SHORTER copy renders BIGGER and bolder. Target brandName ≤~14 chars, tagline ≤~32 chars (hard cap 42). Never pad to fill space — that shrinks everything.
- CASING: keep the brand's NATURAL casing for brandName (do NOT ALL-CAPS a wordmark). Tagline in Title or sentence case; ALL CAPS only for a ≤2-word label.
- DROP THE TAGLINE when it is not earning its place. A tagline must be a real value-prop ("Ship faster", "Bug reports, automated"), NEVER a greeting/filler ("Welcome", "Our Brand"). If you cannot write a good ≤32-char tagline, set "tagline": "" and let the name stand alone.
- Keep the user's existing copy unless asked to change it OR the existing tagline is filler/over-long.

MOTION CHOREOGRAPHY — premium motion is layered & staggered in 5 phases (fill the skeleton, do not clone a JSON):
1. SETTLE — group + logo enter (t≈0–0.35, easeOut*); the logo arrives just BEFORE the name.
2. REVEAL — name builds (reveal.start ≈0.22–0.30, durationFrac ≈0.34–0.42), overlapping phase 1.
3. ACCENT — shine on the name (shine.start ≥ reveal.start + reveal.durationFrac) and/or a glow peak (0.7–0.9). Land it on the music hit if one is given.
4. HOLD — no new motion ≈0.62–0.82; a premium card holds the finished lockup still.
5. EXIT — group opacity 1→0 easeIn ≈0.82–1.0.
Rules: phases overlap ~30–40%; entrances eased, NEVER linear; reserve ONE overshoot (easeOutBack) element max; VARY the lead element and jitter the t-windows ±0.05 so no two cards time alike. Use 2–3 layers minimum, not a single fade.

TASTE RUBRIC:
- CONTRAST IS MANDATORY. The logo and text must clearly stand out. Never put the logo on a background of its own color family — if the logo is dark/busy or close to the background, use logoContainer "panel".
- Subtle, brand-appropriate palettes + a little glow/vignette = professional. Avoid harsh neon or muddy low-contrast pairings.
- Motion ends fully visible, then fades near t=1. t=0..1 spans the WHOLE durationMs.

SELF-CHECK BEFORE YOU ANSWER (do this silently — never write it out). Grade your draft, FIX every fail, then output ONLY the JSON:
[ ] NOT the default (not navy→indigo, not reflexive logo-top/center/panel, not size 0.25).
[ ] Did I consider SOLID? Not a reflexive gradient. If gradient, it's SUBTLE (same tone family), not a dark→bright diagonal. glow ≤0.2, vignette ≤0.26.
[ ] Real contrast: logo color family differs from background in hue AND brightness; dark/busy logo over a dark bg → "panel".
[ ] Copy fits (brandName ≤~18, tagline ≤~42) so the card does not auto-shrink.
[ ] Logo does not crowd the name: sensible per-layout size + (on a panel) logoPadding ≥0.12.
[ ] 2–3 staggered motion layers, not all firing at t=0; shine after the name forms.
[ ] If a music block was given: durationMs matches, biggest accent on the named hit.
[ ] Ends fully visible, fades near t=1.

WORKED EXAMPLES — these span the range ON PURPOSE (industries, moods, light/dark, layouts, containers, positions). Pick the cell that fits the brand, then vary WITHIN it. Do NOT default to dark-indigo + white-panel + logo-top — that is ONE option of five, not "the premium look". Match this depth; never copy verbatim.
Example A — FINTECH, dark authority, solid near-black, rounded logo, char reveal:
{ "background": { "type": "solid", "color1": "#0a0a0c", "color2": "#0a0a0c", "angle": 90, "glow": 0.16, "vignette": 0.24 }, "text": { "brandName": "Vault", "tagline": "Banking, reimagined", "color": "#f5f5f4" }, "layout": "logo-top", "logoContainer": "rounded", "logoPadding": 0.1, "size": 0.3, "position": "center", "durationMs": 2600, "animation": { "label": "Vault rise", "tracks": [ { "property": "opacity", "keyframes": [ {"t":0,"value":0}, {"t":0.16,"value":1,"easing":"easeOut"}, {"t":0.84,"value":1}, {"t":1,"value":0,"easing":"easeIn"} ] } ], "elements": { "logo": [ { "property": "y", "keyframes": [ {"t":0,"value":0.05}, {"t":0.5,"value":0,"easing":"easeOutCubic"} ] }, { "property": "scale", "keyframes": [ {"t":0,"value":0.9}, {"t":0.5,"value":1,"easing":"easeOut"} ] } ] }, "reveal": { "target": "name", "mode": "char", "start": 0.3, "durationFrac": 0.42 }, "shine": { "target": "name", "start": 0.74, "durationFrac": 0.28, "intensity": 0.45 }, "glow": { "color": "#3b82f6", "keyframes": [ {"t":0.1,"value":0}, {"t":0.5,"value":0.55,"easing":"easeOut"}, {"t":1,"value":0} ] } } }
Example B — ECO/WELLNESS, soft daylight, no container, logo-left, tagline reveal:
{ "background": { "type": "gradient", "color1": "#ecfdf5", "color2": "#a7f3d0", "angle": 110, "glow": 0, "vignette": 0.16 }, "text": { "brandName": "Fern", "tagline": "Grow naturally", "color": "#14532d" }, "layout": "logo-left", "logoContainer": "none", "logoPadding": 0.1, "size": 0.32, "position": "center", "durationMs": 2400, "animation": { "label": "Fern unfurl", "tracks": [ { "property": "opacity", "keyframes": [ {"t":0,"value":0}, {"t":0.2,"value":1,"easing":"easeOut"}, {"t":0.85,"value":1}, {"t":1,"value":0,"easing":"easeIn"} ] } ], "elements": { "logo": [ { "property": "x", "keyframes": [ {"t":0,"value":-0.1}, {"t":0.5,"value":0,"easing":"easeOutCubic"} ] } ], "name": [ { "property": "x", "keyframes": [ {"t":0,"value":0.06}, {"t":0.55,"value":0,"easing":"easeOutCubic"} ] } ] }, "reveal": { "target": "tagline", "mode": "word", "start": 0.42, "durationFrac": 0.4 } } }
Example C — LUXURY/FASHION, editorial, type-led, text-only, bottom-anchored:
{ "background": { "type": "gradient", "color1": "#1c1917", "color2": "#44403c", "angle": 135, "glow": 0.08, "vignette": 0.26 }, "text": { "brandName": "Atelier", "tagline": "Crafted in silence", "color": "#e7e5e4" }, "layout": "text-only", "logoContainer": "none", "logoPadding": 0.1, "size": 0.24, "position": "bottom", "durationMs": 3000, "animation": { "label": "Editorial fade", "tracks": [ { "property": "opacity", "keyframes": [ {"t":0,"value":0}, {"t":0.25,"value":1,"easing":"easeOut"}, {"t":0.8,"value":1}, {"t":1,"value":0,"easing":"easeIn"} ] }, { "property": "y", "keyframes": [ {"t":0,"value":0.03}, {"t":0.5,"value":0,"easing":"easeOut"} ] } ], "reveal": { "target": "name", "mode": "char", "start": 0.2, "durationFrac": 0.5 }, "shine": { "target": "name", "start": 0.74, "durationFrac": 0.24, "intensity": 0.4 } } }
Example D — PLAYFUL CONSUMER APP, vivid coral→magenta, white panel, pop entrance, top-anchored:
{ "background": { "type": "gradient", "color1": "#fb7185", "color2": "#c026d3", "angle": 60, "glow": 0.3, "vignette": 0.2 }, "text": { "brandName": "Pop", "tagline": "Make it yours", "color": "#ffffff" }, "layout": "logo-top", "logoContainer": "panel", "logoPadding": 0.18, "size": 0.28, "position": "top", "durationMs": 2200, "animation": { "label": "Pop bounce", "tracks": [ { "property": "opacity", "keyframes": [ {"t":0,"value":0}, {"t":0.12,"value":1,"easing":"easeOut"}, {"t":0.85,"value":1}, {"t":1,"value":0,"easing":"easeIn"} ] } ], "elements": { "logo": [ { "property": "scale", "keyframes": [ {"t":0,"value":0}, {"t":0.45,"value":1.12,"easing":"easeOutBack"}, {"t":0.6,"value":1,"easing":"easeOut"} ] } ] }, "reveal": { "target": "name", "mode": "word", "start": 0.4, "durationFrac": 0.3 }, "shine": { "target": "name", "start": 0.72, "durationFrac": 0.3, "intensity": 0.6 }, "glow": { "color": "#f472b6", "keyframes": [ {"t":0.1,"value":0}, {"t":0.5,"value":0.8,"easing":"easeOut"}, {"t":0.78,"value":0.3}, {"t":1,"value":0} ] } } }
Example E — DEV TOOL / B2B SAAS, logo hero only, NO text, teal-on-slate, spin-settle:
{ "background": { "type": "gradient", "color1": "#0f172a", "color2": "#155e63", "angle": 150, "glow": 0.18, "vignette": 0.24 }, "text": { "brandName": "Forge", "tagline": "", "color": "#ccfbf1" }, "layout": "logo-only", "logoContainer": "rounded", "logoPadding": 0.1, "size": 0.34, "position": "center", "durationMs": 2000, "animation": { "label": "Forge settle", "tracks": [ { "property": "opacity", "keyframes": [ {"t":0,"value":0}, {"t":0.18,"value":1,"easing":"easeOut"}, {"t":0.82,"value":1}, {"t":1,"value":0,"easing":"easeIn"} ] } ], "elements": { "logo": [ { "property": "rotate", "keyframes": [ {"t":0,"value":-90}, {"t":0.55,"value":0,"easing":"easeOutBack"} ] }, { "property": "scale", "keyframes": [ {"t":0,"value":0.5}, {"t":0.55,"value":1,"easing":"easeOut"} ] } ] }, "glow": { "color": "#2dd4bf", "keyframes": [ {"t":0.1,"value":0}, {"t":0.5,"value":0.7,"easing":"easeOut"}, {"t":1,"value":0} ] } } }

Now output the updated design as ONE JSON object only — no prose, no code, no fences.`;

/** Full prompt: the entire card design (not just animation) for any AI. */
export function buildCardDesignPrompt(
	side: IntroOutroSideConfig,
	audio?: AudioAnalysis | null,
	logoColor?: string | null,
): string {
	const logoBlock = logoColor
		? `\n\nThe logo's dominant color is ${logoColor}.
CRITICAL — the logo MUST be clearly visible. Do NOT put it on a background of the same color family (a ${logoColor} logo on a dark-${logoColor} background disappears).
- Pick a background that strongly CONTRASTS the logo in brightness AND hue.
- If the logo is dark or close to your background, EITHER use a light/neutral background OR set "logoContainer": "panel" (a white plate behind the logo so it pops).
- You may tint the GLOW near ${logoColor} for cohesion, but keep the background contrasting.
- The panel plate is WHITE, so it only adds contrast over a DARK or medium background — over a light background use "none" or "rounded" instead.`
		: "";
	let audioBlock = "";
	if (audio && audio.points.length > 0) {
		const envelope = audio.points.map((p) => `${p.t}:${p.level}`).join("  ");
		const beats = audio.beats.length ? audio.beats.join(", ") : "none detected";
		const longer = audio.fullDurationSec > side.durationMs / 1000 + 0.05;
		const lvl = (v: number) => (v < 0.2 ? "very quiet" : v < 0.5 ? "soft" : v < 0.8 ? "loud" : "peak");
		audioBlock = `

═══ MUSIC SYNC — make the motion feel scored to this track ═══
Background music: ${audio.fullDurationSec}s long; the card is currently ${(side.durationMs / 1000).toFixed(1)}s.${
			longer
				? ` ⚠ The music is LONGER than the card — set "durationMs": ${audio.recommendedDurationMs} so the animation spans the whole track (all t values below are normalized over that ${audio.durationSec}s window).`
				: ""
		}
Energy shape: ${audio.shape.toUpperCase()} — ${audio.summary}.

KEY MOMENTS (t = 0 is card start, 1 is card end):
- Intro (t≈0): ${lvl(audio.startLevel)} (level ${audio.startLevel}). ${audio.startLevel < 0.3 ? "Ease in gently here — don't slam the logo in on silence." : "There's energy right away — you can enter with confidence."}
- THE HIT (biggest sudden jump) at t=${audio.hitT} — this is the strongest accent point. Land a logo scale-pop / glow-pulse peak / shine sweep right here.
- LOUDEST moment at t=${audio.loudestT} — put the visual climax here (peak glow, settle, brightest shine) if it differs from the hit.
- Quietest at t=${audio.quietestT} — keep motion calm here.
- Outro (t≈1): ${lvl(audio.endLevel)} (level ${audio.endLevel}). ${audio.endLevel < 0.3 ? "The track fades — fade the card out with it." : "Still energetic at the end — a confident hold then a clean fade reads best."}
- Secondary accent peaks at t: ${beats}.

Full loudness curve (t:level, both 0..1): ${envelope}

HOW TO MAP IT (do all of these):
1. Set durationMs to the music length so the timeline lines up.
2. Quiet stretches → minimal motion (low opacity/scale). Rising energy → build the entrance into it.
3. Put your biggest accent (logo scale bump + glow keyframe at its highest value + shine.start) ON t=${audio.hitT}; align glow.keyframes peaks to the accent times above.
4. Match the ending: fade with the music if it fades, hold-then-cut if it stays loud.`;
	}
	return `${CARD_DESIGN_DOC}

Current design (STALE — this is the generic default to move AWAY from, NOT a template to echo):
${JSON.stringify(sideToDesign(side), null, 2)}${logoBlock}${audioBlock}

Now apply this change: <describe what you want, e.g. "make it feel premium and cinematic with a deep blue gradient and a confident logo entrance"${audio ? '; or "design it around the music"' : ""}>

Reply with the full updated design as ONE raw JSON object and nothing else — no tool, no widget, no code, no commentary, no markdown fences.`;
}
