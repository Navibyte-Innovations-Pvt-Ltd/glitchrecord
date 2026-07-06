// Pure geometry/visibility helpers for the AI avatar PiP overlay. Extracted from
// VideoPlayback so the layout math + show/hide rules are unit-testable (the inline
// version froze the editor via a ResizeObserver loop — pure functions let us catch
// regressions without rendering Pixi).
import type { AudioRegion, AvatarOverlaySettings, AvatarRegion } from "./types";
import { getWebcamOverlayPosition, getWebcamOverlaySizePx } from "./webcamOverlay";

// EXPORT audio: the compositor bakes only avatar VIDEO frames, so when the avatar plays
// its own voice (unmuted) the export would be silent unless we mux the clip's audio.
// Append the avatar clip as an audio region at t=0 (synced with its timeline-anchored
// frames). When muted, the timeline narration carries the audio, so leave it untouched.
// The narration track is silenced only by an explicit choice: the user muting
// narration, OR the avatar playing its own voice (else the voice doubles). Drops
// ONLY narration regions — manual audio + the music bed are never touched. Used
// for BOTH preview and export so the editor mirrors the file.
export function applyNarrationMute(audioRegions: AudioRegion[], silenceNarration: boolean): AudioRegion[] {
	if (!silenceNarration) return audioRegions;
	return audioRegions.filter((r) => !r.isNarration);
}

export function buildExportAudioRegions(
	audioRegions: AudioRegion[],
	avatar: AvatarOverlaySettings,
	timelineDurationSec: number,
): AudioRegion[] {
	if (avatar.enabled && avatar.muted === false && avatar.sourcePath) {
		return [
			...audioRegions,
			{
				id: "avatar-voice",
				audioPath: avatar.sourcePath,
				startMs: 0,
				endMs: Math.max(1, Math.round(timelineDurationSec * 1000)),
				volume: 1,
			},
		];
	}
	return audioRegions;
}

export interface AvatarBubbleLayout {
	x: number;
	y: number;
	/** Box width/height in px (equal for the corner PiP, differ when full-frame). */
	width: number;
	height: number;
	borderRadius: number;
}

// Should the overlay render at all? True only when enabled AND we have something
// to show — either the generated clip URL or a look-thumbnail placeholder URL.
export function isAvatarOverlayVisible(
	settings: AvatarOverlaySettings | undefined | null,
	videoPath: string | null | undefined,
): boolean {
	if (!settings || !settings.enabled) return false;
	return Boolean(videoPath || settings.previewUrl);
}

// CSS object-position for the avatar media inside its box. Lets the user pan the
// face into frame (Shift+drag / framing slider). Clamped to 0–100 each axis.
export function getAvatarObjectPosition(settings: AvatarOverlaySettings): string {
	const clamp = (n: number, fallback: number) =>
		Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
	const x = clamp(settings.framingX, 50);
	const y = clamp(settings.framingY, 22);
	return `${x}% ${y}%`;
}

// Convert a Shift-drag delta (px) into new framing percentages. Dragging the photo
// right reveals its left side → framingX decreases (hence the minus).
export function panAvatarFraming(opts: {
	startX: number;
	startY: number;
	deltaXpx: number;
	deltaYpx: number;
	boxW: number;
	boxH: number;
}): { framingX: number; framingY: number } {
	const w = Math.max(1, opts.boxW);
	const h = Math.max(1, opts.boxH);
	const clamp = (n: number) => Math.min(100, Math.max(0, n));
	return {
		framingX: clamp(opts.startX - (opts.deltaXpx / w) * 100),
		framingY: clamp(opts.startY - (opts.deltaYpx / h) * 100),
	};
}

// Position + size + corner radius for the bubble. Returns null when there's no
// room (container not laid out yet) so callers can hide instead of drawing NaN.
export function getAvatarBubbleLayout({
	containerWidth,
	containerHeight,
	settings,
}: {
	containerWidth: number;
	containerHeight: number;
	settings: AvatarOverlaySettings;
}): AvatarBubbleLayout | null {
	if (
		!Number.isFinite(containerWidth) ||
		!Number.isFinite(containerHeight) ||
		containerWidth <= 0 ||
		containerHeight <= 0
	) {
		return null;
	}
	const size = getWebcamOverlaySizePx({
		containerWidth,
		containerHeight,
		sizePercent: settings.size,
		margin: settings.margin,
		zoomScale: 1,
		reactToZoom: false,
	});
	const { x, y } = getWebcamOverlayPosition({
		containerWidth,
		containerHeight,
		size,
		margin: settings.margin,
		positionPreset: settings.positionPreset,
		positionX: settings.positionX ?? 1,
		positionY: settings.positionY ?? 1,
		legacyCorner: "bottom-right",
	});
	const borderRadius = settings.shape === "circle" ? size / 2 : Math.round(size * 0.12);
	return { x, y, width: size, height: size, borderRadius };
}

// The full-frame layout: the avatar covers the whole stage.
export function getAvatarFullFrameLayout(
	containerWidth: number,
	containerHeight: number,
): AvatarBubbleLayout {
	return { x: 0, y: 0, width: containerWidth, height: containerHeight, borderRadius: 0 };
}

// 0→1 "fullness": how much the avatar should be expanded toward full-frame at the
// given time, across all spotlight regions. Eases in/out over `easeMs` at each
// region's edges and holds at 1 in the middle (like a zoom envelope), so the
// avatar slides+grows from the corner to full and back.
export function getAvatarSpotlightProgress(
	regions: AvatarRegion[] | undefined | null,
	currentMs: number,
	easeMs = 450,
): number {
	if (!regions || regions.length === 0 || !Number.isFinite(currentMs)) return 0;
	let best = 0;
	for (const r of regions) {
		if (currentMs < r.startMs || currentMs > r.endMs) continue;
		const span = r.endMs - r.startMs;
		if (span <= 0) continue;
		const ease = Math.min(easeMs, span / 2);
		const into = currentMs - r.startMs;
		const outOf = r.endMs - currentMs;
		let p = 1;
		if (ease > 0) {
			if (into < ease) p = into / ease;
			else if (outOf < ease) p = outOf / ease;
		}
		// Smoothstep for a soft slide rather than a linear ramp.
		const s = p * p * (3 - 2 * p);
		if (s > best) best = s;
	}
	return best;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Blend the corner PiP layout toward the full-frame layout by `t` (0..1).
export function lerpAvatarLayout(
	base: AvatarBubbleLayout,
	full: AvatarBubbleLayout,
	t: number,
): AvatarBubbleLayout {
	const k = Math.min(1, Math.max(0, t));
	return {
		x: lerp(base.x, full.x, k),
		y: lerp(base.y, full.y, k),
		width: lerp(base.width, full.width, k),
		height: lerp(base.height, full.height, k),
		borderRadius: lerp(base.borderRadius, full.borderRadius, k),
	};
}
