export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ZoomFocus {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export type ZoomMode = "auto" | "manual";

export interface ZoomRegion {
	id: string;
	startMs: number;
	endMs: number;
	depth: ZoomDepth;
	focus: ZoomFocus;
	mode?: ZoomMode;
}

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	pressure?: number;
	interactionType?:
		| "move"
		| "click"
		| "double-click"
		| "right-click"
		| "middle-click"
		| "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

export interface CursorVisualSettings {
	size: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	clickBounceDuration: number;
	clickEffect: CursorClickEffectStyle;
	clickEffectColor: string;
	clickEffectScale: number;
	clickEffectOpacity: number;
	clickEffectDurationMs: number;
	sway: number;
	style: CursorStyle;
}

export type CursorStyle = "macos" | "tahoe" | "tahoe-inverted" | "dot" | "figma" | (string & {}); // extension-contributed cursor styles
export const DEFAULT_CURSOR_STYLE: CursorStyle = "tahoe";

export type CursorClickEffectStyle = "none" | "spotlight" | "ripple" | "echo";
export const DEFAULT_CURSOR_CLICK_EFFECT: CursorClickEffectStyle = "none";
export const DEFAULT_CURSOR_CLICK_EFFECT_COLOR = "#2563EB";
export const DEFAULT_CURSOR_CLICK_EFFECT_SCALE = 1;
export const DEFAULT_CURSOR_CLICK_EFFECT_OPACITY = 1;
export const DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS = 600;

export function normalizeCursorClickEffectStyle(
	value: unknown,
	fallback: CursorClickEffectStyle = DEFAULT_CURSOR_CLICK_EFFECT,
): CursorClickEffectStyle {
	if (value === "burst") {
		return "echo";
	}

	return value === "none" || value === "spotlight" || value === "ripple" || value === "echo"
		? value
		: fallback;
}

export function normalizeCursorClickEffectColor(
	value: unknown,
	fallback: string = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
): string {
	if (typeof value !== "string") {
		return fallback;
	}

	const trimmed = value.trim();
	if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
		return fallback;
	}

	if (trimmed.length === 4) {
		const [red, green, blue] = trimmed.slice(1).split("");
		return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
	}

	return trimmed.toUpperCase();
}

export type EditorEffectSection =
	| "scene"
	| "cursor"
	| "captions"
	| "webcam"
	| "settings"
	| "zoom"
	| "frame"
	| "crop"
	| "extensions"
	| "clip"
	| "audio"
	| "glitchgrab"
	| "avatar"
	| `ext:${string}`;

export type ZoomTransitionEasing = "glitchrecord" | "glide" | "smooth" | "snappy" | "linear";

export type WebcamCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WebcamPositionPreset =
	| WebcamCorner
	| "top-center"
	| "center-left"
	| "center"
	| "center-right"
	| "bottom-center"
	| "custom";

export interface WebcamOverlaySettings {
	enabled: boolean;
	sourcePath: string | null;
	timeOffsetMs: number;
	mirror: boolean;
	cropRegion: CropRegion;
	corner: WebcamCorner;
	positionPreset: WebcamPositionPreset;
	positionX: number;
	positionY: number;
	size: number;
	reactToZoom: boolean;
	cornerRadius: number;
	shadow: number;
	margin: number;
}

// AI talking-head avatar overlay (HeyGen). A generated clip shown as a PiP over
// the recording; lip-syncs the narration. Modeled on the webcam overlay.
export interface AvatarOverlaySettings {
	enabled: boolean;
	/** Local path to the generated avatar clip (mp4/webm). */
	sourcePath: string | null;
	/** Look/preview thumbnail (HeyGen URL) — shown before a clip exists. */
	previewUrl: string | null;
	positionPreset: WebcamPositionPreset;
	/** Free-drag position (0–1 of the available area). Used when preset is "custom". */
	positionX: number;
	positionY: number;
	/** Overlay size as % of the stage's shorter side. */
	size: number;
	/** "box" = rounded rectangle; "circle" = round cutout. */
	shape: "box" | "circle";
	/** Framing of the source inside the box (object-position %, 0=top/left). */
	framingX: number;
	framingY: number;
	margin: number;
	/**
	 * Avatar clip audio muted? Default true — the clip's baked-in voice stays silent
	 * and the timeline narration track carries the audio (lips rate-nudged to match).
	 * When false, the avatar plays its OWN synced voice (no rate-nudge) and the
	 * narration track is auto-muted in preview to avoid a double-voice echo.
	 */
	muted: boolean;
}

