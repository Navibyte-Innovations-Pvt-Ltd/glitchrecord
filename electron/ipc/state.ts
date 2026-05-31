import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
	CursorInteractionType,
	CursorTelemetryPoint,
	CursorVisualType,
	NativeCaptureDiagnostics,
	RecordingSessionData,
	SelectedSource,
	SystemCursorAsset,
	WindowBounds,
} from "./types";

// ── Source selection ──────────────────────────────────────────────────────────
export let selectedSource: SelectedSource | null = null;

// ── Project / video state ─────────────────────────────────────────────────────
export let currentProjectPath: string | null = null;
export let currentVideoPath: string | null = null;
export let currentRecordingSession: RecordingSessionData | null = null;

// ── Security: approved read paths ─────────────────────────────────────────────
export const approvedLocalReadPaths = new Set<string>();

// ── Native macOS capture ──────────────────────────────────────────────────────
export let nativeScreenRecordingActive = false;
export let nativeCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let nativeCaptureOutputBuffer = "";
export let nativeCaptureTargetPath: string | null = null;
export let nativeCaptureStopRequested = false;
export let nativeCaptureSystemAudioPath: string | null = null;
export let nativeCaptureMicrophonePath: string | null = null;
export let nativeCapturePaused = false;

// ── Native cursor monitor ─────────────────────────────────────────────────────
export let nativeCursorMonitorProcess: ChildProcessWithoutNullStreams | null = null;
export let nativeCursorMonitorOutputBuffer = "";

// ── Windows native capture ────────────────────────────────────────────────────
export let windowsCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let windowsCaptureOutputBuffer = "";
export let windowsCaptureTargetPath: string | null = null;
export let windowsNativeCaptureActive = false;
export let windowsCaptureStopRequested = false;
export let windowsCapturePaused = false;
export let windowsSystemAudioPath: string | null = null;
export let windowsMicAudioPath: string | null = null;
export let windowsOrphanedMicAudioPath: string | null = null;
export let windowsPendingVideoPath: string | null = null;

// ── Diagnostics ───────────────────────────────────────────────────────────────
export let lastNativeCaptureDiagnostics: NativeCaptureDiagnostics | null = null;

// ── FFmpeg capture ────────────────────────────────────────────────────────────
export let ffmpegScreenRecordingActive = false;
export let ffmpegCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let ffmpegCaptureOutputBuffer = "";
export let ffmpegCaptureTargetPath: string | null = null;

// ── Recordings directory ──────────────────────────────────────────────────────
export let customRecordingsDir: string | null = null;
export let recordingsDirLoaded = false;

// ── System cursor assets cache ────────────────────────────────────────────────
export let cachedSystemCursorAssets: Record<string, SystemCursorAsset> | null = null;
export let cachedSystemCursorAssetsSourceMtimeMs: number | null = null;

// ── Countdown ─────────────────────────────────────────────────────────────────
export let countdownTimer: ReturnType<typeof setInterval> | null = null;
export let countdownCancelled = false;
export let countdownInProgress = false;
export let countdownRemaining: number | null = null;

// ── Cursor visual type ────────────────────────────────────────────────────────
export let currentCursorVisualType: CursorVisualType | undefined = undefined;

// ── Cursor telemetry ──────────────────────────────────────────────────────────
export let cursorCaptureInterval: NodeJS.Timeout | null = null;
export let cursorCaptureStartTimeMs = 0;
export let cursorCaptureAccumulatedPausedMs = 0;
export let cursorCapturePauseStartedAtMs: number | null = null;
export let activeCursorSamples: CursorTelemetryPoint[] = [];
export let pendingCursorSamples: CursorTelemetryPoint[] = [];
export let isCursorCaptureActive = false;
export let interactionCaptureCleanup: (() => void) | null = null;
export let hasLoggedInteractionHookFailure = false;
export let lastLeftClick: { timeMs: number; cx: number; cy: number } | null = null;
export let linuxCursorScreenPoint: { x: number; y: number; updatedAt: number } | null = null;
export let selectedWindowBounds: WindowBounds | null = null;
export let windowBoundsCaptureInterval: NodeJS.Timeout | null = null;

// ── Native macOS window source cache ─────────────────────────────────────────
export let cachedNativeMacWindowSources: import("./types").NativeMacWindowSource[] | null = null;
export let cachedNativeMacWindowSourcesAtMs = 0;

