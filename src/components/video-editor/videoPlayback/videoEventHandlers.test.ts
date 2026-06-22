import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/extensions", () => ({
	extensionHost: {
		emitEvent: vi.fn(),
	},
}));

import { extensionHost } from "@/lib/extensions";
import { createVideoEventHandlers } from "./videoEventHandlers";

type PresentedFrameCallback = (now: DOMHighResTimeStamp, metadata: { mediaTime?: number }) => void;

type MockVideo = HTMLVideoElement & {
	requestVideoFrameCallback?: (callback: PresentedFrameCallback) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

function createMutableRef<T>(value: T) {
	return { current: value };
}

function createMockVideo(overrides: Partial<MockVideo> = {}): MockVideo {
	const video = {
		currentTime: 0.5,
		duration: 10,
		paused: false,
		ended: false,
		playbackRate: 1,
		pause: vi.fn(),
	} as unknown as MockVideo;

	return Object.assign(video, overrides);
}

describe("createVideoEventHandlers", () => {
	const emitEventMock = vi.mocked(extensionHost.emitEvent);
	let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
	let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		requestAnimationFrameMock = vi.fn(() => 11);
		cancelAnimationFrameMock = vi.fn();
		vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
		vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
		emitEventMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("prefers requestVideoFrameCallback mediaTime when available", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 7;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onPlayStateChange = vi.fn();
		const onTimeUpdate = vi.fn();
		const currentTimeRef = createMutableRef(0);
		const timeUpdateAnimationRef = createMutableRef<number | null>(null);

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef,
			timeUpdateAnimationRef,
			onPlayStateChange,
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expect(onPlayStateChange).toHaveBeenCalledWith(true);
		expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
		// A stall-watchdog rAF is armed alongside rVFC so the loop can never die
		// silently at a region boundary, but timing still comes from the presented
		// frame below — not from polling currentTime on the rAF.
		expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

		presentedFrameCallback?.(0, { mediaTime: 1.25 });

		expect(onTimeUpdate).toHaveBeenCalledWith(1.25);
		expect(currentTimeRef.current).toBe(1250);
		expect(emitEventMock).toHaveBeenLastCalledWith({
			type: "playback:timeupdate",
			timeMs: 1250,
		});
	});

	it("falls back to requestAnimationFrame when requestVideoFrameCallback is unavailable", () => {
		let animationFrameCallback: FrameRequestCallback | null = null;
		requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
			animationFrameCallback = callback;
			return 19;
		});
		const video = createMockVideo({ currentTime: 0.75 });
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

		video.paused = true;
		animationFrameCallback?.(0);

		expect(onTimeUpdate).toHaveBeenCalledWith(0.75);
	});

	it("skips removed footage when playback reaches a cut region", () => {
		let animationFrameCallback: FrameRequestCallback | null = null;
		requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
			animationFrameCallback = callback;
			return 29;
		});
		const video = createMockVideo({ currentTime: 1.25, duration: 10 });
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "trim-1", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		animationFrameCallback?.(0);

		expect(video.currentTime).toBe(2);
		expect(video.pause).not.toHaveBeenCalled();
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});

	it("cancels a pending requestVideoFrameCallback on pause and dispose", () => {
		const cancelVideoFrameCallback = vi.fn();
		const video = createMockVideo({
			requestVideoFrameCallback: vi.fn(() => 23),
			cancelVideoFrameCallback,
		});
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate: vi.fn(),
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		handlers.handlePause();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);

		cancelVideoFrameCallback.mockClear();
		handlers.handlePlay();
		handlers.dispose();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);
	});

	it("stops at the timeline content end instead of playing into trailing source", () => {
		// The recording is 10s but the edited timeline ends at 6s of source (last clip).
		// Without the clamp, playback ran on to 10s invisibly past the marker — causing
		// the end-of-play flicker + an unresponsive timeline. It must pause AT 6s.
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			currentTime: 6.2,
			duration: 10,
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 31;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
			playbackEndSourceMsRef: createMutableRef<number | null>(6_000),
		});

		handlers.handlePlay();
		// A frame is presented past the content end.
		presentedFrameCallback?.(0, { mediaTime: 6.2 });

		expect(video.pause).toHaveBeenCalled();
		// Playhead lands exactly on the content end (6s), not the trailing 6.2/10.
		expect(onTimeUpdate).toHaveBeenLastCalledWith(6);
	});

	it("keeps playing normally before the content end (no premature stop)", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			currentTime: 3,
			duration: 10,
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 33;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
			playbackEndSourceMsRef: createMutableRef<number | null>(6_000),
		});

		handlers.handlePlay();
		presentedFrameCallback?.(0, { mediaTime: 3 });

		expect(video.pause).not.toHaveBeenCalled();
		expect(onTimeUpdate).toHaveBeenLastCalledWith(3);
	});

	it("skips removed footage after a paused seek", () => {
		const video = createMockVideo({
			currentTime: 1.25,
			paused: true,
		});
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(true),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "trim-1", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handleSeeked();

		expect(video.currentTime).toBe(2);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});
});
