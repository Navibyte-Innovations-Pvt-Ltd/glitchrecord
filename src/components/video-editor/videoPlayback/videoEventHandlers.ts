import type React from "react";
import { extensionHost } from "@/lib/extensions";
import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import type { SpeedRegion, TrimRegion } from "../types";

interface PresentedFrameMetadata {
	mediaTime?: number;
}

type PresentedFrameVideoElement = HTMLVideoElement & {
	requestVideoFrameCallback?: (
		callback: (now: DOMHighResTimeStamp, metadata: PresentedFrameMetadata) => void,
	) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

interface VideoEventHandlersParams {
	video: HTMLVideoElement;
	isSeekingRef: React.MutableRefObject<boolean>;
	isPlayingRef: React.MutableRefObject<boolean>;
	allowPlaybackRef: React.MutableRefObject<boolean>;
	currentTimeRef: React.MutableRefObject<number>;
	timeUpdateAnimationRef: React.MutableRefObject<number | null>;
	onPlayStateChange: (playing: boolean) => void;
	onTimeUpdate: (time: number) => void;
	trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
	speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
	// SOURCE time (ms) where the edited timeline ends — i.e. the last clip's source-end.
	// Playback stops here instead of running into the trailing un-clipped recording. null
	// = no clamp (stop at the natural video end). Without this, a project whose clips end
	// before the recording does keeps playing invisible trailing source past the marker,
	// which both causes the end-of-play flicker and leaves the timeline unresponsive.
	playbackEndSourceMsRef?: React.MutableRefObject<number | null>;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
	const {
		video,
		isSeekingRef,
		isPlayingRef,
		allowPlaybackRef,
		currentTimeRef,
		timeUpdateAnimationRef,
		onPlayStateChange,
		onTimeUpdate,
		trimRegionsRef,
		speedRegionsRef,
		playbackEndSourceMsRef,
	} = params;

	// The source second at which playback must stop: the timeline content end, clamped
	// to the real media duration.
	const getPlaybackEndSec = (): number => {
		const endMs = playbackEndSourceMsRef?.current;
		const endSec =
			endMs != null && Number.isFinite(endMs) ? endMs / 1000 : Number.POSITIVE_INFINITY;
		return Math.min(video.duration, endSec);
	};
	const presentedFrameVideo = video as PresentedFrameVideoElement;
	let videoFrameRequestId: number | null = null;
	// Watchdog state: timestamp of the last presented frame + how long the loop may
	// go without one before the rAF fallback re-pumps it (see scheduleNextUpdate).
	let lastPresentedAtMs = performance.now();
	const STALL_THRESHOLD_MS = 200;
	enablePitchPreservingPlayback(video);

	const emitTime = (timeValue: number) => {
		currentTimeRef.current = timeValue * 1000;
		onTimeUpdate(timeValue);
		extensionHost.emitEvent({ type: "playback:timeupdate", timeMs: timeValue * 1000 });
	};

	// Helper function to check if current time is within a trim region
	const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
		const trimRegions = trimRegionsRef.current;
		return (
			trimRegions.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	// Helper function to find the active speed region at the current time
	const findActiveSpeedRegion = (currentTimeMs: number): SpeedRegion | null => {
		return (
			speedRegionsRef.current.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	const skipPastTrimRegion = (trimRegion: TrimRegion) => {
		const skipToTime = trimRegion.endMs / 1000;
		const playbackEndSec = getPlaybackEndSec();
		const clampedSkipToTime = Math.min(skipToTime, playbackEndSec);

		video.currentTime = clampedSkipToTime;
		emitTime(clampedSkipToTime);

		if (clampedSkipToTime >= playbackEndSec) {
			video.pause();
		}
	};

	const cancelScheduledUpdate = () => {
		if (timeUpdateAnimationRef.current !== null) {
			cancelAnimationFrame(timeUpdateAnimationRef.current);
			timeUpdateAnimationRef.current = null;
		}

		if (
			videoFrameRequestId !== null &&
			typeof presentedFrameVideo.cancelVideoFrameCallback === "function"
		) {
			presentedFrameVideo.cancelVideoFrameCallback(videoFrameRequestId);
			videoFrameRequestId = null;
		}
	};

	const scheduleNextUpdate = () => {
		if (video.paused || video.ended) {
			return;
		}

		// Align editor state with the frame Chromium actually presented instead of
		// polling `currentTime` on a generic animation frame.
		if (typeof presentedFrameVideo.requestVideoFrameCallback === "function") {
			videoFrameRequestId = presentedFrameVideo.requestVideoFrameCallback(
				(_now, metadata) => {
					videoFrameRequestId = null;
					// A frame was presented → cancel the stall watchdog below.
					if (timeUpdateAnimationRef.current !== null) {
						cancelAnimationFrame(timeUpdateAnimationRef.current);
						timeUpdateAnimationRef.current = null;
					}
					lastPresentedAtMs = performance.now();
					updateTime(metadata);
				},
			);
			// Watchdog: requestVideoFrameCallback ONLY fires when Chromium presents a
			// new frame. At a speed/trim-region boundary the seek can stop presenting
			// frames, so rVFC never re-fires and this loop dies *silently* — the video
			// freezes while playback stays "playing" (no pause) and the separate audio
			// element free-runs. A parallel rAF re-pumps the loop if no frame has
			// presented for STALL_THRESHOLD_MS, so it can never get stuck.
			const watchdogTick = () => {
				timeUpdateAnimationRef.current = null;
				if (video.paused || video.ended) {
					return;
				}
				if (performance.now() - lastPresentedAtMs >= STALL_THRESHOLD_MS) {
					if (
						videoFrameRequestId !== null &&
						typeof presentedFrameVideo.cancelVideoFrameCallback === "function"
					) {
						presentedFrameVideo.cancelVideoFrameCallback(videoFrameRequestId);
						videoFrameRequestId = null;
					}
					updateTime();
					return;
				}
				timeUpdateAnimationRef.current = requestAnimationFrame(watchdogTick);
			};
			timeUpdateAnimationRef.current = requestAnimationFrame(watchdogTick);
			return;
		}

		timeUpdateAnimationRef.current = requestAnimationFrame(() => {
			timeUpdateAnimationRef.current = null;
			updateTime();
		});
	};

	function getPresentedTime(metadata?: PresentedFrameMetadata): number {
		const mediaTime = metadata?.mediaTime;
		return Number.isFinite(mediaTime) ? (mediaTime ?? 0) : video.currentTime;
	}

	function updateTime(metadata?: PresentedFrameMetadata) {
		if (!video) return;

		const presentedTime = getPresentedTime(metadata);

		// Reached the end of the edited timeline → stop here instead of playing into the
		// trailing un-clipped recording (which left the marker overshooting and the
		// timeline unresponsive). Land exactly on the content end so the playhead sticks.
		const playbackEndSec = getPlaybackEndSec();
		if (Number.isFinite(playbackEndSec) && presentedTime >= playbackEndSec - 0.001) {
			if (!video.paused) {
				// Park the element EXACTLY on the content end before pausing. Otherwise the
				// pause event fires handlePause, which re-emits the element's currentTime —
				// and that lags the presented frame, flicking the marker left for a moment.
				try {
					video.currentTime = playbackEndSec;
				} catch {
					/* element not seekable yet — emit still clamps below */
				}
				video.pause();
			}
			emitTime(playbackEndSec);
			return;
		}

		const currentTimeMs = presentedTime * 1000;
		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// If we're in a trim region during playback, skip to the end of it
		if (activeTrimRegion && !video.paused && !video.ended) {
			skipPastTrimRegion(activeTrimRegion);
		} else {
			// Apply playback speed from active speed region
			const activeSpeedRegion = findActiveSpeedRegion(currentTimeMs);
			enablePitchPreservingPlayback(video);
			video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
			emitTime(presentedTime);
		}

		scheduleNextUpdate();
	}

	const handlePlay = () => {
		if (!allowPlaybackRef.current) {
			video.pause();
			return;
		}

		isPlayingRef.current = true;
		onPlayStateChange(true);
		lastPresentedAtMs = performance.now();
		cancelScheduledUpdate();
		scheduleNextUpdate();
	};

	const handlePause = () => {
		isPlayingRef.current = false;
		onPlayStateChange(false);
		cancelScheduledUpdate();
		// Never report a time past the content end (defends the marker against a pause
		// that lands in the trailing source).
		const playbackEndSec = getPlaybackEndSec();
		const pausedTime = Number.isFinite(playbackEndSec)
			? Math.min(video.currentTime, playbackEndSec)
			: video.currentTime;
		emitTime(pausedTime);
	};

	const handleSeeked = () => {
		isSeekingRef.current = false;

		const currentTimeMs = video.currentTime * 1000;
		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// Never leave the preview parked on removed footage after a seek.
		if (activeTrimRegion) {
			skipPastTrimRegion(activeTrimRegion);
		} else {
			emitTime(video.currentTime);
		}
	};

	const handleSeeking = () => {
		isSeekingRef.current = true;
		emitTime(video.currentTime);
	};

	return {
		dispose: cancelScheduledUpdate,
		handlePlay,
		handlePause,
		handleSeeked,
		handleSeeking,
	};
}
