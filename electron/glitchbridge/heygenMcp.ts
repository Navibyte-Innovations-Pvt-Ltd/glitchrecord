// HeyGen via Remote MCP (OAuth) — the "Connect HeyGen account" provider.
//
// Unlike the REST client (heygen.ts, API key, pay-as-you-go wallet), this talks to
// HeyGen's hosted MCP server with the USER's OAuth login, so generation is billed
// to their HeyGen SUBSCRIPTION credits (much cheaper at volume). The user authorizes
// once via a browser consent screen (no API key). Tokens are encrypted on device.
//
// Endpoint: https://mcp.heygen.com/mcp/v1/ (Streamable HTTP). Tools we use:
//   create_asset_upload → (PUT bytes) → create_video_from_avatar → get_video.

import fssync from "node:fs";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import {
	type OAuthClientProvider,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
	OAuthClientInformation,
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { app, safeStorage, shell } from "electron";

const MCP_URL = "https://mcp.heygen.com/mcp/v1/";
const CALLBACK_PORT = 7339; // loopback OAuth redirect — must be registered via DCR

interface PersistedAuth {
	clientInformation?: OAuthClientInformationFull;
	tokens?: OAuthTokens;
	codeVerifier?: string;
}

function authFilePath(): string {
	return path.join(app.getPath("userData"), "heygen-mcp-auth.enc");
}

async function loadPersisted(): Promise<PersistedAuth> {
	try {
		const file = authFilePath();
		if (!fssync.existsSync(file)) return {};
		const enc = await fs.readFile(file);
		const json = safeStorage.isEncryptionAvailable()
			? safeStorage.decryptString(enc)
			: enc.toString("utf8");
		return JSON.parse(json) as PersistedAuth;
	} catch {
		return {};
	}
}

async function savePersisted(data: PersistedAuth): Promise<void> {
	try {
		const json = JSON.stringify(data);
		const buf = safeStorage.isEncryptionAvailable()
			? safeStorage.encryptString(json)
			: Buffer.from(json, "utf8");
		await fs.writeFile(authFilePath(), buf);
	} catch {
		/* best-effort persistence */
	}
}

// Resolves with the ?code from the OAuth redirect hitting our loopback server.
function waitForCallbackCode(): { promise: Promise<string>; close: () => void } {
	let server: Server | null = null;
	const promise = new Promise<string>((resolve, reject) => {
		server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);
			if (url.pathname !== "/callback") {
				res.writeHead(404).end();
				return;
			}
			const code = url.searchParams.get("code");
			const err = url.searchParams.get("error");
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				`<html><body style="font-family:system-ui;padding:40px;text-align:center"><h2>${
					code ? "HeyGen connected ✓" : "Authorization failed"
				}</h2><p>You can close this tab and return to GlitchRecord.</p></body></html>`,
			);
			if (code) resolve(code);
			else reject(new Error(err || "No authorization code in callback"));
		});
		server.on("error", reject);
		server.listen(CALLBACK_PORT, "127.0.0.1");
	});
	return { promise, close: () => server?.close() };
}

class HeyGenOAuthProvider implements OAuthClientProvider {
	private data: PersistedAuth;
	constructor(data: PersistedAuth) {
		this.data = data;
	}
	get redirectUrl(): string {
		return `http://127.0.0.1:${CALLBACK_PORT}/callback`;
	}
	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "GlitchRecord",
			redirect_uris: [this.redirectUrl],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}
	clientInformation(): OAuthClientInformation | undefined {
		return this.data.clientInformation;
	}
	async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
		this.data.clientInformation = info;
		await savePersisted(this.data);
	}
	tokens(): OAuthTokens | undefined {
		return this.data.tokens;
	}
	async saveTokens(tokens: OAuthTokens): Promise<void> {
		this.data.tokens = tokens;
		await savePersisted(this.data);
	}
	async redirectToAuthorization(url: URL): Promise<void> {
		await shell.openExternal(url.toString());
	}
	async saveCodeVerifier(verifier: string): Promise<void> {
		this.data.codeVerifier = verifier;
		await savePersisted(this.data);
	}
	codeVerifier(): string {
		if (!this.data.codeVerifier) throw new Error("No code verifier stored");
		return this.data.codeVerifier;
	}
}

let cachedClient: Client | null = null;

// Connect to HeyGen MCP. If not yet authorized, opens the browser consent screen
// and waits for the loopback callback, then completes the OAuth exchange.
export async function connectHeyGenMcp(): Promise<Client> {
	if (cachedClient) return cachedClient;
	const persisted = await loadPersisted();
	const provider = new HeyGenOAuthProvider(persisted);
	const client = new Client({ name: "glitchrecord", version: "1.0.0" }, { capabilities: {} });
	const newTransport = () =>
		new StreamableHTTPClientTransport(new URL(MCP_URL), {
			authProvider: provider,
		});

	const transport = newTransport();
	try {
		await client.connect(transport);
	} catch (e) {
		if (!(e instanceof UnauthorizedError)) throw e;
		// OAuth needed — the browser was opened by redirectToAuthorization. Catch the
		// callback code on the loopback server and finish the exchange (tokens get
		// persisted via the provider).
		const cb = waitForCallbackCode();
		try {
			const code = await cb.promise;
			await transport.finishAuth(code);
		} finally {
			cb.close();
		}
		// A transport can only be started once — connect with a FRESH one (it now
		// authenticates with the just-saved tokens).
		await client.connect(newTransport());
	}
	cachedClient = client;
	return client;
}

