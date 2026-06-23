import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";

/**
 * Intro/outro cards bolted onto an exported video via FFmpeg concat. The main
 * export is NEVER re-encoded: we build short clips matching its exact video
 * params (codec/profile/pixfmt/fps/timescale) and stitch with `concat -c copy`.
 *
 * Card visuals are rendered in the RENDERER (canvas `drawCard`, the same code the
 * preview uses) and handed here as a PNG frame sequence (per side, in a temp dir),
 * so export matches preview pixel-for-pixel. Video-mode sides transcode the user's
 * clip to match params. Audio (built-in sting or uploaded) is muxed per side, but
 * only when the main export has an audio stream (concat-copy needs equal stream
 * counts).
 */

export type IntroOutroMode = "card" | "video";
export type IntroOutroPreset = "fade" | "scale-pop" | "slide" | "glitch";
export type IntroOutroPosition = "center" | "top" | "bottom" | "left" | "right";
export type CardLayout = "logo-only" | "logo-top" | "logo-left" | "text-only";
export type BackgroundType = "solid" | "gradient";
export type LogoContainerStyle = "none" | "rounded" | "panel";
export type CardAudioMode = "none" | "builtin" | "upload";

export interface CardBackground {
	type: BackgroundType;
	color1: string;
	color2: string;
	angle: number;
}
export interface CardText {
	brandName: string;
	tagline: string;
	color: string;
}
export interface CardAudio {
	mode: CardAudioMode;
	trackId: string;
	dataUrl: string;
	volume: number;
}
export interface IntroOutroSideConfig {
	enabled: boolean;
	mode: IntroOutroMode;
	preset: IntroOutroPreset;
	position: IntroOutroPosition;
	durationMs: number;
	size: number;
	layout: CardLayout;
	background: CardBackground;
	logoContainer: LogoContainerStyle;
	text: CardText;
	videoPath: string;
	audio: CardAudio;
}
export interface IntroOutroConfig {
	logoDataUrl: string;
	intro: IntroOutroSideConfig;
	outro: IntroOutroSideConfig;
}

/** PNG frame directories rendered by the renderer, per side. */
export interface IntroOutroFrameDirs {
	intro?: string | null;
	outro?: string | null;
}

interface ProbedVideoParams {
	width: number;
	height: number;
	fps: number;
	videoTimescale: number;
	profile: string;
	level: string;
	pixFmt: string;
	hasAudio: boolean;
	audioSampleRate: number;
	audioChannels: number;
}

const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 8000;
const FFMPEG_TIMEOUT_MS = 120_000;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function sideHasContent(side: IntroOutroSideConfig, logoDataUrl: string): boolean {
	if (!side.enabled) return false;
	if (side.mode === "video") return Boolean(side.videoPath);
	return Boolean(logoDataUrl) || Boolean(side.text.brandName) || Boolean(side.text.tagline);
}

export function introOutroIsActive(config: IntroOutroConfig | null | undefined): boolean {
	if (!config) return false;
	return (
		sideHasContent(config.intro, config.logoDataUrl) ||
		sideHasContent(config.outro, config.logoDataUrl)
	);
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
		}, FFMPEG_TIMEOUT_MS);
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({ ok: false, stderr: error instanceof Error ? error.message : String(error) });
		});
		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({ ok: code === 0, stderr });
		});
	});
}

function runFfprobe(ffprobePath: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`ffprobe exited ${code}: ${stderr}`));
		});
	});
}

function parseRationalFps(value: string | undefined): number {
	if (!value) return 30;
	const [num, den] = value.split("/");
	const n = Number(num);
	const d = Number(den);
	if (Number.isFinite(n) && Number.isFinite(d) && d > 0) return n / d;
	return Number.isFinite(n) && n > 0 ? n : 30;
}

function parseTimebaseToTimescale(value: string | undefined): number {
	if (!value) return 0;
	const [, den] = value.split("/");
	const d = Number(den);
	return Number.isFinite(d) && d > 0 ? d : 0;
}