export const DEFAULT_AVATAR_OVERLAY: AvatarOverlaySettings = {
	enabled: false,
	sourcePath: null,
	previewUrl: null,
	positionPreset: "bottom-right",
	positionX: 1,
	positionY: 1,
	size: 26,
	shape: "box",
	framingX: 50,
	framingY: 22,
	margin: 24,
	muted: true,
};

// A "spotlight" window where the avatar animates from its corner PiP to full-frame
// (covering the recording) and back. Cloned from the ZoomRegion idea.
export interface AvatarRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export const DEFAULT_CURSOR_SIZE = 3.0;
export const DEFAULT_CURSOR_SMOOTHING = 0.67;
export const DEFAULT_CURSOR_MOTION_BLUR = 0.4;
export const DEFAULT_CURSOR_CLICK_BOUNCE = 2.5;
export const DEFAULT_CURSOR_CLICK_BOUNCE_DURATION = 350;
export const DEFAULT_CURSOR_SWAY = 0.4;
export const DEFAULT_ZOOM_SMOOTHNESS = 0.5;
export const DEFAULT_ZOOM_MOTION_BLUR = 0.35;
export interface ZoomMotionBlurTuning {
	panVelocityThreshold: number;
	zoomVelocityThreshold: number;
	maxDirectionalBlurPx: number;
	maxRadialBlurStrength: number;
	panResponsePerSecond: number;
	zoomResponsePerSecond: number;
	zoomSafeZoneRadiusPx: number;
}

export const DEFAULT_ZOOM_MOTION_BLUR_TUNING: ZoomMotionBlurTuning = {
	panVelocityThreshold: 0,
	zoomVelocityThreshold: 0,
	maxDirectionalBlurPx: 41.8,
	maxRadialBlurStrength: 1,
	panResponsePerSecond: 11,
	zoomResponsePerSecond: 9,
	zoomSafeZoneRadiusPx: 6,
};
export const DEFAULT_ZOOM_IN_DURATION_MS = 1522.575;
export const DEFAULT_ZOOM_IN_OVERLAP_MS = 500;
export const DEFAULT_ZOOM_OUT_DURATION_MS = 1015.05;
export const DEFAULT_CONNECTED_ZOOM_GAP_MS = 1500;
export const DEFAULT_CONNECTED_ZOOM_DURATION_MS = 1000;
export const DEFAULT_ZOOM_IN_EASING: ZoomTransitionEasing = "glitchrecord";
export const DEFAULT_ZOOM_OUT_EASING: ZoomTransitionEasing = "glitchrecord";
export const DEFAULT_CONNECTED_ZOOM_EASING: ZoomTransitionEasing = "glide";
export const DEFAULT_WEBCAM_SIZE = 40;
export const DEFAULT_WEBCAM_REACT_TO_ZOOM = true;
export const DEFAULT_WEBCAM_CORNER_RADIUS = 90;
export const DEFAULT_WEBCAM_SHADOW = 0.67;
export const DEFAULT_WEBCAM_MARGIN = 24;
export const DEFAULT_WEBCAM_POSITION_PRESET: WebcamPositionPreset = "bottom-right";
export const DEFAULT_WEBCAM_POSITION_X = 1;
export const DEFAULT_WEBCAM_POSITION_Y = 1;
export const DEFAULT_WEBCAM_TIME_OFFSET_MS = 0;

