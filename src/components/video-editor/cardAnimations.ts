import { CARD_ANIMATION_IDS, type IntroOutroPreset } from "./introOutroTypes";

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

export interface AnimationSpec {
	id: IntroOutroPreset;
	label: string;
	tracks: AnimationTrack[];
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
			let u = x;
			if (u < 1 / d1) return n1 * u * u;
			if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
			if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
			return n1 * (u -= 2.625 / d1) * u + 0.984375;
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

/** Resolve all tracks of a spec at normalized time t into a transform. */
export function resolveAnimation(spec: AnimationSpec | undefined, t: number): ResolvedAnimation {
	if (!spec) return { ...IDENTITY };
	const out: ResolvedAnimation = { ...IDENTITY };
	for (const track of spec.tracks) {
		out[track.property] = sampleTrack(track, t);
	}
	return out;
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
					{ t: 0, value: 0.3 },
					{ t: 0.55, value: 1, easing: "easeOutBack" },
				],
			},
		],
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