async function probeVideoParams(videoPath: string): Promise<ProbedVideoParams> {
	const ffprobePath = getFfprobeBinaryPath();
	const raw = await runFfprobe(ffprobePath, [
		"-v",
		"error",
		"-show_entries",
		"stream=index,codec_type,profile,level,pix_fmt,width,height,r_frame_rate,time_base,sample_rate,channels",
		"-of",
		"json",
		videoPath,
	]);
	const parsed = JSON.parse(raw) as { streams?: Array<Record<string, unknown>> };
	const streams = parsed.streams ?? [];
	const video = streams.find((s) => s.codec_type === "video");
	const audio = streams.find((s) => s.codec_type === "audio");
	if (!video) throw new Error("No video stream found in export");

	const profileRaw = typeof video.profile === "string" ? video.profile.toLowerCase() : "high";
	const levelRaw = video.level;
	let level = "";
	if (typeof levelRaw === "number" && levelRaw > 0) {
		level = levelRaw >= 10 ? (levelRaw / 10).toFixed(1) : String(levelRaw);
	}
	return {
		width: Number(video.width) || 0,
		height: Number(video.height) || 0,
		fps: parseRationalFps(
			typeof video.r_frame_rate === "string" ? video.r_frame_rate : undefined,
		),
		videoTimescale: parseTimebaseToTimescale(
			typeof video.time_base === "string" ? video.time_base : undefined,
		),
		profile: profileRaw,
		level,
		pixFmt: typeof video.pix_fmt === "string" ? video.pix_fmt : "yuv420p",
		hasAudio: Boolean(audio),
		audioSampleRate: audio ? Number(audio.sample_rate) || 22050 : 22050,
		audioChannels: audio ? Number(audio.channels) || 1 : 1,
	};
}

/** Common x264 args so each generated clip matches the main export exactly. */
function videoMatchArgs(params: ProbedVideoParams): string[] {
	const args = ["-c:v", "libx264", "-profile:v", params.profile, "-pix_fmt", params.pixFmt];
	if (params.level) args.push("-level", params.level);
	args.push("-r", String(params.fps));
	if (params.videoTimescale > 0)
		args.push("-video_track_timescale", String(params.videoTimescale));
	return args;
}

function audioMatchArgs(params: ProbedVideoParams): string[] {
	return [
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-ar",
		String(params.audioSampleRate),
		"-ac",
		String(params.audioChannels),
	];
}

// ── Built-in stings ─────────────────────────────────────────────────────────
// Synthesized on demand and cached in userData, so nothing needs bundling.

function stingSynthArgs(trackId: string): string[] {
	switch (trackId) {
		case "chime":
			return [
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=880:duration=1.2",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=1320:duration=1.2",
				"-filter_complex",
				"[0][1]amix=inputs=2,afade=t=out:st=0.4:d=0.8,volume=0.6",
			];
		case "riser":
			return [
				"-f",
				"lavfi",
				"-i",
				"aevalsrc=0.3*sin(2*PI*t*(300+500*t)):d=1.2:s=22050",
				"-af",
				"afade=t=out:st=0.9:d=0.3",
			];
		case "pulse":
			return [
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=330:duration=1.2",
				"-af",
				"tremolo=f=8:d=0.8,afade=t=in:d=0.05,afade=t=out:st=0.9:d=0.3,volume=0.7",
			];
		default:
			// whoosh
			return [
				"-f",
				"lavfi",
				"-i",
				"anoisesrc=d=1.2:c=pink:a=0.4",
				"-af",
				"highpass=f=300,lowpass=f=4000,afade=t=in:d=0.1,afade=t=out:st=0.7:d=0.5,volume=1.5",
			];
	}
}

async function getBuiltinStingPath(ffmpegPath: string, trackId: string): Promise<string | null> {
	const id = ["whoosh", "riser", "chime", "pulse"].includes(trackId) ? trackId : "whoosh";
	const cacheDir = path.join(app.getPath("userData"), "intro-stings");
	await fs.mkdir(cacheDir, { recursive: true });
	const outPath = path.join(cacheDir, `${id}.m4a`);
	if (existsSync(outPath)) return outPath;
	const result = await runFfmpeg(ffmpegPath, [
		"-y",
		"-v",
		"error",
		...stingSynthArgs(id),
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-ar",
		"22050",
		"-ac",
		"1",
		outPath,
	]);
	return result.ok ? outPath : null;
}

/**
 * Resolve the per-side music input path, or null for no/failed music.
 * `workDir` holds any uploaded-audio temp file.
 */
