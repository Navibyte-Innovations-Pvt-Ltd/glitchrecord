import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";

/**
 * Intro/outro logo cards bolted onto an exported video via FFmpeg concat.
 *
 * The main export is NEVER re-encoded: we generate short intro/outro clips that
 * match the export's exact video params (codec/profile/pixfmt/fps/timescale) and
 * stitch them with `concat -c copy`. Audio collapses to a single bit — if the
 * main has an audio stream, intro/outro carry a silent AAC track with matching
 * params; if not, they carry no audio stream (concat-copy requires equal stream
 * counts). See the validated spike in the feature design notes.
 */

export type IntroOutroPreset = "fade" | "scale-pop" | "slide" | "glitch";

export type IntroOutroPosition = "center" | "top" | "bottom" | "left" | "right";

export interface IntroOutroSideConfig {
	enabled: boolean;
	preset: IntroOutroPreset;
	/** Card duration in milliseconds (clamped 500–5000). */
	durationMs: number;
	/** Background hex color, e.g. "#0B1020". */
	backgroundColor: string;
	/** Logo placement for static presets; slide enters from this edge. */
	position: IntroOutroPosition;
	/** Logo height as a fraction of frame height (clamped 0.1–0.8). */
	size: number;
}

export interface IntroOutroConfig {
	/** "data:image/png;base64,..." — the user's transparent logo. */
	logoDataUrl: string;
	intro: IntroOutroSideConfig;
	outro: IntroOutroSideConfig;
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
const MAX_DURATION_MS = 5000;
const FFMPEG_TIMEOUT_MS = 60_000;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function isSideActive(side: IntroOutroSideConfig | undefined): side is IntroOutroSideConfig {
	return Boolean(side?.enabled);
}

/** True when at least one side is enabled and a logo is present. */
export function introOutroIsActive(config: IntroOutroConfig | null | undefined): boolean {
	if (
		!config ||
		typeof config.logoDataUrl !== "string" ||
		!config.logoDataUrl.startsWith("data:")
	) {
		return false;
	}
	return isSideActive(config.intro) || isSideActive(config.outro);
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
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(`ffprobe exited ${code}: ${stderr}`));
			}
		});
	});
}

function parseRationalFps(value: string | undefined): number {
	if (!value) return 30;
	const [num, den] = value.split("/");
	const n = Number(num);
	const d = Number(den);
	if (Number.isFinite(n) && Number.isFinite(d) && d > 0) {
		return n / d;
	}
	return Number.isFinite(n) && n > 0 ? n : 30;
}

