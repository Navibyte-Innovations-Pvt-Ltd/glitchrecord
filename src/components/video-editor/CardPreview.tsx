import { Pause as PauseIcon, Play as PlayIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { cardDurationMs, drawCard } from "./cardAnimationRenderer";
import type { IntroOutroSideConfig } from "./introOutroTypes";

const DEFAULT_W = 248;
const DEFAULT_H = 140;
/** Idle frame position — settled state so the composition is visible when paused. */
const IDLE_PROGRESS = 0.5;

interface CardPreviewProps {
	side: IntroOutroSideConfig;
	logoDataUrl: string;
	width?: number;
	height?: number;
}

export function CardPreview({
	side,
	logoDataUrl,
	width: PREVIEW_W = DEFAULT_W,
	height: PREVIEW_H = DEFAULT_H,
}: CardPreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const logoRef = useRef<HTMLImageElement | null>(null);
	const rafRef = useRef<number | null>(null);
	const startRef = useRef<number>(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [logoReady, setLogoReady] = useState(false);

	// Load the logo into an Image whenever the data URL changes.
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

	const paint = (progress: number) => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		drawCard({
			ctx,
			width: PREVIEW_W,
			height: PREVIEW_H,
			logo: logoRef.current,
			side,
			progress,
		});
	};

	// Redraw the idle frame when settings/logo change and not actively playing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: paint reads current side
	useEffect(() => {
		if (!isPlaying) {
			paint(IDLE_PROGRESS);
		}
	}, [isPlaying, logoReady, side]);

	useEffect(() => {
		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
			}
		};
	}, []);

	const stop = () => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		setIsPlaying(false);
		paint(IDLE_PROGRESS);
	};

	const play = () => {
		if (!logoRef.current) return;
		const duration = cardDurationMs(side);
		startRef.current = performance.now();
		setIsPlaying(true);
		const tick = (now: number) => {
			const elapsed = now - startRef.current;
			const progress = elapsed / duration;
			if (progress >= 1) {
				paint(1);
				rafRef.current = null;
				setIsPlaying(false);
				paint(IDLE_PROGRESS);
				return;
			}
			paint(progress);
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
	};

	return (
		<div className="mt-1">
			<div className="relative overflow-hidden rounded-md border border-foreground/10 bg-black">
				<canvas
					ref={canvasRef}
					width={PREVIEW_W}
					height={PREVIEW_H}
					className="block h-auto w-full"
				/>
				<button
					type="button"
					onClick={isPlaying ? stop : play}
					disabled={!logoReady}
					aria-label={isPlaying ? "Stop preview" : "Play preview"}
					className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-white shadow transition-colors hover:bg-[#2563EB]/90 disabled:opacity-40"
				>
					{isPlaying ? (
						<PauseIcon weight="fill" className="h-3.5 w-3.5" />
					) : (
						<PlayIcon weight="fill" className="h-3.5 w-3.5" />
					)}
				</button>
			</div>
		</div>
	);
}
