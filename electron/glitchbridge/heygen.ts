// HeyGen avatar client — called from the Electron main process.
//
// Turns the existing narration audio (Sarvam/XTTS mp3 or wav) into a lip-synced
// talking-head video driven by a custom photo. Two tiers:
//   - "photo" → Photo Avatar (talking_photo), ~$1/min, cheap, fine for a corner PiP
//   - "iv"    → Avatar IV, ~$4/min, photoreal, for full-frame moments
//
// The avatar is ALWAYS audio-driven (voice.type "audio") so it lip-syncs the
// narration track we already generated — HeyGen never synthesizes its own voice.
// (script and audio are mutually exclusive in the v2 API.)
//
// Auth: platform key in env HEYGEN_API_KEY, sent as the `x-api-key` header.
// Docs: https://docs.heygen.com/docs/using-audio-source-as-voice

import fssync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.heygen.com";
const UPLOAD = "https://upload.heygen.com";

export type AvatarTier = "photo" | "iv";

export interface AvatarRequest {
	/** Custom photo (png/jpg) → talking_photo. Omit when using a HeyGen library avatar. */
	photoPath?: string;
	/** HeyGen library avatar id (from listAvatars). Takes precedence over photoPath. */
	avatarId?: string;
	/** Absolute path to the narration audio (mp3/wav) to lip-sync. */
	audioPath: string;
	tier: AvatarTier;
	/** Transparent webm output (for circle/cutout) vs opaque mp4 box. */
	transparent?: boolean;
	/** Portrait corner box by default; 9:16 keeps a head-and-shoulders crop. */
	width?: number;
	height?: number;
}

export interface HeyGenAvatar {
	id: string;
	name: string;
	gender?: string;
	previewUrl?: string;
}

export interface AvatarResult {
	ok: boolean;
	/** Local path to the downloaded avatar clip on success. */
	path?: string;
	/** webm (transparent) or mp4. */
	format?: "webm" | "mp4";
	error?: string;
}

export type ProgressFn = (stage: string) => void;