export const DEFAULT_WEBCAM_OVERLAY: WebcamOverlaySettings = {
	enabled: false,
	sourcePath: null,
	timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
	mirror: true,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	corner: "bottom-right",
	positionPreset: DEFAULT_WEBCAM_POSITION_PRESET,
	positionX: DEFAULT_WEBCAM_POSITION_X,
	positionY: DEFAULT_WEBCAM_POSITION_Y,
	size: DEFAULT_WEBCAM_SIZE,
	reactToZoom: DEFAULT_WEBCAM_REACT_TO_ZOOM,
	cornerRadius: DEFAULT_WEBCAM_CORNER_RADIUS,
	shadow: DEFAULT_WEBCAM_SHADOW,
	margin: DEFAULT_WEBCAM_MARGIN,
};

export interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export interface ClipRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: number;
	muted?: boolean;
	showSourceAudio?: boolean;
	/**
	 * Where this clip's footage actually begins in the ORIGINAL recording (ms).
	 * `startMs`/`endMs` are the clip's TIMELINE position and get rewritten by
	 * ripple-delete and speed-change reflow (shifting later clips to stay
	 * adjacent) — `sourceStartMs` must NOT move when that happens, or a ripple
	 * silently splices in the wrong footage (see getClipSourceSpans). Set once
	 * when a clip is created (split/carve/restore); omitted only for a clip
	 * that has never been split off from another — then it equals `startMs`.
	 */
	sourceStartMs?: number;
	/**
	 * Two contiguous clips sharing a `retimeGroupId` form one DaVinci-style "speed
	 * point": a marker inside a single clip with two speed zones. Dragging the
	 * internal boundary redistributes time between the zones while keeping the
	 * group's total timeline duration (and total source consumed) constant.
	 * Optional — legacy projects/clips simply have no group.
	 */
	retimeGroupId?: string;
}

export function getClipSourceEndMs(clip: ClipRegion): number {
	const displayDurationMs = Math.max(0, clip.endMs - clip.startMs);
	const speed = getSafeClipSpeed(clip);
	const sourceStartMs = clip.sourceStartMs ?? clip.startMs;
	return Math.round(sourceStartMs + displayDurationMs * speed);
}

/**
 * Where a NEW fragment cut from `parent` at TIMELINE position `boundary` truly
 * lives in the original recording. Use this whenever an edit splits one clip
 * into pieces (carve, split, speed-point insert, restore-tail) so the new
 * fragment's `sourceStartMs` is anchored to the parent's real footage instead
 * of defaulting to its (possibly already-rippled) timeline position.
 */
export function sourceStartAtBoundary(parent: ClipRegion, boundary: number): number {
	const parentSourceStart = parent.sourceStartMs ?? parent.startMs;
	return Math.round(parentSourceStart + (boundary - parent.startMs) * getSafeClipSpeed(parent));
}

export interface ClipSourceSpan {
	clip: ClipRegion;
	/** Effective timeline range after clamping overlaps. Clips can overlap on the
	 * timeline (speed-carving may leave a clip starting before the previous ends); these
	 * are the de-overlapped bounds the mapping uses so the playhead never jumps back. */
	timelineStartMs: number;
	timelineEndMs: number;
	/** Where this clip's footage begins in the ORIGINAL recording (ms). */
	sourceStartMs: number;
	/** Where this clip's footage ends in the ORIGINAL recording (ms). */
	sourceEndMs: number;
}