function parseTimebaseToTimescale(value: string | undefined): number {
	// time_base like "1/15360" → timescale 15360.
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
	const parsed = JSON.parse(raw) as {
		streams?: Array<Record<string, unknown>>;
	};
	const streams = parsed.streams ?? [];
	const video = streams.find((s) => s.codec_type === "video");
	const audio = streams.find((s) => s.codec_type === "audio");
	if (!video) {
		throw new Error("No video stream found in export");
	}

	const profileRaw = typeof video.profile === "string" ? video.profile.toLowerCase() : "high";
	const levelRaw = video.level;
	let level = "";
	if (typeof levelRaw === "number" && levelRaw > 0) {
		// ffprobe reports H.264 level as an integer (32 → 3.2).
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

function sanitizeHexColor(value: string | undefined): string {
	if (typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
		const hex = value.trim().replace(/^#/, "");
		return `0x${hex}`;
	}
	return "0x0B1020";
}

/** Even logo height in pixels for the given size fraction. */
function logoHeightPx(params: ProbedVideoParams, size: number): number {
	const fraction = clamp(size, 0.1, 0.8);
	const h = Math.round(params.height * fraction);
	return Math.max(2, h % 2 === 0 ? h : h + 1);
}

/** Overlay x/y expressions for a static placement. Margins are 15% of the frame. */
function placementExpr(position: IntroOutroPosition): { x: string; y: string } {
	switch (position) {
		case "top":
			return { x: "(W-w)/2", y: "H*0.15" };
		case "bottom":
			return { x: "(W-w)/2", y: "H*0.85-h" };
		case "left":
			return { x: "W*0.15", y: "(H-h)/2" };
		case "right":
			return { x: "W*0.85-w", y: "(H-h)/2" };
		default:
			return { x: "(W-w)/2", y: "(H-h)/2" };
	}
}

/** Offscreen start x/y for a slide entering from the placement edge. */
function slideStartExpr(
	position: IntroOutroPosition,
	end: { x: string; y: string },
): {
	x: string;
	y: string;
} {
	switch (position) {
		case "top":
			return { x: end.x, y: "-h" };
		case "bottom":
			return { x: end.x, y: "H" };
		case "right":
			return { x: "W", y: end.y };
		default:
			// center + left both slide in from the left edge.
			return { x: "-w", y: end.y };
	}
}

function buildFilterComplex(
	side: IntroOutroSideConfig,
	params: ProbedVideoParams,
	durationSec: number,
): string {
	const lh = logoHeightPx(params, side.size);
	const fadeDur = Math.min(0.5, durationSec * 0.4);
	const fadeOutStart = Math.max(0, durationSec - fadeDur).toFixed(3);
	const place = placementExpr(side.position);

	if (side.preset === "scale-pop") {
		// Pre-scale logo, overlay centered, then ease a zoom "pop" on the composite.
		// zoompan is robust where per-frame `scale=eval=frame` is not.
		const popFrames = Math.max(1, Math.round(params.fps * 0.5));
		return [
			`[1:v]scale=-2:${lh},format=rgba[lg]`,
			`[0:v][lg]overlay=(W-w)/2:(H-h)/2:format=auto[comp]`,
			`[comp]zoompan=z='if(lte(on,1)\\,0.6\\,min(1.0\\,0.6+0.4*(on/${popFrames})))':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${params.width}x${params.height}:fps=${params.fps},fade=t=in:st=0:d=${fadeDur.toFixed(3)},fade=t=out:st=${fadeOutStart}:d=${fadeDur.toFixed(3)},format=yuv420p[v]`,
		].join(";");
	}

	if (side.preset === "slide") {
		const start = slideStartExpr(side.position, place);
		const slideDur = Math.min(0.6, durationSec * 0.5);
		const xExpr = `if(lt(t\\,${slideDur.toFixed(3)})\\,${start.x}+(${place.x}-(${start.x}))*(t/${slideDur.toFixed(3)})\\,${place.x})`;
		const yExpr = `if(lt(t\\,${slideDur.toFixed(3)})\\,${start.y}+(${place.y}-(${start.y}))*(t/${slideDur.toFixed(3)})\\,${place.y})`;
		return [
			`[1:v]scale=-2:${lh},format=rgba[lg]`,
			`[0:v][lg]overlay=x='${xExpr}':y='${yExpr}':eval=frame,fade=t=out:st=${fadeOutStart}:d=${fadeDur.toFixed(3)},format=yuv420p[v]`,
		].join(";");
	}

	if (side.preset === "glitch") {
		// Damped horizontal shake settling into place + fade in/out.
		const shakeDur = Math.min(0.4, durationSec * 0.35);
		const xExpr = `${place.x}+if(lt(t\\,${shakeDur.toFixed(3)})\\,18*sin(t*90)*(${shakeDur.toFixed(3)}-t)/${shakeDur.toFixed(3)}\\,0)`;
		return [
			`[1:v]scale=-2:${lh},format=rgba[lg]`,
			`[0:v][lg]overlay=x='${xExpr}':y='${place.y}':eval=frame,fade=t=in:st=0:d=${fadeDur.toFixed(3)},fade=t=out:st=${fadeOutStart}:d=${fadeDur.toFixed(3)},format=yuv420p[v]`,
		].join(";");
	}

	// fade (default)
	return [
		`[1:v]scale=-2:${lh},format=rgba[lg]`,
		`[0:v][lg]overlay=${place.x}:${place.y}:format=auto,fade=t=in:st=0:d=${fadeDur.toFixed(3)},fade=t=out:st=${fadeOutStart}:d=${fadeDur.toFixed(3)},format=yuv420p[v]`,
	].join(";");
}

async function generateSideClip(
	ffmpegPath: string,
	side: IntroOutroSideConfig,
	params: ProbedVideoParams,
	logoPath: string,
	outPath: string,
): Promise<void> {
	const durationSec = clamp(side.durationMs, MIN_DURATION_MS, MAX_DURATION_MS) / 1000;
	const bg = sanitizeHexColor(side.backgroundColor);
	const filter = buildFilterComplex(side, params, durationSec);

	const args: string[] = [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=${bg}:s=${params.width}x${params.height}:r=${params.fps}:d=${durationSec.toFixed(3)}`,
		"-loop",
		"1",
		"-i",
		logoPath,
	];

	if (params.hasAudio) {
		args.push(
			"-f",
			"lavfi",
			"-i",
			`anullsrc=channel_layout=${params.audioChannels >= 2 ? "stereo" : "mono"}:sample_rate=${params.audioSampleRate}`,
		);
	}

	args.push("-filter_complex", filter, "-map", "[v]");
	if (params.hasAudio) {
		args.push("-map", "2:a");
	}
	args.push("-t", durationSec.toFixed(3));

	// Match the export's video params so concat -c copy never re-encodes the main.
	args.push("-c:v", "libx264", "-profile:v", params.profile, "-pix_fmt", params.pixFmt);
	if (params.level) {
		args.push("-level", params.level);
	}
	args.push("-r", String(params.fps));
	if (params.videoTimescale > 0) {
		args.push("-video_track_timescale", String(params.videoTimescale));
	}
	if (params.hasAudio) {
		args.push(
			"-c:a",
			"aac",
			"-b:a",
			"128k",
			"-ar",
			String(params.audioSampleRate),
			"-ac",
			String(params.audioChannels),
		);
	}
	args.push(outPath);

	const result = await runFfmpeg(ffmpegPath, args);
	if (!result.ok) {
		throw new Error(`Failed to render intro/outro clip: ${result.stderr.slice(-500)}`);
	}
}

function parseLogoDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
	const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl);
	if (!match) {
		throw new Error("Logo must be a base64 PNG/JPEG/WebP data URL");
	}
	const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
	return { buffer: Buffer.from(match[2], "base64"), ext };
}

async function makeTempDir(): Promise<string> {
	const dir = path.join(os.tmpdir(), `glitchrecord-introoutro-${randomBytes(6).toString("hex")}`);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

/**
 * Apply intro/outro to an exported video. Returns a NEW temp path holding the
 * stitched result, or the original `videoPath` unchanged if nothing applies.
 * The caller is responsible for moving the returned file to its destination.
 * Never throws on a rendering failure — falls back to the original export.
 */
export async function applyIntroOutro(
	videoPath: string,
	config: IntroOutroConfig | null | undefined,
): Promise<string> {
	if (!introOutroIsActive(config) || !config) {
		return videoPath;
	}
	// GIF and other non-mp4 outputs are out of scope for v1.
	if (!videoPath.toLowerCase().endsWith(".mp4")) {
		console.warn(
			`[introOutro] Cards requested but output is not mp4 (${videoPath}); exporting without cards.`,
		);
		return videoPath;
	}

	let workDir: string | null = null;
	try {
		const ffmpegPath = getFfmpegBinaryPath();
		const params = await probeVideoParams(videoPath);
		if (params.width <= 0 || params.height <= 0) {
			console.warn(
				"[introOutro] Cards requested but export has no valid video dimensions; exporting without cards.",
			);
			return videoPath;
		}

		workDir = await makeTempDir();
		const logo = parseLogoDataUrl(config.logoDataUrl);
		const logoPath = path.join(workDir, `logo.${logo.ext}`);
		await fs.writeFile(logoPath, logo.buffer);

		const segments: string[] = [];

		if (isSideActive(config.intro)) {
			const introPath = path.join(workDir, "intro.mp4");
			await generateSideClip(ffmpegPath, config.intro, params, logoPath, introPath);
			segments.push(introPath);
		}
		segments.push(videoPath);
		if (isSideActive(config.outro)) {
			const outroPath = path.join(workDir, "outro.mp4");
			await generateSideClip(ffmpegPath, config.outro, params, logoPath, outroPath);
			segments.push(outroPath);
		}

		if (segments.length <= 1) {
			return videoPath;
		}

		// FFmpeg concat demuxer list. `-safe 0` allows absolute paths; single
		// quotes in paths are escaped per the concat protocol.
		const listPath = path.join(workDir, "concat.txt");
		const listBody = segments
			.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`)
			.join("\n");
		await fs.writeFile(listPath, listBody, "utf-8");

		// Stitched output lives OUTSIDE workDir so we can delete workDir's
		// scratch files (logo/intro/outro/list) immediately; the caller owns
		// the returned file and moves it to the destination.
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
				`[introOutro] concat failed, exporting without cards: ${concat.stderr.slice(-500)}`,
			);
			return videoPath;
		}

		return outPath;
	} catch (error) {
		console.warn("[introOutro] Failed to apply intro/outro, exporting original:", error);
		return videoPath;
	} finally {
		if (workDir) {
			await fs.rm(workDir, { recursive: true, force: true }).catch(() => {
				// best-effort temp cleanup
			});
		}
	}
}
