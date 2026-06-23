import { useEffect, useRef, useState } from "react";
import { drawCard } from "./cardAnimationRenderer";
import type { IntroOutroSideConfig } from "./introOutroTypes";

/**
 * Full-bleed intro/outro card drawn over the editor preview during playback.
 * Controlled: the parent drives `progress` (0→1 across the card) via its rAF
 * loop; this only paints. Shown while the player is parked in a card phase.
 */
interface CardOverlayProps {
	side: IntroOutroSideConfig;
	logoDataUrl: string;
	progress: number;
}

export function CardOverlay({ side, logoDataUrl, progress }: CardOverlayProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const logoRef = useRef<HTMLImageElement | null>(null);
	const [logoReady, setLogoReady] = useState(false);

	useEffect(() => {
		setLogoReady(false);
		if (!logoDataUrl) {
			logoRef.current = null;
			return;
		}
		const img = new Image();
		img.onload = () => {
			logoRef.current = img;
			setLogoReady(true);
		};
		img.onerror = () => {
			logoRef.current = null;
		};
		img.src = logoDataUrl;
		return () => {
			img.onload = null;
			img.onerror = null;
		};
	}, [logoDataUrl]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: side fields + logoReady drive the paint
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const w = canvas.offsetWidth || 640;
		const h = canvas.offsetHeight || 360;
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		drawCard({ ctx, width: w, height: h, logo: logoRef.current, side, progress });
	}, [
		progress,
		logoReady,
		side.preset,
		side.position,
		side.size,
		side.backgroundColor,
		side.durationMs,
	]);

	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
			<canvas ref={canvasRef} className="h-full w-full" />
		</div>
	);
}
