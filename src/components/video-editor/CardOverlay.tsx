import { useEffect, useRef, useState } from "react";
import { drawCard } from "./cardAnimationRenderer";
import type { IntroOutroSideConfig } from "./introOutroTypes";

/**
 * Full-bleed intro/outro overlay over the editor preview during playback.
 *
 * Card mode SELF-ANIMATES: it runs its own rAF loop and draws imperatively to the
 * canvas — it does NOT push progress through React state, so the (huge) editor
 * does not re-render every frame (that was the lag). Calls `onEnded` when done.
 * Video mode plays the user's clip and calls `onEnded` on its `ended` event.
 */
interface CardOverlayProps {
	side: IntroOutroSideConfig;
	logoDataUrl: string;
	/** Card length in ms (card mode). */
	durationMs: number;
	onEnded?: () => void;
}

const CAP_W = 720;

function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) return x < edge0 ? 0 : 1;
	const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return u * u * (3 - 2 * u);
}

export function CardOverlay({ side, logoDataUrl, durationMs, onEnded }: CardOverlayProps) {
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
	return (
		<CardCanvasOverlay
			side={side}
			logoDataUrl={logoDataUrl}
			durationMs={durationMs}
			onEnded={onEnded}
		/>
	);
}

function CardCanvasOverlay({ side, logoDataUrl, durationMs, onEnded }: CardOverlayProps) {
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const logoRef = useRef<HTMLImageElement | null>(null);
	const [logoReady, setLogoReady] = useState(false);
	// Keep the latest onEnded without restarting the animation loop.
	const onEndedRef = useRef(onEnded);
	onEndedRef.current = onEnded;

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

	// Size the canvas (capped) once + on resize, so per-frame blur/shadow is cheap.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
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

	// Self-driven animation loop — imperative draw, no React state per frame.
	// biome-ignore lint/correctness/useExhaustiveDependencies: draws current side; restarts on side/duration change
	useEffect(() => {
		let raf = 0;
		const startedAt = performance.now();
		const loop = (now: number) => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext("2d");
			if (canvas && ctx) {
				const p = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
				drawCard({
					ctx,
					width: canvas.width,
					height: canvas.height,
					logo: logoRef.current,
					side,
					progress: p,
				});
				// Crossfade the whole overlay (bg included) against the video at the
				// card edges → smooth intro→video and video→outro handoff.
				const edge = Math.min(smoothstep(0, 0.12, p), 1 - smoothstep(0.88, 1, p));
				if (wrapRef.current) wrapRef.current.style.opacity = String(edge);
				if (p >= 1) {
					onEndedRef.current?.();
					return;
				}
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [side, durationMs, logoReady]);

	return (
		<div
			ref={wrapRef}
			className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
			style={{ opacity: 0 }}
		>
			<canvas ref={canvasRef} className="h-full w-full" />
		</div>
	);
}
