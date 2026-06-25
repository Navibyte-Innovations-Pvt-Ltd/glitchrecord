// Chrome silently caps an <video> element's EFFECTIVE playbackRate around 16×.
// Setting clip.speed = 21.55 on the element does not play 21.55× faster — the
// element stops presenting frames, requestVideoFrameCallback never re-fires, and
// the preview FREEZES while the separate (1×) narration audio keeps playing.
//
// Fix: never hand the element a rate above the native ceiling. For the portion
// of speed above the ceiling, advance the preview by SEEKING currentTime forward
// each watchdog tick (a fast scrub) so the frame keeps moving and stays in sync
// with the playhead, which maps timeline→source at the full requested speed.

export const MAX_NATIVE_PLAYBACK_RATE = 16;

/** The rate that is safe to assign to HTMLMediaElement.playbackRate. */
export function clampPlaybackRate(speed: number): number {
	if (!Number.isFinite(speed) || speed <= 0) {
		return 1;
	}
	return Math.min(MAX_NATIVE_PLAYBACK_RATE, speed);
}

/** True when the requested speed is faster than the element can natively play. */
export function exceedsNativeRate(speed: number): boolean {
	return Number.isFinite(speed) && speed > MAX_NATIVE_PLAYBACK_RATE;
}

/**
 * Where to seek the video's currentTime so the preview keeps advancing at the
 * full requested speed even though the element is pinned at the native ceiling.
 *
 * The element already advances on its own at the clamped native rate; this adds
 * the MISSING delta (requested − native) for the elapsed wall-clock so the total
 * apparent rate equals `targetSpeed`. Result is clamped to `endSec` so playback
 * never seeks past the content end. Returns `currentSec` unchanged when no manual
 * advance is needed (speed at/below the native ceiling, or no time elapsed).
 */
export function computeManualSeekTarget(params: {
	currentSec: number;
	wallDeltaMs: number;
	targetSpeed: number;
	endSec: number;
}): number {
	const { currentSec, wallDeltaMs, targetSpeed, endSec } = params;
	if (!Number.isFinite(currentSec)) {
		return currentSec;
	}
	const nativeRate = clampPlaybackRate(targetSpeed);
	if (!(wallDeltaMs > 0) || targetSpeed <= nativeRate) {
		return currentSec;
	}
	const missingRate = targetSpeed - nativeRate;
	const advanced = currentSec + (wallDeltaMs / 1000) * missingRate;
	if (Number.isFinite(endSec)) {
		return Math.min(advanced, endSec);
	}
	return advanced;
}