async function resolveAudioInput(
	ffmpegPath: string,
	side: IntroOutroSideConfig,
	workDir: string,
	tag: string,
): Promise<string | null> {
	if (side.audio.mode === "builtin") {
		return getBuiltinStingPath(ffmpegPath, side.audio.trackId);
	}
	if (side.audio.mode === "upload" && side.audio.dataUrl.startsWith("data:audio/")) {
		const match = /^data:audio\/[\w.+-]+;base64,(.+)$/i.exec(side.audio.dataUrl);
		if (!match) return null;
		const audioPath = path.join(workDir, `audio-${tag}.bin`);
		await fs.writeFile(audioPath, Buffer.from(match[1], "base64"));
		return audioPath;
	}
	return null;
}

async function countFrames(framesDir: string): Promise<number> {
	const files = await fs.readdir(framesDir).catch(() => [] as string[]);
	return files.filter((f) => f.endsWith(".png")).length;
}

/** Build a card clip from the renderer's PNG frame sequence. */
async function buildCardClip(
	ffmpegPath: string,
	framesDir: string,
	side: IntroOutroSideConfig,
	params: ProbedVideoParams,
	audioPath: string | null,
	outPath: string,
): Promise<boolean> {
	const frameCount = await countFrames(framesDir);
	if (frameCount === 0) return false;
	const durationSec = clamp(side.durationMs, MIN_DURATION_MS, MAX_DURATION_MS) / 1000;
	const volume = clamp(side.audio.volume, 0, 1);
	const withMusic = params.hasAudio && audioPath !== null;

	const args: string[] = [
		"-y",
		"-v",
		"error",
		"-framerate",
		String(params.fps),
		"-i",
		path.join(framesDir, "f%05d.png"),
	];
	if (withMusic) {
		args.push("-i", audioPath as string);
	} else if (params.hasAudio) {
		args.push(
			"-f",
			"lavfi",
			"-i",
			`anullsrc=channel_layout=${params.audioChannels >= 2 ? "stereo" : "mono"}:sample_rate=${params.audioSampleRate}`,
		);
	}
	// Scale guarantees card dims exactly match the main export (concat-copy needs it).
	args.push(
		"-vf",
		`scale=${params.width}:${params.height},format=${params.pixFmt}`,
		"-t",
		durationSec.toFixed(3),
	);
	args.push(...videoMatchArgs(params));
	if (params.hasAudio) {
		if (withMusic) args.push("-af", `volume=${volume.toFixed(2)},apad`);
		args.push(...audioMatchArgs(params));
	}
	args.push(outPath);

	const result = await runFfmpeg(ffmpegPath, args);
	if (!result.ok) console.warn(`[introOutro] card clip failed: ${result.stderr.slice(-400)}`);
	return result.ok;
}

/** Transcode a user video clip to match the export params. */
async function buildVideoClip(
	ffmpegPath: string,
	side: IntroOutroSideConfig,
	params: ProbedVideoParams,
	audioPath: string | null,
	outPath: string,
): Promise<boolean> {
	if (!side.videoPath || !existsSync(side.videoPath)) return false;
	const volume = clamp(side.audio.volume, 0, 1);
	const useMusic = params.hasAudio && audioPath !== null;

	const args: string[] = ["-y", "-v", "error", "-i", side.videoPath];
	if (useMusic) args.push("-i", audioPath as string);

	args.push(
		"-vf",
		`scale=${params.width}:${params.height}:force_original_aspect_ratio=decrease,pad=${params.width}:${params.height}:(ow-iw)/2:(oh-ih)/2:black,format=${params.pixFmt},fps=${params.fps}`,
	);
	args.push(...videoMatchArgs(params));

	if (params.hasAudio) {
		if (useMusic) {
			// Replace the clip's audio with the chosen music.
			args.push(
				"-map",
				"0:v:0",
				"-map",
				"1:a:0",
				"-af",
				`volume=${volume.toFixed(2)},apad`,
				"-shortest",
			);
		} else {
			// Keep the clip's own audio if present, else synthesize silence.
			args.push("-af", "aresample=async=1", "-map", "0:v:0", "-map", "0:a:0?");
		}
		args.push(...audioMatchArgs(params));
	} else {
		args.push("-an");
	}
	args.push(outPath);

	const result = await runFfmpeg(ffmpegPath, args);
	if (!result.ok) console.warn(`[introOutro] video clip failed: ${result.stderr.slice(-400)}`);
	// A clip with no audio stream while the main has one breaks concat-copy; add
	// a silent track in that case via a second pass.
	if (result.ok && params.hasAudio && !useMusic) {
		const probe = await probeVideoParams(outPath).catch(() => null);
		if (probe && !probe.hasAudio) {
			const withSilence = `${outPath}.silenced.mp4`;
			const pass2 = await runFfmpeg(ffmpegPath, [
				"-y",
				"-v",
				"error",
				"-i",
				outPath,
				"-f",
				"lavfi",
				"-i",
				`anullsrc=channel_layout=${params.audioChannels >= 2 ? "stereo" : "mono"}:sample_rate=${params.audioSampleRate}`,
				"-map",
				"0:v:0",
				"-map",
				"1:a:0",
				"-c:v",
				"copy",
				...audioMatchArgs(params),
				"-shortest",
				withSilence,
			]);
			if (pass2.ok) {
				await fs.rename(withSilence, outPath).catch(() => undefined);
			}
		}
	}
	return result.ok;
}

