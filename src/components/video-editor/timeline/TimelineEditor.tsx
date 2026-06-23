import {
	MagnifyingGlassMinus,
	MagnifyingGlassPlus,
	PencilSimple,
	Plus,
	X,
} from "@phosphor-icons/react";
import type { Span } from "dnd-timeline";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type {
	SourceAudioTrackMeta,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { fromFileUrl } from "../projectPersistence";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
} from "../types";
import KeyframeMarkers from "./components/markers/KeyframeMarkers";
import TimelineCanvas from "./components/viewport/TimelineCanvas";
import TimelineWrapper from "./components/wrapper/TimelineWrapper";
import { calculateTimelineScale } from "./core/time";
import { computeZoomedRange, spanToFraction } from "./core/timelineZoom";
import { useTimelineAudioPeaks } from "./hooks/useTimelineAudioPeaks";
import { useTimelineEditorRuntime } from "./hooks/useTimelineEditorRuntime";
import { useTimelineRange } from "./hooks/useTimelineRange";
import {
	buildSourceSidecarPathCandidates,
	buildTimelineSourceAudioTracks,
} from "./sourceAudioTracks";
import zoomStyles from "./TimelineZoom.module.css";
import { TIMELINE_AXIS_HEIGHT_PX, TIMELINE_ROW_MAX_HEIGHT_PX } from "./timelineLayout";

/** Clickable intro/outro bookend shown pinned at a track edge. */
export interface TimelineEndcap {
	label: string;
	active: boolean;
	/** Primary click (no drag) — preview the card in the player (or open setup if empty). */
	onClick: () => void;
	/** Pencil button — open the studio to edit this side (active only). */
	onEdit?: () => void;
	/** Card length in ms — drives the playhead sweep + scrub mapping. */
	durationMs?: number;
	/** True while THIS side's card is playing — sweeps a mini-playhead across the block. */
	playing?: boolean;
	/** Drag across the block — fraction 0..1 — to scrub a frozen card frame in the preview. */
	onScrub?: (progress: number) => void;
	/** Pointer released after a scrub drag. */
	onScrubEnd?: () => void;
	/** 0..1 while THIS side is being scrubbed — pins the blue playhead at that spot. */
	scrubProgress?: number;
	/** × button — remove this side (active only). */
	onDelete?: () => void;
}

export interface TimelineEditorProps {
	videoDuration: number;
	currentTime: number;
	playheadTime?: number;
	onSeek?: (time: number) => void;
	/** Intro/outro blocks pinned to the left/right edges of the track. */
	endcaps?: { intro?: TimelineEndcap; outro?: TimelineEndcap };
	cursorTelemetry?: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger?: number;
	onAutoSuggestZoomsConsumed?: () => void;
	disableSuggestedZooms?: boolean;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions?: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
	clipRegions?: ClipRegion[];
	onClipSplit?: (splitMs: number) => void;
	onTrimToEnd?: (cutMs: number) => void;
	onAddSpeedPoint?: (markerMs: number) => void;
	onShiftMarker?: (ms: number) => void;
	pendingMarkerMs?: number | null;
	onClipSpanChange?: (id: string, span: Span) => void;
	onClipDelete?: (id: string) => void;
	onClipMutedChange?: (muted: boolean) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	annotationRegions?: AnnotationRegion[];
	onAnnotationAdded?: (span: Span, trackIndex?: number) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions?: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	selectedSpeedId?: string | null;
	onSelectSpeed?: (id: string | null) => void;
	audioRegions?: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	videoPath?: string | null;
	videoSourcePath?: string | null;
	cursorTelemetrySourcePath?: string | null;
	showSourceAudioTrack?: boolean;
	onSourceAudioAvailabilityChange?: (available: boolean) => void;
	sourceAudioTrackSettings?: SourceAudioTrackSettings;
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	onSourceAudioTracksMetaChange?: (tracks: SourceAudioTrackMeta) => void;
}

