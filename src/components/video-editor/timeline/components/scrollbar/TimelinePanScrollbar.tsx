import type { Range } from "dnd-timeline";
import { useCallback, useRef } from "react";
import { computeScrollbarThumb, resolveRangeFromScrollFraction } from "../../core/time";

interface TimelinePanScrollbarProps {
	/** The CLAMPED range (what's on screen) — keeps the thumb from desyncing. */
	range: Range;
	totalMs: number;
	onRangeChange: (range: Range) => void;
}

/**
 * Thin draggable horizontal pan bar. The timeline canvas is exactly the
 * container width (items are positioned by `range` fraction, not by overflow),
 * so there is no native horizontal scrollbar to grab — panning was wheel-only,
 * unreachable with a mouse. This bar maps a drag to `range.start` so a zoomed-in
 * user can pan to any part of the timeline, including the far right edge.
 *
 * Only rendered when zoomed in (`canPan`) — at full zoom-out there's nothing to
 * pan, and a full-width bar looked unpolished.
 */
export default function TimelinePanScrollbar({
	range,
	totalMs,
	onRangeChange,
}: TimelinePanScrollbarProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const { leftFraction, widthFraction, canPan } = computeScrollbarThumb(range, totalMs);
	const visibleSpanMs = Math.max(1, range.end - range.start);

	// Pointer drag: convert the pointer's X within the track to a start fraction.
	// `grabOffsetFraction` keeps the grab point on the thumb fixed (no jump on
	// pointer-down). A pointer-down on the empty track jumps the thumb under the
	// cursor (centered), matching native scrollbar behavior.
	const dragRef = useRef<{ grabOffsetFraction: number } | null>(null);

	const startFractionFromPointer = useCallback((clientX: number, grabOffsetFraction: number) => {
		const track = trackRef.current;
		if (!track) return 0;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return 0;
		const pointerFraction = (clientX - rect.left) / rect.width;
		return pointerFraction - grabOffsetFraction;
	}, []);

	const applyPointer = useCallback(
		(clientX: number, grabOffsetFraction: number) => {
			const startFraction = startFractionFromPointer(clientX, grabOffsetFraction);
			onRangeChange(resolveRangeFromScrollFraction(startFraction, visibleSpanMs, totalMs));
		},
		[onRangeChange, startFractionFromPointer, totalMs, visibleSpanMs],
	);

	const handleThumbPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const track = trackRef.current;
			if (!track) return;
			const rect = track.getBoundingClientRect();
			const pointerFraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
			// Offset of the grab point from the thumb's left edge.
			const grabOffsetFraction = pointerFraction - leftFraction;
			dragRef.current = { grabOffsetFraction };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[leftFraction],
	);

	const handleTrackPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			// Clicked the empty track, not the thumb → center the thumb on the click,
			// then keep dragging from there.
			event.preventDefault();
			const grabOffsetFraction = widthFraction / 2;
			dragRef.current = { grabOffsetFraction };
			event.currentTarget.setPointerCapture(event.pointerId);
			applyPointer(event.clientX, grabOffsetFraction);
		},
		[applyPointer, widthFraction],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag) return;
			applyPointer(event.clientX, drag.grabOffsetFraction);
		},
		[applyPointer],
	);

	const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		dragRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}, []);

	if (!canPan) {
		return null;
	}

	return (
		<div className="px-3 py-1 select-none">
			<div
				ref={trackRef}
				role="scrollbar"
				aria-orientation="horizontal"
				aria-label="Pan timeline horizontally"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(leftFraction * 100)}
				className="relative h-2 w-full rounded-full bg-white/5 cursor-pointer"
				onPointerDown={handleTrackPointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
			>
				<div
					className="absolute top-0 h-2 rounded-full bg-white/25 hover:bg-white/40 active:bg-white/50 transition-colors"
					style={{
						left: `${leftFraction * 100}%`,
						width: `${Math.max(widthFraction * 100, 4)}%`,
					}}
					onPointerDown={handleThumbPointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
				/>
			</div>
		</div>
	);
}