// ── Native video export ───────────────────────────────────────────────────────
export let cachedNativeVideoEncoder: {
	ffmpegPath: string;
	encodingMode: string;
	encoderName: string;
} | null = null;

// ── Native helper migration ───────────────────────────────────────────────────
export let nativeHelperMigrationPromise: Promise<void> | null = null;

// ── Cursor interaction capture types ─────────────────────────────────────────
export type { CursorInteractionType, CursorTelemetryPoint };

// ── Setters (for modules that need to reassign exported lets) ─────────────────
// TypeScript exported `let` can be reassigned by the owning module but importers
// cannot assign to them directly. Provide simple setters for cross-module writes.

export function setSelectedSource(v: SelectedSource | null) {
	selectedSource = v;
}
export function setCurrentProjectPath(v: string | null) {
	currentProjectPath = v;
}
export function setCurrentVideoPath(v: string | null) {
	currentVideoPath = v;
	persistLastSession();
}
export function setCurrentRecordingSession(v: RecordingSessionData | null) {
	currentRecordingSession = v;
	persistLastSession();
}

// ── Dev-only crash/restart recovery ───────────────────────────────────────────
// In dev, vite-plugin-electron RESTARTS Electron on every electron/main.ts edit,
// wiping in-memory currentVideoPath/currentRecordingSession — so the editor opens
// empty and the user's recording looks "gone" (the footage file is still on disk).
// We persist a tiny pointer to the last video/session and restore it on the next
// dev launch so testing survives reloads. Prod is untouched (gated on !isPackaged).
function lastSessionFile(): string | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { app } = require("electron") as typeof import("electron");
		if (app.isPackaged) return null; // dev only
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const path = require("node:path") as typeof import("node:path");
		return path.join(app.getPath("userData"), "last-session.json");
	} catch {
		return null;
	}
}

function persistLastSession() {
	const file = lastSessionFile();
	if (!file) return;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs");
		fs.writeFileSync(
			file,
			JSON.stringify({ currentVideoPath, currentRecordingSession }),
			"utf8",
		);
	} catch {
		/* best-effort */
	}
}

export function restoreLastSession() {
	const file = lastSessionFile();
	if (!file) return;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs");
		if (!fs.existsSync(file)) return;
		const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
			currentVideoPath?: string | null;
			currentRecordingSession?: RecordingSessionData | null;
		};
		// Only restore if the underlying video file still exists on disk.
		const raw = data.currentVideoPath;
		const onDisk = raw ? raw.replace(/^file:\/\//, "").replace(/%20/g, " ") : null;
		if (onDisk && fs.existsSync(decodeURI(onDisk))) {
			currentVideoPath = raw ?? null;
			currentRecordingSession = data.currentRecordingSession ?? null;
		}
	} catch {
		/* corrupt pointer — ignore */
	}
}

export function setNativeScreenRecordingActive(v: boolean) {
	nativeScreenRecordingActive = v;
}
export function setNativeCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	nativeCaptureProcess = v;
}
export function setNativeCaptureOutputBuffer(v: string) {
	nativeCaptureOutputBuffer = v;
}
export function setNativeCaptureTargetPath(v: string | null) {
	nativeCaptureTargetPath = v;
}
export function setNativeCaptureStopRequested(v: boolean) {
	nativeCaptureStopRequested = v;
}
export function setNativeCaptureSystemAudioPath(v: string | null) {
	nativeCaptureSystemAudioPath = v;
}
export function setNativeCaptureMicrophonePath(v: string | null) {
	nativeCaptureMicrophonePath = v;
}
export function setNativeCapturePaused(v: boolean) {
	nativeCapturePaused = v;
}

export function setNativeCursorMonitorProcess(v: ChildProcessWithoutNullStreams | null) {
	nativeCursorMonitorProcess = v;
}
export function setNativeCursorMonitorOutputBuffer(v: string) {
	nativeCursorMonitorOutputBuffer = v;
}