export async function disconnectHeyGenMcp(): Promise<void> {
	try {
		await cachedClient?.close();
	} catch {
		/* ignore */
	}
	cachedClient = null;
	try {
		const file = authFilePath();
		if (fssync.existsSync(file)) await fs.rm(file);
	} catch {
		/* ignore */
	}
}

export async function isHeyGenMcpConnected(): Promise<boolean> {
	if (cachedClient) return true;
	const persisted = await loadPersisted();
	return !!persisted.tokens?.access_token;
}

function parseToolJson<T>(res: unknown): T {
	const content = (res as { content?: unknown }).content as
		| Array<{ type?: string; text?: string }>
		| undefined;
	const text = Array.isArray(content) && content[0]?.type === "text" ? content[0].text : "{}";
	return JSON.parse(text ?? "{}") as T;
}

function mimeForAudio(p: string): string {
	const lower = p.toLowerCase();
	if (lower.endsWith(".mp3")) return "audio/mpeg";
	if (lower.endsWith(".wav")) return "audio/x-wav";
	if (lower.endsWith(".m4a")) return "audio/mp4";
	return "application/octet-stream";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Generate an avatar clip through the user's HeyGen subscription (MCP). Mirrors the
// REST generateAvatar but bills subscription credits. Library look only (avatarId).
export async function generateAvatarViaMcp(
	opts: { audioPath: string; avatarId: string; transparent?: boolean },
	outDir: string,
	onProgress: (stage: string) => void = () => undefined,
): Promise<{ ok: boolean; path?: string; format?: "webm" | "mp4"; error?: string }> {
	try {
		if (!fssync.existsSync(opts.audioPath))
			return { ok: false, error: "Narration audio not found — generate narration first" };
		await fs.mkdir(outDir, { recursive: true });
		const client = await connectHeyGenMcp();

		// 1. Upload the narration audio (presigned S3).
		onProgress("Uploading narration…");
		const bytes = await fs.readFile(opts.audioPath);
		const filename = path.basename(opts.audioPath);
		const contentType = mimeForAudio(opts.audioPath);
		const up = parseToolJson<{
			asset_id?: string;
			assetId?: string;
			upload_url?: string;
			uploadUrl?: string;
		}>(
			await client.callTool({
				name: "create_asset_upload",
				arguments: { filename, contentType, sizeBytes: bytes.length },
			}),
		);
		const assetId = up.asset_id ?? up.assetId;
		const uploadUrl = up.upload_url ?? up.uploadUrl;
		if (!assetId || !uploadUrl) return { ok: false, error: "Asset upload init failed" };
		const put = await fetch(uploadUrl, {
			method: "PUT",
			headers: { "Content-Type": contentType },
			body: new Uint8Array(bytes),
		});
		if (!put.ok) return { ok: false, error: `Audio PUT ${put.status}` };
		await client.callTool({ name: "complete_asset_upload", arguments: { assetId } });

		// 2. Create the avatar video (audio-driven, Avatar IV default).
		onProgress("Starting avatar…");
		const vid = parseToolJson<{ video_id?: string; videoId?: string }>(
			await client.callTool({
				name: "create_video_from_avatar",
				arguments: {
					avatarId: opts.avatarId,
					audioAssetId: assetId,
					aspectRatio: "9:16",
					outputFormat: opts.transparent ? "webm" : "mp4",
				},
			}),
		);
		const videoId = vid.video_id ?? vid.videoId;
		if (!videoId) return { ok: false, error: "Video creation returned no id" };

		// 3. Poll until ready, then download.
		const deadline = Date.now() + 10 * 60 * 1000;
		let waited = 0;
		while (Date.now() < deadline) {
			await sleep(5000);
			waited += 5;
			const v = parseToolJson<{
				status?: string;
				video_url?: string;
				videoUrl?: string;
				error?: unknown;
			}>(await client.callTool({ name: "get_video", arguments: { videoId } }));
			const url = v.video_url ?? v.videoUrl;
			if ((v.status === "completed" || v.status === "success") && url) {
				onProgress("Downloading…");
				const format: "webm" | "mp4" = opts.transparent ? "webm" : "mp4";
				const out = path.join(outDir, `avatar-${videoId}.${format}`);
				const dl = await fetch(url);
				if (!dl.ok) return { ok: false, error: `Download ${dl.status}` };
				await fs.writeFile(out, Buffer.from(await dl.arrayBuffer()));
				return { ok: true, path: out, format };
			}
			if (v.status === "failed" || v.status === "error") {
				return { ok: false, error: `HeyGen reported ${v.status}` };
			}
			onProgress(`Generating… ${waited}s`);
		}
		return { ok: false, error: "Timed out waiting for HeyGen (10 min)" };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// Proof-of-connection: the authenticated user's plan + remaining credits.
export async function getHeyGenMcpUser(): Promise<{
	ok: boolean;
	email?: string;
	plan?: string;
	creditsRemaining?: number;
	error?: string;
}> {
	try {
		const client = await connectHeyGenMcp();
		const res = await client.callTool({ name: "get_current_user", arguments: {} });
		const text =
			Array.isArray(res.content) && res.content[0]?.type === "text"
				? res.content[0].text
				: "{}";
		const u = JSON.parse(text) as {
			email?: string;
			subscription?: {
				plan?: string;
				credits?: { premium_credits?: { remaining?: number } };
			};
		};
		return {
			ok: true,
			email: u.email,
			plan: u.subscription?.plan,
			creditsRemaining: u.subscription?.credits?.premium_credits?.remaining,
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