// There's no dotenv loader in the Electron main — keys live in tts/.env and are
// read from the file (same as SARVAM_API_KEY). Read at call-time so the user can
// drop the key in without relaunching the app. process.env wins if it's set.
function keyFromEnvFile(): string | null {
	try {
		const envPath = path.join(process.env.APP_ROOT ?? process.cwd(), "tts", ".env");
		if (!fssync.existsSync(envPath)) return null;
		const body = fssync.readFileSync(envPath, "utf8");
		for (const line of body.split("\n")) {
			const m = line.match(/^\s*HEYGEN_API_KEY\s*=\s*(.+?)\s*$/);
			if (m) {
				const v = m[1].replace(/^["']|["']$/g, "").trim();
				if (v) return v;
			}
		}
	} catch {
		/* ignore — fall through to null */
	}
	return null;
}

function key(): string | null {
	const fromProcess = process.env.HEYGEN_API_KEY?.trim();
	if (fromProcess && fromProcess.length > 0) return fromProcess;
	return keyFromEnvFile();
}

export function hasHeyGenKey(): boolean {
	return key() !== null;
}

// HeyGen's studio avatar library (preset realistic avatars). Each can be driven
// by our narration audio just like a custom photo. Returns a trimmed list.
export async function listAvatars(): Promise<{
	ok: boolean;
	avatars?: HeyGenAvatar[];
	error?: string;
}> {
	const apiKey = key();
	if (!apiKey) return { ok: false, error: "HEYGEN_API_KEY not set" };
	try {
		const res = await fetch(`${API}/v2/avatars`, { headers: { "x-api-key": apiKey } });
		if (!res.ok) return { ok: false, error: `List avatars ${res.status}` };
		const data = (await res.json()) as {
			data?: {
				avatars?: Array<{
					avatar_id?: string;
					avatar_name?: string;
					gender?: string;
					preview_image_url?: string;
				}>;
			};
		};
		const avatars: HeyGenAvatar[] = (data.data?.avatars ?? [])
			.filter((a) => a.avatar_id)
			.map((a) => ({
				id: a.avatar_id as string,
				name: a.avatar_name || (a.avatar_id as string),
				gender: a.gender,
				previewUrl: a.preview_image_url,
			}));
		return { ok: true, avatars };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function mimeFor(p: string): string {
	const lower = p.toLowerCase();
	if (lower.endsWith(".mp3")) return "audio/mpeg";
	if (lower.endsWith(".wav")) return "audio/wav";
	if (lower.endsWith(".m4a")) return "audio/mp4";
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	return "application/octet-stream";
}

// Upload a raw media file to the HeyGen asset store. Returns the asset id used
// downstream as `audio_asset_id` (audio) or `image_key` (photo).
async function uploadAsset(
	filePath: string,
	apiKey: string,
): Promise<{ id: string; imageKey?: string }> {
	const body = await fs.readFile(filePath);
	const res = await fetch(`${UPLOAD}/v1/asset`, {
		method: "POST",
		headers: { "x-api-key": apiKey, "Content-Type": mimeFor(filePath) },
		body,
	});
	if (!res.ok) throw new Error(`Upload asset ${res.status}: ${(await res.text()).slice(-200)}`);
	const data = (await res.json()) as { data?: { id?: string; image_key?: string } };
	const id = data.data?.id;
	if (!id) throw new Error("Upload asset returned no id");
	return { id, imageKey: data.data?.image_key };
}

// Turn an uploaded photo into a talking_photo the avatar endpoints accept.
async function uploadTalkingPhoto(photoPath: string, apiKey: string): Promise<string> {
	const body = await fs.readFile(photoPath);
	const res = await fetch(`${UPLOAD}/v1/talking_photo`, {
		method: "POST",
		headers: { "x-api-key": apiKey, "Content-Type": mimeFor(photoPath) },
		body,
	});
	if (!res.ok)
		throw new Error(`Upload talking photo ${res.status}: ${(await res.text()).slice(-200)}`);
	const data = (await res.json()) as { data?: { talking_photo_id?: string; id?: string } };
	const id = data.data?.talking_photo_id ?? data.data?.id;
	if (!id) throw new Error("Upload talking photo returned no id");
	return id;
}

// Kick off generation. Returns the video_id to poll. `character` is either a
// talking_photo (custom photo) or a library avatar.
async function startGeneration(
	req: AvatarRequest,
	character: Record<string, unknown>,
	audioAssetId: string,
	apiKey: string,
): Promise<string> {
	const width = req.width ?? 720;
	const height = req.height ?? 1280;
	// Transparent green-screen matte → we composite the cutout ourselves; opaque
	// videos keep HeyGen's own background and sit in a rounded box.
	const background = req.transparent
		? { type: "color", value: "#00FF00" }
		: { type: "color", value: "#000000" };

	const body = {
		video_inputs: [
			{
				character,
				voice: { type: "audio", audio_asset_id: audioAssetId },
				background,
			},
		],
		dimension: { width, height },
	};

	const res = await fetch(`${API}/v2/video/generate`, {
		method: "POST",
		headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Generate ${res.status}: ${(await res.text()).slice(-300)}`);
	const data = (await res.json()) as {
		data?: { video_id?: string };
		error?: { message?: string };
	};
	const id = data.data?.video_id;
	if (!id) throw new Error(data.error?.message || "Generate returned no video_id");
	return id;
}

interface StatusResult {
	status: "processing" | "completed" | "failed" | "pending" | "waiting";
	videoUrl?: string;
	error?: string;
}

async function checkStatus(videoId: string, apiKey: string): Promise<StatusResult> {
	const res = await fetch(`${API}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
		headers: { "x-api-key": apiKey },
	});
	if (!res.ok) throw new Error(`Status ${res.status}`);
	const data = (await res.json()) as {
		data?: { status?: string; video_url?: string; error?: { message?: string } | string };
	};
	const d = data.data ?? {};
	const err = typeof d.error === "string" ? d.error : d.error?.message;
	return {
		status: (d.status as StatusResult["status"]) ?? "processing",
		videoUrl: d.video_url,
		error: err,
	};
}

async function downloadTo(url: string, outPath: string): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Download ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	await fs.writeFile(outPath, buf);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// High-level orchestrator: photo + narration audio → local avatar clip.
// Polls up to ~10 min (avatar gen for a few-minute clip is typically 1–4 min).
export async function generateAvatar(
	req: AvatarRequest,
	outDir: string,
	onProgress: ProgressFn = () => undefined,
): Promise<AvatarResult> {
	const apiKey = key();
	if (!apiKey) return { ok: false, error: "HEYGEN_API_KEY not set in the environment" };
	if (!req.avatarId && !req.photoPath)
		return { ok: false, error: "Choose a photo or a HeyGen avatar" };
	if (req.photoPath && !req.avatarId && !fssync.existsSync(req.photoPath))
		return { ok: false, error: "Photo file not found" };
	if (!fssync.existsSync(req.audioPath))
		return { ok: false, error: "Narration audio not found — generate narration first" };

	try {
		await fs.mkdir(outDir, { recursive: true });

		// Build the character: a HeyGen library avatar, or our uploaded photo.
		let character: Record<string, unknown>;
		if (req.avatarId) {
			character = { type: "avatar", avatar_id: req.avatarId, avatar_style: "normal" };
		} else {
			onProgress("Uploading photo…");
			const talkingPhotoId = await uploadTalkingPhoto(req.photoPath as string, apiKey);
			character = {
				type: "talking_photo",
				talking_photo_id: talkingPhotoId,
				// Avatar IV gets richer motion; Photo Avatar stays steady for a small PiP.
				...(req.tier === "iv" ? { talking_photo_style: "expressive" } : {}),
			};
		}

		onProgress("Uploading narration…");
		const audio = await uploadAsset(req.audioPath, apiKey);

		onProgress("Starting avatar…");
		const videoId = await startGeneration(req, character, audio.id, apiKey);

		// Poll. HeyGen has no webhook here, so back off from 5s.
		const deadline = Date.now() + 10 * 60 * 1000;
		let waited = 0;
		while (Date.now() < deadline) {
			await sleep(5000);
			waited += 5;
			const s = await checkStatus(videoId, apiKey);
			if (s.status === "completed" && s.videoUrl) {
				onProgress("Downloading…");
				const format: "webm" | "mp4" = req.transparent ? "webm" : "mp4";
				const out = `${outDir}/avatar-${videoId}.${format}`;
				await downloadTo(s.videoUrl, out);
				return { ok: true, path: out, format };
			}
			if (s.status === "failed") {
				return { ok: false, error: s.error || "HeyGen reported generation failed" };
			}
			onProgress(`Generating… ${waited}s`);
		}
		return { ok: false, error: "Timed out waiting for HeyGen (10 min)" };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
