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

	// Size the canvas once (and on resize), capped to keep per-frame blur/shadow
	// cheap — drawing every rAF frame at the full preview pixel size lagged.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const CAP_W = 720;
		const measure = () => {
			const dw = canvas.offsetWidth || 640;
			const dh = canvas.offsetHeight || 360;
			const scale = dw > CAP_W ? CAP_W / dw : 1;
			const w = Math.max(2, Math.round(dw * scale));
			const h = Math.max(2, Math.round(dh * scale));
			if (canvas.width !== w) canvas.width = w;
			if (canvas.height !== h) canvas.height = h;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(canvas);
		return () => ro.disconnect();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: paint reads current side
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		drawCard({
			ctx,
			width: canvas.width,
			height: canvas.height,
			logo: logoRef.current,
			side,
			progress,
		});
	}, [progress, logoReady, side]);

	// Crossfade the WHOLE overlay (background included) against the video at the
	// card edges so intro→video and video→outro hand off smoothly instead of
	// popping. The card stays fully opaque through the middle.
	const fadeIn = smoothstep(0, 0.12, progress);
	const fadeOut = 1 - smoothstep(0.88, 1, progress);
	const edgeOpacity = Math.min(fadeIn, fadeOut);

	return (
		<div
			className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
			style={{ opacity: edgeOpacity }}
		>
			<canvas ref={canvasRef} className="h-full w-full" />
		</div>
	);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) return x < edge0 ? 0 : 1;
	const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return u * u * (3 - 2 * u);
}