export function setWindowsCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	windowsCaptureProcess = v;
}
export function setWindowsCaptureOutputBuffer(v: string) {
	windowsCaptureOutputBuffer = v;
}
export function setWindowsCaptureTargetPath(v: string | null) {
	windowsCaptureTargetPath = v;
}
export function setWindowsNativeCaptureActive(v: boolean) {
	windowsNativeCaptureActive = v;
}
export function setWindowsCaptureStopRequested(v: boolean) {
	windowsCaptureStopRequested = v;
}
export function setWindowsCapturePaused(v: boolean) {
	windowsCapturePaused = v;
}
export function setWindowsSystemAudioPath(v: string | null) {
	windowsSystemAudioPath = v;
}
export function setWindowsMicAudioPath(v: string | null) {
	windowsMicAudioPath = v;
}
export function setWindowsOrphanedMicAudioPath(v: string | null) {
	windowsOrphanedMicAudioPath = v;
}
export function setWindowsPendingVideoPath(v: string | null) {
	windowsPendingVideoPath = v;
}

export function setLastNativeCaptureDiagnostics(v: NativeCaptureDiagnostics | null) {
	lastNativeCaptureDiagnostics = v;
}

export function setFfmpegScreenRecordingActive(v: boolean) {
	ffmpegScreenRecordingActive = v;
}
export function setFfmpegCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	ffmpegCaptureProcess = v;
}
export function setFfmpegCaptureOutputBuffer(v: string) {
	ffmpegCaptureOutputBuffer = v;
}
export function setFfmpegCaptureTargetPath(v: string | null) {
	ffmpegCaptureTargetPath = v;
}

export function setCustomRecordingsDir(v: string | null) {
	customRecordingsDir = v;
}
export function setRecordingsDirLoaded(v: boolean) {
	recordingsDirLoaded = v;
}

export function setCachedSystemCursorAssets(v: Record<string, SystemCursorAsset> | null) {
	cachedSystemCursorAssets = v;
}
export function setCachedSystemCursorAssetsSourceMtimeMs(v: number | null) {
	cachedSystemCursorAssetsSourceMtimeMs = v;
}

export function setCountdownTimer(v: ReturnType<typeof setInterval> | null) {
	countdownTimer = v;
}
export function setCountdownCancelled(v: boolean) {
	countdownCancelled = v;
}
export function setCountdownInProgress(v: boolean) {
	countdownInProgress = v;
}
export function setCountdownRemaining(v: number | null) {
	countdownRemaining = v;
}

export function setCurrentCursorVisualType(v: CursorVisualType | undefined) {
	currentCursorVisualType = v;
}

export function setCursorCaptureInterval(v: NodeJS.Timeout | null) {
	cursorCaptureInterval = v;
}
export function setCursorCaptureStartTimeMs(v: number) {
	cursorCaptureStartTimeMs = v;
}
export function setCursorCaptureAccumulatedPausedMs(v: number) {
	cursorCaptureAccumulatedPausedMs = v;
}
export function setCursorCapturePauseStartedAtMs(v: number | null) {
	cursorCapturePauseStartedAtMs = v;
}
export function setActiveCursorSamples(v: CursorTelemetryPoint[]) {
	activeCursorSamples = v;
}
export function setPendingCursorSamples(v: CursorTelemetryPoint[]) {
	pendingCursorSamples = v;
}
export function setIsCursorCaptureActive(v: boolean) {
	isCursorCaptureActive = v;
}
export function setInteractionCaptureCleanup(v: (() => void) | null) {
	interactionCaptureCleanup = v;
}
export function setHasLoggedInteractionHookFailure(v: boolean) {
	hasLoggedInteractionHookFailure = v;
}
export function setLastLeftClick(v: { timeMs: number; cx: number; cy: number } | null) {
	lastLeftClick = v;
}
export function setLinuxCursorScreenPoint(v: { x: number; y: number; updatedAt: number } | null) {
	linuxCursorScreenPoint = v;
}
export function setSelectedWindowBounds(v: WindowBounds | null) {
	selectedWindowBounds = v;
}
export function setWindowBoundsCaptureInterval(v: NodeJS.Timeout | null) {
	windowBoundsCaptureInterval = v;
}

export function setCachedNativeMacWindowSources(
	v: import("./types").NativeMacWindowSource[] | null,
) {
	cachedNativeMacWindowSources = v;
}
export function setCachedNativeMacWindowSourcesAtMs(v: number) {
	cachedNativeMacWindowSourcesAtMs = v;
}

export function setCachedNativeVideoEncoder(
	v: { ffmpegPath: string; encodingMode: string; encoderName: string } | null,
) {
	cachedNativeVideoEncoder = v;
}

export function setNativeHelperMigrationPromise(v: Promise<void> | null) {
	nativeHelperMigrationPromise = v;
}