/**
 * Walk clips in timeline order to derive their TIMELINE bounds (overlap-safe)
 * and each clip's SOURCE position.
 *
 * Two source rules, applied per clip:
 *  - If `sourceStartMs` is explicitly set (carve/split/restore-tail/ripple-lock
 *    since that field was introduced), use it directly — it's the one place we
 *    know true footage position for certain, independent of timeline position.
 *    This is what fixes ripple-delete: the clip after a deleted one shifts on
 *    the timeline to close the gap, but its LOCKED anchor keeps pointing at its
 *    real footage instead of silently splicing in whatever the gap closure now
 *    lines up with.
 *  - Otherwise (a clip that predates this field, or was never split/rippled),
 *    fall BACK to the legacy cumulative-walk inference: source advances by
 *    `duration * speed` each clip, and a timeline gap (a real cut) advances it
 *    further. This is NOT simply "use startMs" — a project with an early
 *    speed-changed clip (e.g. 0.55×) needs every later un-anchored clip's
 *    source position computed from the accumulated total, not its own raw
 *    timeline position, or everything after that speed change maps to the
 *    wrong footage (confirmed against a real pre-existing project: an early
 *    0.55× clip made a later un-anchored clip's "correct" source position
 *    7757ms, nowhere near its own startMs of 14013ms).
 */
export function getClipSourceSpans(clips: ClipRegion[]): ClipSourceSpan[] {
	const sorted = sortClipRegions(clips);
	let timelineCursor = 0;
	let sourceCursor = 0;
	return sorted.map((clip) => {
		// Overlap-safe: a clip may start before the previous one ends (carving artifact).
		// Clamp its visible range to start at the cursor and never move backward, else the
		// source spans become non-monotonic and the source↔timeline mapping flickers the
		// playhead back-and-forth at the overlap (the end-of-play marker jump).
		const timelineStartMs = Math.max(clip.startMs, timelineCursor);
		const timelineEndMs = Math.max(timelineStartMs, clip.endMs);

		let sourceStartMs: number;
		if (clip.sourceStartMs !== undefined) {
			sourceStartMs = clip.sourceStartMs;
		} else {
			// Legacy path: a timeline gap before this clip's effective start (measured
			// against the cursor BEFORE this clip) is a real cut → source skips it.
			if (timelineStartMs > timelineCursor) {
				sourceCursor += timelineStartMs - timelineCursor;
			}
			sourceStartMs = sourceCursor;
		}

		const sourceDurationMs =
			Math.max(0, timelineEndMs - timelineStartMs) * getSafeClipSpeed(clip);
		sourceCursor = sourceStartMs + sourceDurationMs;
		timelineCursor = timelineEndMs;
		return {
			clip,
			timelineStartMs: Math.round(timelineStartMs),
			timelineEndMs: Math.round(timelineEndMs),
			sourceStartMs: Math.round(sourceStartMs),
			sourceEndMs: Math.round(sourceCursor),
		};
	});
}

export function getTimelineDurationMs(clips: ClipRegion[], sourceDurationMs: number): number {
	const baseDurationMs = Math.max(0, Math.round(sourceDurationMs));
	// With no clips, the whole recording IS the timeline.
	if (clips.length === 0) {
		return baseDurationMs;
	}

	// Clips define the edited timeline — it ends where the LAST clip ends. We do NOT
	// floor at the raw source length: when clips consume less source than the recording
	// has (e.g. slow-mo, or a trailing cut), flooring at the source would auto-append the
	// leftover footage and leave the playhead a 'dead zone' past the content (freeze bug).
	return clips.reduce(
		(durationMs, clip) => Math.max(durationMs, Math.max(0, Math.round(clip.endMs))),
		0,
	);
}

export function sortClipRegions(clips: ClipRegion[]): ClipRegion[] {
	return [...clips].sort((left, right) => left.startMs - right.startMs);
}

export function getSafeClipSpeed(clip: ClipRegion) {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

function clampToNearestClipBoundary(
	timeMs: number,
	spans: ClipSourceSpan[],
	inputKind: "timeline" | "source",
) {
	// `inputKind` is the domain of `timeMs`. We return the nearest boundary in the OTHER
	// domain — so an out-of-range time maps to a consistent point. Critically, source
	// time past the last clip must return that clip's TIMELINE end, not its source value:
	// for a slow clip the source value is far smaller, which made the end-of-play marker
	// jump left for a frame before snapping right.
	let nearest = Math.round(timeMs);
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (const { timelineStartMs, timelineEndMs, sourceStartMs, sourceEndMs } of spans) {
		const boundaryPairs: Array<[number, number]> =
			inputKind === "timeline"
				? [
						[timelineStartMs, sourceStartMs],
						[timelineEndMs, sourceEndMs],
					]
				: [
						[sourceStartMs, timelineStartMs],
						[sourceEndMs, timelineEndMs],
					];

		for (const [inputBoundary, outputBoundary] of boundaryPairs) {
			const distance = Math.abs(timeMs - inputBoundary);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearest = Math.round(outputBoundary);
			}
		}
	}

	return nearest;
}

