import { useEffect, useRef, useState } from "react";
import { drawCard } from "./cardAnimationRenderer";
import type { IntroOutroSideConfig } from "./introOutroTypes";

/**
 * Full-bleed intro/outro overlay over the editor preview during playback.
 * Card mode: the parent drives `progress` (0→1) via its rAF loop; this paints.
 * Video mode: plays the user's clip and calls `onEnded` when it finishes.
 * Shown while the player is parked in a card phase.
 */
interface CardOverlayProps {
	side: IntroOutroSideConfig;
	logoDataUrl: string;
	progress: number;
	onEnded?: () => void;
}

export function CardOverlay({ side, logoDataUrl, progress, onEnded }: CardOverlayProps) {
	if (side.mode === "video" && side.videoPath) {
		return (
			<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black">
				{/* biome-ignore lint/a11y/useMediaCaption: user intro/outro clip */}
				<video
					key={side.videoPath}
					src={`file://${side.videoPath}`}
					autoPlay
					className="h-full w-full object-contain"
					onEnded={onEnded}
					onError={onEnded}
				/>
			</div>
		);
	}
	return <CardCanvasOverlay side={side} logoDataUrl={logoDataUrl} progress={progress} />;
}

function CardCanvasOverlay({ side, logoDataUrl, progress }: CardOverlayProps) {
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: paint reads current side
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const w = canvas.offsetWidth || 640;
		const h = canvas.offsetHeight || 360;
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		drawCard({ ctx, width: w, height: h, logo: logoRef.current, side, progress });
	}, [progress, logoReady, side]);

	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
			<canvas ref={canvasRef} className="h-full w-full" />
		</div>
	);
}