async function makeTempDir(prefix: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `${prefix}-${randomBytes(6).toString("hex")}`);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

/** Stage renderer PNG frames (base64) into a temp dir; returns the dir. */
export async function stageIntroOutroFrames(framesBase64: string[]): Promise<string> {
	const dir = await makeTempDir("glitchrecord-ioframes");
	await Promise.all(
		framesBase64.map((b64, i) => {
			const data = b64.replace(/^data:image\/png;base64,/, "");
			return fs.writeFile(
				path.join(dir, `f${String(i).padStart(5, "0")}.png`),
				Buffer.from(data, "base64"),
			);
		}),
	);
	return dir;
}

/**
 * Apply intro/outro to an exported mp4. Returns a NEW temp path with the stitched
 * result, or the original `videoPath` unchanged if nothing applies / on failure.
 */
export async function applyIntroOutro(
	videoPath: string,
	config: IntroOutroConfig | null | undefined,
	frameDirs?: IntroOutroFrameDirs,
): Promise<string> {
	if (!introOutroIsActive(config) || !config) return videoPath;
	if (!videoPath.toLowerCase().endsWith(".mp4")) {
		console.warn(`[introOutro] non-mp4 output, skipping cards: ${videoPath}`);
		return videoPath;
	}

	let workDir: string | null = null;
	try {
		const ffmpegPath = getFfmpegBinaryPath();
		const params = await probeVideoParams(videoPath);
		if (params.width <= 0 || params.height <= 0) return videoPath;

		workDir = await makeTempDir("glitchrecord-introoutro");

		const buildSide = async (
			side: IntroOutroSideConfig,
			dir: string | null | undefined,
			tag: string,
		): Promise<string | null> => {
			if (!sideHasContent(side, config.logoDataUrl)) return null;
			const audioPath = await resolveAudioInput(ffmpegPath, side, workDir as string, tag);
			const outPath = path.join(workDir as string, `${tag}.mp4`);
			if (side.mode === "video") {
				return (await buildVideoClip(ffmpegPath, side, params, audioPath, outPath))
					? outPath
					: null;
			}
			if (!dir) return null;
			return (await buildCardClip(ffmpegPath, dir, side, params, audioPath, outPath))
				? outPath
				: null;
		};

		const introClip = await buildSide(config.intro, frameDirs?.intro, "intro");
		const outroClip = await buildSide(config.outro, frameDirs?.outro, "outro");

		const segments: string[] = [];
		if (introClip) segments.push(introClip);
		segments.push(videoPath);
		if (outroClip) segments.push(outroClip);
		if (segments.length <= 1) return videoPath;

		const listPath = path.join(workDir, "concat.txt");
		await fs.writeFile(
			listPath,
			segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"),
			"utf-8",
		);

		const outPath = path.join(
			os.tmpdir(),
			`glitchrecord-export-${randomBytes(6).toString("hex")}.mp4`,
		);
		const concat = await runFfmpeg(ffmpegPath, [
			"-y",
			"-v",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-c",
			"copy",
			outPath,
		]);
		if (!concat.ok) {
			console.warn(
				`[introOutro] concat failed, exporting without cards: ${concat.stderr.slice(-400)}`,
			);
			return videoPath;
		}
		return outPath;
	} catch (error) {
		console.warn("[introOutro] failed, exporting original:", error);
		return videoPath;
	} finally {
		if (workDir) {
			await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
		}
		// Clean staged frame dirs (renderer-created).
		for (const dir of [frameDirs?.intro, frameDirs?.outro]) {
			if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