export function mapTimelineTimeToSourceTime(timeMs: number, clips: ClipRegion[]): number {
	const roundedTimeMs = Math.round(timeMs);
	const spans = getClipSourceSpans(clips);

	for (const { clip, timelineStartMs, timelineEndMs, sourceStartMs } of spans) {
		if (roundedTimeMs < timelineStartMs || roundedTimeMs > timelineEndMs) {
			continue;
		}

		return Math.round(
			sourceStartMs + (roundedTimeMs - timelineStartMs) * getSafeClipSpeed(clip),
		);
	}

	if (spans.length === 0) {
		return roundedTimeMs;
	}

	return clampToNearestClipBoundary(roundedTimeMs, spans, "timeline");
}

export function mapSourceTimeToTimelineTime(timeMs: number, clips: ClipRegion[]): number {
	const roundedTimeMs = Math.round(timeMs);
	const spans = getClipSourceSpans(clips);

	for (const { clip, timelineStartMs, sourceStartMs, sourceEndMs } of spans) {
		if (roundedTimeMs < sourceStartMs || roundedTimeMs > sourceEndMs) {
			continue;
		}

		return Math.round(
			timelineStartMs + (roundedTimeMs - sourceStartMs) / getSafeClipSpeed(clip),
		);
	}

	if (spans.length === 0) {
		return roundedTimeMs;
	}

	return clampToNearestClipBoundary(roundedTimeMs, spans, "source");
}

export function findClipAtTimelineTime(timeMs: number, clips: ClipRegion[]): ClipRegion | null {
	const roundedTimeMs = Math.round(timeMs);
	return (
		sortClipRegions(clips).find(
			(clip) => roundedTimeMs >= clip.startMs && roundedTimeMs < clip.endMs,
		) ?? null
	);
}

export function extendAutoFullTrackClip(
	clips: ClipRegion[],
	autoClipId: string | null,
	previousAutoEndMs: number | null,
	nextTotalDurationMs: number,
): ClipRegion[] | null {
	if (
		!autoClipId ||
		!Number.isFinite(previousAutoEndMs) ||
		!Number.isFinite(nextTotalDurationMs) ||
		nextTotalDurationMs <= (previousAutoEndMs ?? 0) ||
		clips.length !== 1
	) {
		return null;
	}

	const [clip] = clips;
	if (
		clip.id !== autoClipId ||
		clip.startMs !== 0 ||
		clip.speed !== 1 ||
		clip.endMs !== previousAutoEndMs
	) {
		return null;
	}

	return [{ ...clip, endMs: nextTotalDurationMs }];
}

/**
 * Convert clip regions (kept segments) to trim regions (source ranges to remove).
 * Trims are emitted in SOURCE time: any part of the original recording NOT
 * covered by some clip's [sourceStartMs, sourceEndMs) is a trim. Spans are
 * sorted by SOURCE position (not timeline position) — ripple-delete can leave
 * clips timeline-adjacent while their footage sits far apart, and sorting by
 * timeline order would hide that as "no gap, nothing to trim".
 */
