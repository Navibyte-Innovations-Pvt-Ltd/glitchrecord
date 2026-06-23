import { cardDurationMs, drawCard } from "./cardAnimationRenderer";
import type { IntroOutroSideConfig } from "./introOutroTypes";

/**
 * Render a card side to a PNG frame sequence (base64 data URLs) using the same
 * `drawCard` the preview uses, so the exported card matches the preview exactly.
 * The main process encodes these frames into an mp4 matching the export params.
 */
export async function renderCardFrames(
	side: IntroOutroSideConfig,
	logoDataUrl: string,
	width: number,
	height: number,
	fps: number,
): Promise<string[]> {
	const logo = logoDataUrl ? await loadImage(logoDataUrl) : null;

	const canvas = document.createElement("canvas");
	canvas.width = Math.max(2, Math.round(width));
	canvas.height = Math.max(2, Math.round(height));
	const ctx = canvas.getContext("2d");
	if (!ctx) return [];

	const durationMs = cardDurationMs(side);
	const frameCount = Math.max(1, Math.round((durationMs / 1000) * fps));
	const frames: string[] = [];
	for (let i = 0; i < frameCount; i++) {
		const progress = frameCount > 1 ? i / (frameCount - 1) : 1;
		drawCard({ ctx, width: canvas.width, height: canvas.height, logo, side, progress });
		frames.push(canvas.toDataURL("image/png"));
	}
	return frames;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = dataUrl;
	});
}
