import { useEffect, useRef, useState } from "react";
import { drawCardBackground, drawCardForeground } from "./cardAnimationRenderer";
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
	/** When set (0..1), show a single frozen frame at this progress (scrubbing) — no loop. */
	frozenProgress?: number;
	/** 0..1 — start playback from this fraction (resume from the marker). */
	startProgress?: number;
}

const CAP_W = 720;

function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) return x < edge0 ? 0 : 1;
	const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return u * u * (3 - 2 * u);
}

export function CardOverlay({
	side,
	logoDataUrl,
	durationMs,
	onEnded,
	frozenProgress,
	startProgress,
}: CardOverlayProps) {
	if (side.mode === "video" && side.videoPath) {
		return (
			<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black">
				{/* biome-ignore lint/a11y/useMediaCaption: user intro/outro clip */}
				<video
					key={side.videoPath}
					src={`file://${side.videoPath}`}
					autoPlay={frozenProgress === undefined}
					className="h-full w-full object-contain"
					onLoadedMetadata={(e) => {
						const v = e.currentTarget;
						if (startProgress && v.duration) v.currentTime = startProgress * v.duration;
					}}
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
			frozenProgress={frozenProgress}
			startProgress={startProgress}
		/>
	);
}

function CardCanvasOverlay({
	side,
	logoDataUrl,
	durationMs,
	onEnded,
	frozenProgress,
	startProgress,
}: CardOverlayProps) {
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

	// Offscreen cache of the STATIC background — recreating 3 gradients per frame
	// was the main cost. Rebuilt only when size or background config changes.
	const bgRef = useRef<HTMLCanvasElement | null>(null);
	const bgKeyRef = useRef("");

	// Paint one frame at progress p (bg from cache + foreground). `edgeFade`
	// crossfades the whole overlay at the card edges; off for scrub frames.
	const paint = useRef<(p: number, edgeFade: boolean) => void>(() => undefined);
	paint.current = (p: number, edgeFade: boolean) => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const w = canvas.width;
		const h = canvas.height;
		const bg = side.background;
		const key = `${w}x${h}|${bg.type}|${bg.color1}|${bg.color2}|${bg.angle}|${bg.glow}|${bg.vignette}`;
		if (key !== bgKeyRef.current || !bgRef.current) {
			const bgCanvas = bgRef.current ?? document.createElement("canvas");
			bgCanvas.width = w;
			bgCanvas.height = h;
			const bgCtx = bgCanvas.getContext("2d");
			if (bgCtx) drawCardBackground(bgCtx, w, h, side);
			bgRef.current = bgCanvas;
			bgKeyRef.current = key;
		}
		ctx.clearRect(0, 0, w, h);
		if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0);
		drawCardForeground(ctx, w, h, logoRef.current, side, p);
		const edge = edgeFade ? Math.min(smoothstep(0, 0.12, p), 1 - smoothstep(0.88, 1, p)) : 1;
		if (wrapRef.current) wrapRef.current.style.opacity = String(edge);
	};

	const isFrozen = frozenProgress !== undefined;

	// Scrub mode: draw a single frozen frame (no loop) whenever progress changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: paint reads current side
	useEffect(() => {
		if (!isFrozen) return;
		paint.current(Math.min(1, Math.max(0, frozenProgress ?? 0)), false);
	}, [isFrozen, frozenProgress, side, logoReady]);

	// Playback mode: self-driven loop capped to ~30fps.
	// biome-ignore lint/correctness/useExhaustiveDependencies: draws current side; restarts on side/duration change
	useEffect(() => {
		if (isFrozen) return;
		let raf = 0;
		// Backdate so playback resumes at the marker's fraction.
		const startAt = Math.min(1, Math.max(0, startProgress ?? 0));
		const startedAt = performance.now() - startAt * Math.max(1, durationMs);
		let lastDraw = -1;
		const frameMs = 1000 / 30;
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			const p = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
			const done = p >= 1;
			if (!done && lastDraw >= 0 && now - lastDraw < frameMs) return;
			lastDraw = now;
			paint.current(p, true);
			if (done) {
				cancelAnimationFrame(raf);
				onEndedRef.current?.();
			}
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [isFrozen, side, durationMs, logoReady]);

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