export function clipsToTrims(clips: ClipRegion[], totalDurationMs: number): TrimRegion[] {
	if (clips.length === 0) return [];
	const spans = [...getClipSourceSpans(clips)].sort((a, b) => a.sourceStartMs - b.sourceStartMs);
	const trims: TrimRegion[] = [];
	let cursor = 0;
	let trimId = 1;
	for (const { sourceStartMs, sourceEndMs } of spans) {
		if (sourceStartMs > cursor) {
			trims.push({ id: `trim-gap-${trimId++}`, startMs: cursor, endMs: sourceStartMs });
		}
		cursor = Math.max(cursor, sourceEndMs);
	}
	if (cursor < totalDurationMs) {
		trims.push({ id: `trim-gap-${trimId++}`, startMs: cursor, endMs: totalDurationMs });
	}
	return trims;
}

/** Convert legacy trim regions to clip regions (complement). */
export function trimsToClips(trims: TrimRegion[], totalDurationMs: number): ClipRegion[] {
	if (trims.length === 0) return [{ id: "clip-1", startMs: 0, endMs: totalDurationMs, speed: 1 }];
	const sorted = [...trims].sort((a, b) => a.startMs - b.startMs);
	const clips: ClipRegion[] = [];
	let cursor = 0;
	let clipId = 1;
	for (const trim of sorted) {
		if (trim.startMs > cursor) {
			clips.push({ id: `clip-${clipId++}`, startMs: cursor, endMs: trim.startMs, speed: 1 });
		}
		cursor = trim.endMs;
	}
	if (cursor < totalDurationMs) {
		clips.push({ id: `clip-${clipId++}`, startMs: cursor, endMs: totalDurationMs, speed: 1 });
	}
	return clips;
}

export type AnnotationType = "text" | "image" | "figure" | "blur";
export const BLUR_ANNOTATION_STRENGTH = 20;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export type ArrowDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-right"
	| "up-left"
	| "down-right"
	| "down-left";

export interface FigureData {
	arrowDirection: ArrowDirection;
	color: string;
	strokeWidth: number;
}

export interface AnnotationPosition {
	x: number;
	y: number;
}

export interface AnnotationSize {
	width: number;
	height: number;
}

export interface AnnotationTextStyle {
	color: string;
	backgroundColor: string;
	fontSize: number; // pixels
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	textAlign: "left" | "center" | "right";
	borderRadius: number;
}

function getDefaultAnnotationFontFamily() {
	return '"SF Pro Display", "SF Pro Text", Helvetica, sans-serif';
}

export function getDefaultCaptionFontFamily() {
	return '"SF Pro Text", "SF Pro Display", Helvetica, sans-serif';
}

export interface AnnotationRegion {
	id: string;
	startMs: number;
	endMs: number;
	type: AnnotationType;
	content: string; // Legacy - still used for current type
	textContent?: string; // Separate storage for text
	imageContent?: string; // Separate storage for image data URL
	position: AnnotationPosition;
	size: AnnotationSize;
	style: AnnotationTextStyle;
	zIndex: number;
	trackIndex?: number;
	figureData?: FigureData;
	blurIntensity?: number;
	blurColor?: string;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
	x: 50,
	y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
	width: 30,
	height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
	color: "#ffffff",
	backgroundColor: "transparent",
	fontSize: 32,
	fontFamily: getDefaultAnnotationFontFamily(),
	fontWeight: "bold",
	fontStyle: "normal",
	textDecoration: "none",
	textAlign: "center",
	borderRadius: 8,
};

export const DEFAULT_FIGURE_DATA: FigureData = {
	arrowDirection: "right",
	color: "#2563EB",
	strokeWidth: 4,
};

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1,
};

export interface Padding {
	top: number;
	bottom: number;
	left: number;
	right: number;
	linked?: boolean;
}

