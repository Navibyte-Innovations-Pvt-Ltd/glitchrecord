import type { Range } from "dnd-timeline";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createInitialRange, normalizeWheelDeltaToPixels } from "../core/time";

interface UseTimelineRangeParams {
	totalMs: number;
	timelineContainerRef: RefObject<HTMLDivElement>;
}

export interface TimelineWheelPanDeltaInput {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	canScrollVertically?: boolean;
}

export function resolveTimelineWheelPanDeltaPx({
	deltaX,
	deltaY,
	deltaMode,
	shiftKey = false,
	ctrlKey = false,
	metaKey = false,
	canScrollVertically = true,
}: TimelineWheelPanDeltaInput) {
	if ((ctrlKey || metaKey) && !shiftKey) {
		return 0;
	}

	if (Math.abs(deltaX) > 0) {
		return normalizeWheelDeltaToPixels(deltaX, deltaMode);
	}

	if ((shiftKey || !canScrollVertically) && Math.abs(deltaY) > 0) {
		return normalizeWheelDeltaToPixels(deltaY, deltaMode);
	}

	return 0;
}

export function useTimelineRange({ totalMs, timelineContainerRef }: UseTimelineRangeParams) {
	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));
	const prevTotalMsRef = useRef(totalMs);

	useEffect(() => {
		const prevTotalMs = prevTotalMsRef.current;
		prevTotalMsRef.current = totalMs;
		// Only reset zoom on first load (0 → non-zero). Speed/stretch changes
		// totalMs while the user has a zoom level set — don't clobber it.
		if (prevTotalMs === 0 && totalMs > 0) {
			setRange(createInitialRange(totalMs));
		}
	}, [totalMs]);

	const clampedRange = useMemo<Range>(() => {
		if (totalMs === 0) {
			return range;
		}
		return {
			start: Math.max(0, Math.min(range.start, totalMs)),
			end: Math.min(range.end, totalMs),
		};
	}, [range, totalMs]);

	const panTimelineRange = useCallback(
		(deltaMs: number) => {
			if (!Number.isFinite(deltaMs) || deltaMs === 0 || totalMs <= 0) {
				return;
			}

			setRange((previous) => {
				const visibleSpan = Math.max(1, previous.end - previous.start);
				const maxStart = Math.max(0, totalMs - visibleSpan);
				const nextStart = Math.max(0, Math.min(previous.start + deltaMs, maxStart));
				return { start: nextStart, end: nextStart + visibleSpan };
			});
		},
		[totalMs],
	);

	const handleTimelineWheel = useCallback(
		(event: WheelEvent) => {
			if (((event.ctrlKey || event.metaKey) && !event.shiftKey) || totalMs <= 0) {
				return;
			}

			const container = timelineContainerRef.current;
			const horizontalDeltaPx = resolveTimelineWheelPanDeltaPx({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				shiftKey: event.shiftKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				canScrollVertically: container
					? container.scrollHeight > container.clientHeight + 1
					: true,
			});

			if (horizontalDeltaPx === 0) {
				return;
			}

			const containerWidth = container?.clientWidth ?? 0;
			const visibleRangeMs = clampedRange.end - clampedRange.start;
			if (containerWidth <= 0 || visibleRangeMs <= 0) {
				return;
			}

			event.preventDefault();
			const deltaMs = (horizontalDeltaPx / containerWidth) * visibleRangeMs;
			panTimelineRange(deltaMs);
		},
		[clampedRange.end, clampedRange.start, panTimelineRange, timelineContainerRef, totalMs],
	);

	// Attach the wheel handler as a NATIVE NON-PASSIVE listener. React's `onWheel`
	// registers wheel events as passive, so `event.preventDefault()` inside the handler
	// is a no-op AND logs a warning on EVERY wheel tick — a trackpad scroll floods the
	// console hundreds of times and freezes the editor. A non-passive native listener
	// lets preventDefault work silently. A ref keeps the listener stable so we don't
	// re-bind on every pan (which changes the handler's identity).
	const wheelHandlerRef = useRef(handleTimelineWheel);
	wheelHandlerRef.current = handleTimelineWheel;
	useEffect(() => {
		const container = timelineContainerRef.current;
		if (!container) {
			return;
		}
		const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => container.removeEventListener("wheel", onWheel);
	}, [timelineContainerRef]);

	return {
		range,
		setRange,
		clampedRange,
	};
}
