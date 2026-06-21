// Pure geometry/visibility helpers for the AI avatar PiP overlay. Extracted from
// VideoPlayback so the layout math + show/hide rules are unit-testable (the inline
// version froze the editor via a ResizeObserver loop — pure functions let us catch
// regressions without rendering Pixi).
import type { AvatarOverlaySettings } from "./types";
import { getWebcamOverlayPosition, getWebcamOverlaySizePx } from "./webcamOverlay";

export interface AvatarBubbleLayout {
	x: number;
	y: number;
	size: number;
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
	return { x, y, size, borderRadius };
}