export const DEFAULT_PADDING: Padding = {
	top: 20,
	bottom: 20,
	left: 20,
	right: 20,
	linked: true,
};
export type {
	SourceAudioTrackSetting,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";

export interface AudioRegion {
	id: string;
	startMs: number;
	endMs: number;
	audioPath: string;
	volume: number;
	normalize?: boolean;
	trackIndex?: number;
	/**
	 * Loop the source audio to fill [startMs, endMs] when the file is shorter
	 * than the region. Used by the timeline background-music bed so it plays the
	 * full video with no gap. Plain audio regions leave this undefined (play once).
	 */
	loop?: boolean;
	/**
	 * Equal-power crossfade applied at each loop seam (ms) so the repeat feels
	 * seamless rather than a hard cut/click. Only meaningful when `loop` is true.
	 */
	loopCrossfadeMs?: number;
	/**
	 * True for the generated TTS narration region (added via "Add to video"). Lets
	 * preview/export mute JUST the narration independently — without touching manual
	 * audio or the music bed — when the user mutes narration or turns on avatar voice.
	 */
	isNarration?: boolean;
}

/**
 * Timeline background-music bed. A single track that plays UNDER the narration
 * for the whole main video (output time 0 → timeline end). It loops seamlessly
 * when the file is shorter than the video. It lives outside the intro/outro
 * cards (those are concatenated after export), so music never bleeds into them.
 */
export interface BackgroundMusicConfig {
	/** Absolute local path to the user-picked audio file. */
	audioPath: string;
	/** 0..1 — kept low by default so it sits under the narration. */
	volume: number;
	/** Equal-power crossfade at each loop seam, in ms. */
	loopCrossfadeMs: number;
	/** File basename, for display in the export menu. */
	name?: string;
}

/** Default music volume — low enough to sit under narration without ducking. */
export const DEFAULT_BACKGROUND_MUSIC_VOLUME = 0.18;
/** Default loop seam crossfade — ~200ms reads as seamless. */
export const DEFAULT_BACKGROUND_MUSIC_CROSSFADE_MS = 200;

export interface CaptionCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: CaptionCueWord[];
}

export interface CaptionCueWord {
	text: string;
	startMs: number;
	endMs: number;
	leadingSpace?: boolean;
}

export type AutoCaptionAnimation = "none" | "fade" | "rise" | "pop";

export interface AutoCaptionSettings {
	enabled: boolean;
	language: string;
	fontFamily: string;
	fontSize: number;
	bottomOffset: number;
	maxWidth: number;
	maxRows: number;
	animationStyle: AutoCaptionAnimation;
	boxRadius: number;
	textColor: string;
	inactiveTextColor: string;
	backgroundOpacity: number;
}

export const DEFAULT_AUTO_CAPTION_SETTINGS: AutoCaptionSettings = {
	enabled: false,
	language: "auto",
	fontFamily: getDefaultCaptionFontFamily(),
	fontSize: 30,
	bottomOffset: 3,
	maxWidth: 62,
	maxRows: 1,
	animationStyle: "fade",
	boxRadius: 17.5,
	textColor: "#FFFFFF",
	inactiveTextColor: "#A3A3A3",
	backgroundOpacity: 0.9,
};

export type PlaybackSpeed = 0.25 | 0.5 | 0.75 | 1.25 | 1.5 | 1.75 | 2 | 2.5 | 3 | 4;

export interface SpeedRegion {
	id: string;
	startMs: number;
	endMs: number;
	/** Free playback speed, snapped to a clean 0.05 grid (0.1 … 30). Not the old
	 *  fixed PlaybackSpeed presets — the user sets it by dragging the clip edge. */
	speed: number;
	/** Source content (ms) the region covers. Drag the edge to stretch (slower) or
	 *  squeeze (faster); speed = sourceMs / timelineWidth, snapped to 0.05. */
	sourceMs?: number;
}

export const SPEED_OPTIONS: Array<{ speed: PlaybackSpeed; label: string }> = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 1.75, label: "1.75×" },
	{ speed: 2, label: "2×" },
	{ speed: 2.5, label: "2.5×" },
	{ speed: 3, label: "3×" },
	{ speed: 4, label: "4×" },
];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.5;

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;
export const DEFAULT_AUTO_ZOOM_DEPTH: ZoomDepth = 2;

export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
	return {
		cx: clamp(focus.cx, 0, 1),
		cy: clamp(focus.cy, 0, 1),
	};
}

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}
