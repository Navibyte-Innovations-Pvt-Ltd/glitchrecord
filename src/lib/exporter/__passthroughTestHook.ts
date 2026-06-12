/**
 * __passthroughTestHook.ts
 *
 * Test-only hook that proves the worker-backed WebCodecs proxies
 * (`WorkerVideoEncoder` + `WorkerVideoDecoder`) work end-to-end under real frame
 * flow — independent of the pixi GPU render step that is blocked in headless
 * Electron. It demuxes a source mp4 on the main thread, decodes via the decoder
 * proxy, re-encodes each decoded frame via the encoder proxy (no rendering), and
 * muxes the result to an in-memory mp4 buffer.
 *
 * Gated behind `?ggPassthroughTest=1`; never registered in production.
 *
 * Registered by main.tsx. The Playwright harness calls
 * `window.__ggPassthroughTest({ inputUrl, maxSeconds })` and ffprobes the bytes.
 */

import { WorkerVideoDecoder } from "./workerVideoDecoder";
import { WorkerVideoEncoder } from "./workerVideoEncoder";

export interface PassthroughTestOptions {
	inputUrl: string;
	maxSeconds?: number;
}

export interface PassthroughTestResult {
	ok: boolean;
	error?: string;
	framesDecoded?: number;
	framesEncoded?: number;
	chunkCount?: number;
	bytes?: number[];
}

async function runPassthroughTest(options: PassthroughTestOptions): Promise<PassthroughTestResult> {
	try {
		const { WebDemuxer } = await import("web-demuxer");
		const mb = await import("mediabunny");

		const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });

		const resp = await fetch(options.inputUrl);
		const blob = await resp.blob();
		const file = new File([blob], "input.mp4", { type: "video/mp4" });
		await demuxer.load(file);

		const decoderConfig = await demuxer.getDecoderConfig("video");
		const width = decoderConfig.codedWidth ?? 1280;
		const height = decoderConfig.codedHeight ?? 720;

		// mediabunny muxer → in-memory buffer
		const target = new mb.BufferTarget();
		const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target });
		const videoSource = new mb.EncodedVideoPacketSource("avc");
		output.addVideoTrack(videoSource, { frameRate: 30 });
		await output.start();

		let videoDescription: Uint8Array | undefined;
		let chunkCount = 0;
		let pendingMux: Promise<void> = Promise.resolve();
		let muxError: Error | null = null;

		const encoder = new WorkerVideoEncoder({
			output: (chunk, meta) => {
				if (meta?.decoderConfig?.description && !videoDescription) {
					const d = meta.decoderConfig.description;
					videoDescription = ArrayBuffer.isView(d)
						? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
						: new Uint8Array(d);
				}
				const isFirst = chunkCount === 0;
				chunkCount++;
				pendingMux = pendingMux.then(async () => {
					try {
						const packet = mb.EncodedPacket.fromEncodedChunk(chunk);
						if (isFirst && videoDescription) {
							await videoSource.add(packet, {
								decoderConfig: {
									codec: "avc1.640033",
									codedWidth: width,
									codedHeight: height,
									description: videoDescription,
								},
							});
						} else {
							await videoSource.add(packet, meta);
						}
					} catch (e) {
						muxError = e instanceof Error ? e : new Error(String(e));
					}
				});
			},
			error: (e) => {
				muxError = e instanceof Error ? e : new Error(String(e));
			},
		});

		let encConfig: VideoEncoderConfig | null = null;
		for (const hw of ["prefer-hardware", "prefer-software"] as const) {
			const cfg: VideoEncoderConfig = {
				codec: "avc1.640033",
				width,
				height,
				bitrate: 5_000_000,
				framerate: 30,
				hardwareAcceleration: hw,
				latencyMode: "quality",
				bitrateMode: "variable",
			};
			const s = await WorkerVideoEncoder.isConfigSupported(cfg);
			if (s.supported) {
				encConfig = cfg;
				break;
			}
		}
		if (!encConfig) throw new Error("no supported encoder config");
		encoder.configure(encConfig);

		// Decoder
		let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
		const pending: VideoFrame[] = [];
		let decodeError: Error | null = null;
		let decodeDone = false;

		const decoder = new WorkerVideoDecoder({
			output: (frame) => {
				if (frameResolve) {
					const r = frameResolve;
					frameResolve = null;
					r(frame);
				} else {
					pending.push(frame);
				}
			},
			error: (e) => {
				decodeError = e instanceof Error ? e : new Error(String(e));
				if (frameResolve) {
					const r = frameResolve;
					frameResolve = null;
					r(null);
				}
			},
		});
		decoder.configure(decoderConfig);

		const getNext = (): Promise<VideoFrame | null> => {
			if (decodeError) throw decodeError;
			if (pending.length) return Promise.resolve(pending.shift()!);
			if (decodeDone) return Promise.resolve(null);
			return new Promise((r) => {
				frameResolve = r;
			});
		};

		const maxSec = options.maxSeconds ?? 5;
		const reader = demuxer.read("video", 0, maxSec).getReader();
		const feed = (async () => {
			try {
				while (true) {
					const { done, value: chunk } = await reader.read();
					if (done || !chunk) break;
					while (decoder.decodeQueueSize > 12) {
						await new Promise((r) => setTimeout(r, 2));
					}
					decoder.decode(chunk);
				}
				if (decoder.state === "configured") await decoder.flush();
			} catch (e) {
				decodeError = e instanceof Error ? e : new Error(String(e));
			} finally {
				decodeDone = true;
				const r = frameResolve;
				if (r) {
					frameResolve = null;
					(r as (frame: VideoFrame | null) => void)(null);
				}
			}
		})();

		let framesDecoded = 0;
		let framesEncoded = 0;
		while (true) {
			const frame = await getNext();
			if (!frame) break;
			framesDecoded++;
			while (encoder.encodeQueueSize > 12) {
				await new Promise((r) => setTimeout(r, 2));
			}
			const ts = Math.round((framesEncoded * 1_000_000) / 30);
			const vf = new VideoFrame(frame, {
				timestamp: ts,
				duration: Math.round(1_000_000 / 30),
			});
			frame.close();
			encoder.encode(vf, { keyFrame: framesEncoded % 150 === 0 });
			vf.close();
			framesEncoded++;
		}

		await feed;
		await encoder.flush();
		await pendingMux;
		if (muxError) throw muxError;
		await output.finalize();

		const buf = target.buffer;
		if (!buf) throw new Error("muxer produced no buffer");

		return {
			ok: true,
			framesDecoded,
			framesEncoded,
			chunkCount,
			bytes: Array.from(new Uint8Array(buf)),
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export function registerPassthroughTestHook(): void {
	(window as unknown as { __ggPassthroughTest?: typeof runPassthroughTest }).__ggPassthroughTest =
		runPassthroughTest;
}