function extractLocalPathFromMediaServerUrl(input: string | null | undefined): string | null {
	if (!input) return null;
	try {
		const url = new URL(input);
		const isLocalMediaServer =
			(url.protocol === "http:" || url.protocol === "https:") &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.pathname === "/video";
		if (!isLocalMediaServer) return null;
		return url.searchParams.get("path");
	} catch {
		return null;
	}
}

export interface TimelineEditorHandle {
	addZoom: () => void;
	suggestZooms: () => void;
	splitClip: () => void;
	trimToEnd: () => void;
	addSpeedPoint: () => void;
	addAnnotation: (trackIndex?: number) => void;
	addAudio: (trackIndex?: number) => Promise<void>;
	keyframes: { id: string; time: number }[];
}

const TimelineEditor = forwardRef<TimelineEditorHandle, TimelineEditorProps>(
	function TimelineEditor(
		{
			videoDuration,
			currentTime,
			playheadTime,
			onSeek,
			endcaps,
			cursorTelemetry = [],
			autoSuggestZoomsTrigger = 0,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms = false,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions = [],
			onTrimSpanChange,
			clipRegions = [],
			onClipSplit,
			onTrimToEnd,
			onAddSpeedPoint,
			onShiftMarker,
			pendingMarkerMs,
			onClipSpanChange,
			onClipDelete,
			onClipMutedChange,
			selectedClipId,
			onSelectClip,
			annotationRegions = [],
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions = [],
			onSpeedSpanChange,
			selectedSpeedId,
			onSelectSpeed,
			audioRegions = [],
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			showSourceAudioTrack = false,
			onSourceAudioAvailabilityChange,
			sourceAudioTrackSettings = {},
			getSourceAudioTrackSettingsForClip,
			onSourceAudioTracksMetaChange,
		},
		ref,
	) {
		const t = useScopedT("settings");
		const totalMs = useMemo(
			() => Math.max(0, Math.round(videoDuration * 1000)),
			[videoDuration],
		);
		const currentTimeMs = useMemo(
			() => Math.round((playheadTime ?? currentTime) * 1000),
			[currentTime, playheadTime],
		);
		const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
		const safeMinDurationMs = useMemo(
			() =>
				totalMs > 0
					? Math.min(timelineScale.minItemDurationMs, totalMs)
					: timelineScale.minItemDurationMs,
			[timelineScale.minItemDurationMs, totalMs],
		);

		const timelineContainerRef = useRef<HTMLDivElement>(null);
		const isTimelineFocusedRef = useRef(false);
		const { setRange, clampedRange } = useTimelineRange({
			totalMs,
			timelineContainerRef,
		});

		// Drag-to-zoom slider state. The visible-range WIDTH is the zoom; the slider
		// maps a 0 (out) … 1 (in) fraction to that width (log-scaled, playhead-anchored)
		// for fast DaVinci-style zooming instead of the slow scroll gesture. The
		// fraction is DERIVED from clampedRange so wheel/pinch moves the thumb too.
		const minVisibleRangeMs = timelineScale.minVisibleRangeMs;
		const visibleSpanMs = Math.max(1, clampedRange.end - clampedRange.start);
		const canZoom = totalMs > minVisibleRangeMs;
		const zoomFraction = spanToFraction(visibleSpanMs, totalMs, minVisibleRangeMs);
		const applyZoomFraction = (fraction: number) => {
			if (!canZoom) return;
			setRange(computeZoomedRange(fraction, totalMs, minVisibleRangeMs, currentTimeMs));
		};

		const [liveSpanPreviewById, setLiveSpanPreviewById] = useState<Record<string, Span>>({});
		const liveZoomPreview = useMemo(() => {
			const previewSpans: Record<string, Span> = { ...liveSpanPreviewById };
			const hiddenZoomIds = new Set<string>();

			for (const [previewId, previewSpan] of Object.entries(liveSpanPreviewById)) {
				const oldClip = clipRegions.find((clip) => clip.id === previewId);
				if (!oldClip) continue;

				const newStart = Math.round(previewSpan.start);
				const newEnd = Math.round(previewSpan.end);
				const removedSegments = [
					...(newStart > oldClip.startMs
						? [{ startMs: oldClip.startMs, endMs: newStart }]
						: []),
					...(newEnd < oldClip.endMs ? [{ startMs: newEnd, endMs: oldClip.endMs }] : []),
				];

				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				const isMove = Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;

				if (isMove) {
					const delta = startDelta;
					for (const zoom of zoomRegions) {
						const overlaps =
							zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs;
						if (!overlaps) continue;
						previewSpans[zoom.id] = {
							start: zoom.startMs + delta,
							end: zoom.endMs + delta,
						};
					}
				}

				if (removedSegments.length > 0) {
					for (const zoom of zoomRegions) {
						const removed = removedSegments.some(
							(segment) =>
								zoom.startMs < segment.endMs && zoom.endMs > segment.startMs,
						);
						if (removed) hiddenZoomIds.add(zoom.id);
					}
				}
			}

			return { previewSpans, hiddenZoomIds };
		}, [clipRegions, liveSpanPreviewById, zoomRegions]);
		const { shortcuts: keyShortcuts, isMac } = useShortcuts();
		const { peaks: sourceAudioPeaks, loading: sourceAudioLoading } =
			useTimelineAudioPeaks(videoPath);
		const localSourcePath = useMemo(() => {
			if (!videoPath) return null;
			return (
				extractLocalPathFromMediaServerUrl(videoPath) ||
				(/^file:\/\//i.test(videoPath) ? fromFileUrl(videoPath) : videoPath)
			);
		}, [videoPath]);
		const micSidecarPaths = useMemo(
			() => (localSourcePath ? buildSourceSidecarPathCandidates(localSourcePath, "mic") : []),
			[localSourcePath],
		);
		const micSidecarFallbackPaths = useMemo(() => micSidecarPaths.slice(1), [micSidecarPaths]);
		const systemSidecarPaths = useMemo(
			() =>
				localSourcePath ? buildSourceSidecarPathCandidates(localSourcePath, "system") : [],
			[localSourcePath],
		);
		const systemSidecarFallbackPaths = useMemo(
			() => systemSidecarPaths.slice(1),
			[systemSidecarPaths],
		);
		const { peaks: micSidecarPeaks, loading: micSidecarLoading } = useTimelineAudioPeaks(
			micSidecarPaths[0] ?? null,
			{ fallbackResources: micSidecarFallbackPaths },
		);
		const { peaks: systemSidecarPeaks, loading: systemSidecarLoading } = useTimelineAudioPeaks(
			systemSidecarPaths[0] ?? null,
			{
				fallbackResources: systemSidecarFallbackPaths,
			},
		);
		const sourceAudioTracks = useMemo(
			() =>
				buildTimelineSourceAudioTracks({
					sourceAudioPeaks,
					micSidecarPeaks,
					systemSidecarPeaks,
					labels: {
						system: t("audio.systemLabel", "Source System"),
						mic: t("audio.micLabel", "Source Mic"),
						mixed: t("audio.mixedLabel", "Source"),
					},
				}),
			[micSidecarPeaks, sourceAudioPeaks, systemSidecarPeaks, t],
		);

		const isLoading = useMemo(() => {
			// If we are still actively trying to load audio peaks (main or sidecars)
			if (videoPath && (sourceAudioLoading || micSidecarLoading || systemSidecarLoading))
				return true;

			// Robust telemetry loading detection:
			// If a source path is set but telemetry hasn't arrived (or failed/retried) for it yet.
			if (videoSourcePath && cursorTelemetrySourcePath !== videoSourcePath) return true;

			return false;
		}, [
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			sourceAudioLoading,
			micSidecarLoading,
			systemSidecarLoading,
		]);
		useEffect(() => {
			onSourceAudioTracksMetaChange?.(
				sourceAudioTracks.map((t) => ({ id: t.id, label: t.label })),
			);
		}, [onSourceAudioTracksMetaChange, sourceAudioTracks]);
		void sourceAudioTrackSettings;
		useEffect(() => {
			onSourceAudioAvailabilityChange?.(sourceAudioTracks.length > 0);
		}, [onSourceAudioAvailabilityChange, sourceAudioTracks.length]);

		const {
			keyframes,
			selectedKeyframeId,
			setSelectedKeyframeId,
			selectAllBlocksActive,
			setSelectAllBlocksActive,
			handleKeyframeMove,
			clearSelectedBlocks,
			handleSelectZoom,
			handleSelectClip,
			handleSelectAnnotation,
			handleSelectAudio,
			hasOverlap,
			timelineItems,
			allRegionSpans,
			getResolvedDropRowId,
			handleItemSpanChange,
			canPlaceZoomAtMs,
			addZoomAtMs,
		} = useTimelineEditorRuntime({
			ref,
			videoDuration,
			totalMs,
			currentTimeMs,
			safeMinDurationMs,
			cursorTelemetry,
			autoSuggestZoomsTrigger,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions,
			onTrimSpanChange,
			clipRegions,
			onClipSplit,
			onTrimToEnd,
			onAddSpeedPoint,
			onClipSpanChange,
			onClipDelete,
			onClipMutedChange,
			selectedClipId,
			onSelectClip,
			annotationRegions,
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions,
			onSpeedSpanChange,
			audioRegions,
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			isMac,
			keyShortcuts,
			isTimelineFocusedRef,
		});

		if (!videoDuration || videoDuration === 0) {
			return (
				<div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-editor-surface gap-3">
					<div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center">
						<Plus className="w-6 h-6 text-muted-foreground" />
					</div>
					<div className="text-center">
						<p className="text-sm font-medium text-muted-foreground">No Video Loaded</p>
						<p className="text-xs text-muted-foreground/70 mt-1">
							Drag and drop a video to start editing
						</p>
					</div>
				</div>
			);
		}

		return (
			<div className="flex-1 min-h-0 flex flex-col bg-editor-bg overflow-hidden">
				<div className="flex items-center justify-end gap-1.5 px-3 py-1 border-b border-white/5 select-none">
					<button
						type="button"
						disabled={!canZoom}
						onClick={() => applyZoomFraction(Math.max(0, zoomFraction - 0.12))}
						className="p-1 rounded text-foreground/70 hover:bg-white/10 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
						title="Zoom out"
						aria-label="Zoom out timeline"
					>
						<MagnifyingGlassMinus size={15} weight="bold" />
					</button>
					<input
						type="range"
						min={0}
						max={1}
						step={0.001}
						value={zoomFraction}
						disabled={!canZoom}
						onChange={(event) => applyZoomFraction(Number(event.target.value))}
						className={`w-36 ${zoomStyles.slider}`}
						aria-label="Timeline zoom"
						title="Drag to zoom the timeline"
					/>
					<button
						type="button"
						disabled={!canZoom}
						onClick={() => applyZoomFraction(Math.min(1, zoomFraction + 0.12))}
						className="p-1 rounded text-foreground/70 hover:bg-white/10 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
						title="Zoom in"
						aria-label="Zoom in timeline"
					>
						<MagnifyingGlassPlus size={15} weight="bold" />
					</button>
					<span className="ml-1 w-12 text-right text-[11px] tabular-nums text-foreground/45">
						{(visibleSpanMs / 1000).toFixed(visibleSpanMs < 10_000 ? 1 : 0)}s
					</span>
				</div>
				<div className="flex flex-1 min-h-0">
					{endcaps?.intro ? <EndcapGutter endcap={endcaps.intro} side="intro" /> : null}
					<div
						ref={timelineContainerRef}
						// Scroll stays functional; the scrollbar is hidden (a visible bar looked
						// unpolished). Hides in Chromium/Electron (::-webkit-scrollbar) + Firefox.
						className="flex-1 min-h-0 overflow-auto bg-editor-bg relative [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
						tabIndex={0}
						onFocus={() => {
							isTimelineFocusedRef.current = true;
						}}
						onBlur={() => {
							isTimelineFocusedRef.current = false;
						}}
						onMouseDown={() => {
							timelineContainerRef.current?.focus();
							isTimelineFocusedRef.current = true;
						}}
						onClick={() => {
							setSelectedKeyframeId(null);
							setSelectAllBlocksActive(false);
						}}
					>
						<TimelineWrapper
							range={clampedRange}
							videoDuration={videoDuration}
							hasOverlap={hasOverlap}
							onRangeChange={setRange}
							minItemDurationMs={timelineScale.minItemDurationMs}
							minVisibleRangeMs={timelineScale.minVisibleRangeMs}
							onItemSpanChange={handleItemSpanChange}
							resolveTargetRowId={getResolvedDropRowId}
							allRegionSpans={allRegionSpans}
							onLiveSpanPreviewChange={(id, span) => {
								setLiveSpanPreviewById((prev) => {
									if (!span) {
										if (!(id in prev)) return prev;
										const next = { ...prev };
										delete next[id];
										return next;
									}
									const current = prev[id];
									if (
										current &&
										current.start === span.start &&
										current.end === span.end
									) {
										return prev;
									}
									return { ...prev, [id]: span };
								});
							}}
						>
							<KeyframeMarkers
								keyframes={keyframes}
								selectedKeyframeId={selectedKeyframeId}
								setSelectedKeyframeId={setSelectedKeyframeId}
								onKeyframeMove={handleKeyframeMove}
								videoDurationMs={totalMs}
								timelineRef={timelineContainerRef}
							/>
							<TimelineCanvas
								items={timelineItems}
								videoDurationMs={totalMs}
								currentTimeMs={currentTimeMs}
								onSeek={onSeek}
								onShiftMarker={onShiftMarker}
								pendingMarkerMs={pendingMarkerMs}
								onAddZoomAtMs={addZoomAtMs}
								canPlaceZoomAtMs={canPlaceZoomAtMs}
								onSelectZoom={handleSelectZoom}
								onSelectSpeed={onSelectSpeed}
								onSelectClip={handleSelectClip}
								onSelectAnnotation={handleSelectAnnotation}
								onSelectAudio={handleSelectAudio}
								selectedZoomId={selectedZoomId}
								selectedSpeedId={selectedSpeedId}
								selectedClipId={selectedClipId}
								selectedAnnotationId={selectedAnnotationId}
								selectedAudioId={selectedAudioId}
								selectAllBlocksActive={selectAllBlocksActive}
								onClearBlockSelection={clearSelectedBlocks}
								keyframes={keyframes}
								sourceAudioTracks={sourceAudioTracks}
								getSourceAudioTrackSettingsForClip={
									getSourceAudioTrackSettingsForClip
								}
								showSourceAudioTrack={showSourceAudioTrack}
								liveSpanPreviewById={liveZoomPreview.previewSpans}
								liveHiddenItemIds={Array.from(liveZoomPreview.hiddenZoomIds)}
								isLoading={isLoading}
							/>
						</TimelineWrapper>
					</div>
					{endcaps?.outro ? <EndcapGutter endcap={endcaps.outro} side="outro" /> : null}
				</div>
			</div>
		);
	},
);

/**
 * One intro/outro bookend in a fixed side gutter. The block is a unified
 * scrub/play surface: a click previews the card, a drag scrubs a frozen frame
 * into the preview, a mini-playhead sweeps across it during playback, and the
 * pencil/× edit and remove the side.
 */
function EndcapGutter({ endcap, side }: { endcap: TimelineEndcap; side: "intro" | "outro" }) {
	const blockRef = useRef<HTMLDivElement | null>(null);
	const sweepRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{ startX: number; moved: boolean } | null>(null);
	const scrubbable = endcap.active && !!endcap.onScrub;

	// The block is inset inside the 104px gutter; the playhead sweeps across that
	// inset span so it lines up with the card block (matching the main playhead).
	const insetLeft = side === "intro" ? 4 : 2;
	const sweepRangePx = 104 - 6; // gutter (104) − total horizontal insets (4 + 2)

	// Drive the blue playhead: pinned while scrubbing, else swept 0→100% over the
	// card duration via WAAPI (no per-frame React state, no CSS keyframe injection).
	useEffect(() => {
		const el = sweepRef.current;
		if (!el) return;
		if (endcap.scrubProgress !== undefined) {
			const p = Math.min(1, Math.max(0, endcap.scrubProgress));
			el.style.opacity = "1";
			el.style.left = `${insetLeft + p * sweepRangePx}px`;
			return;
		}
		if (!endcap.playing || !endcap.durationMs) {
			el.style.opacity = "0";
			el.style.left = `${insetLeft}px`;
			return;
		}
		el.style.opacity = "1";
		const anim = el.animate(
			[{ left: `${insetLeft}px` }, { left: `${insetLeft + sweepRangePx}px` }],
			{ duration: endcap.durationMs, easing: "linear", fill: "forwards" },
		);
		return () => anim.cancel();
	}, [endcap.playing, endcap.durationMs, endcap.scrubProgress, insetLeft]);

	const fractionAt = (clientX: number) => {
		const rect = blockRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return 0;
		return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
	};

	return (
		<div className="relative shrink-0" style={{ width: 104 }}>
			<div
				ref={blockRef}
				role="button"
				tabIndex={0}
				onPointerDown={(e) => {
					if (!scrubbable) return;
					dragRef.current = { startX: e.clientX, moved: false };
					blockRef.current?.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => {
					const d = dragRef.current;
					if (!d) return;
					if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
					d.moved = true;
					endcap.onScrub?.(fractionAt(e.clientX));
				}}
				onPointerUp={(e) => {
					const d = dragRef.current;
					dragRef.current = null;
					blockRef.current?.releasePointerCapture?.(e.pointerId);
					if (d?.moved) endcap.onScrubEnd?.();
					else endcap.onClick();
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						endcap.onClick();
					}
				}}
				className={endcapClass(endcap.active)}
				style={{
					position: "absolute",
					top: TIMELINE_AXIS_HEIGHT_PX,
					left: side === "intro" ? 4 : 2,
					right: side === "intro" ? 2 : 4,
					height: TIMELINE_ROW_MAX_HEIGHT_PX,
					cursor: scrubbable ? "ew-resize" : "pointer",
					overflow: "hidden",
					touchAction: "none",
				}}
			>
				{side === "intro" ? `▶ ${endcap.label}` : `${endcap.label} ◀`}
			</div>
			{/* Blue playhead — lives in the gutter (not the clipped block) so it spans
			    the full timeline height like the main playhead. */}
			<div
				ref={sweepRef}
				className="pointer-events-none absolute z-20 w-0.5 bg-[#2563EB] shadow-[0_0_6px_rgba(37,99,235,0.9)]"
				style={{
					opacity: 0,
					left: `${insetLeft}px`,
					top: TIMELINE_AXIS_HEIGHT_PX,
					bottom: 0,
				}}
			>
				<div className="absolute -left-[3px] -top-[3px] h-2 w-2 rounded-full bg-[#2563EB] shadow-[0_0_4px_rgba(37,99,235,0.9)]" />
			</div>
			{endcap.onEdit ? (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						endcap.onEdit?.();
					}}
					aria-label={`Edit ${side}`}
					className="absolute z-10 rounded bg-black/55 p-0.5 text-white/80 hover:text-white"
					style={{ top: TIMELINE_AXIS_HEIGHT_PX + 3, right: 6 }}
				>
					<PencilSimple className="h-3 w-3" weight="bold" />
				</button>
			) : null}
			{endcap.active && endcap.onDelete ? (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						endcap.onDelete?.();
					}}
					aria-label={`Delete ${side}`}
					className="absolute z-10 rounded bg-black/55 p-0.5 text-white/80 hover:text-red-400"
					style={{ top: TIMELINE_AXIS_HEIGHT_PX + 3, left: side === "intro" ? 8 : 6 }}
				>
					<X className="h-3 w-3" weight="bold" />
				</button>
			) : null}
		</div>
	);
}

function endcapClass(active: boolean): string {
	return [
		"flex items-center justify-center gap-1 rounded-md px-1 text-[10px] font-semibold transition-colors",
		active
			? "border border-[#2563EB]/50 bg-[#2563EB]/30 text-white hover:bg-[#2563EB]/45"
			: "border border-dashed border-white/20 bg-black/40 text-white/60 hover:bg-black/60",
	].join(" ");
}

TimelineEditor.displayName = "TimelineEditor";

export default TimelineEditor;
