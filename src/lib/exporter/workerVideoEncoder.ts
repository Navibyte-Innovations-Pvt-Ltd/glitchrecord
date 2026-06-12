/**
 * workerVideoEncoder.ts
 *
 * `WorkerVideoEncoder` — a drop-in proxy that mimics the WebCodecs
 * `VideoEncoder` API but runs the real encoder inside a DedicatedWorker
 * (`videoEncoder.worker.ts`).
 *
 * WHY: In this Electron build (39.2.7 / Chromium ~138) `VideoEncoder` is exposed
 * ONLY inside Workers, not the main renderer frame. Every export path encodes on
 * the main thread via `new VideoEncoder()`, so headless/automated export throws
 * `VideoEncoder is not defined`. This proxy keeps the existing main-thread export
 * code unchanged in shape while the actual encoding happens in a worker.
 *
 * The API surface reproduced (used by the exporters):
 *  - constructor({ output, error })
 *  - configure(config)
 *  - encode(frame, { keyFrame })
 *  - flush(): Promise<void>
 *  - close()
 *  - reset()
 *  - get state(): "unconfigured" | "configured" | "closed"   (SYNC)
 *  - get encodeQueueSize(): number                            (SYNC)
 *  - static isConfigSupported(config): Promise<{ supported, config }>
 *
 * Hard parts handled here:
 *  1. `.state` / `.encodeQueueSize` are read synchronously (37× across the
 *     exporters) but the worker is async. We MIRROR them locally: set `state`
 *     synchronously on configure/close/error, and track `encodeQueueSize` with a
 *     synchronous local `++` on `encode()` plus the worker's *real* queue size
 *     piggybacked on every worker message (authoritative, prevents drift).
 *  2. `VideoFrame` is Transferable — `encode(frame)` transfers it to the worker.
 *     Probed: after transfer the main-side `frame.close()` (which every call site
 *     does) is a harmless no-op, so call sites need no change.
 *  3. Ordered `EncodedVideoChunk` output — the worker copies each chunk to an
 *     ArrayBuffer and transfers it; we rebuild a REAL `EncodedVideoChunk` on the
 *     main thread (probed constructible here) so mediabunny's `instanceof` check
 *     in `EncodedPacket.fromEncodedChunk` passes.
 *  4. `isConfigSupported` (static) round-trips to a shared support worker.
 */

import WorkerConstructor from "./videoEncoder.worker?worker";

// ---------------------------------------------------------------------------
// Wire protocol types (shared with videoEncoder.worker.ts)
// ---------------------------------------------------------------------------

export interface WorkerChunkPayload {
	type: "key" | "delta";
	timestamp: number;
	duration?: number;
	data: ArrayBuffer;
}

export interface WorkerChunkMeta {
	decoderConfig?: {
		codec: string;
		codedWidth?: number;
		codedHeight?: number;
		description?: ArrayBuffer;
		colorSpace?: {
			primaries?: VideoColorPrimaries;
			transfer?: VideoTransferCharacteristics;
			matrix?: VideoMatrixCoefficients;
			fullRange?: boolean;
		};
	};
}

export type WorkerInbound =
	| { kind: "configure"; id: number; config: VideoEncoderConfig }
	| { kind: "encode"; frame: VideoFrame; options?: VideoEncoderEncodeOptions }
	| { kind: "flush"; id: number }
	| { kind: "reset"; id: number }
	| { kind: "close" }
	| { kind: "isConfigSupported"; id: number; config: VideoEncoderConfig };

/** Worker→main message bodies, before the per-message `queueSize` is attached. */
export type WorkerOutboundBody =
	| { kind: "output"; chunk: WorkerChunkPayload; meta?: WorkerChunkMeta }
	| { kind: "error"; message: string; name: string }
	| { kind: "configure-ack"; id: number; error?: string }
	| { kind: "flush-done"; id: number; error?: string }
	| { kind: "reset-done"; id: number; error?: string }
	| { kind: "isConfigSupported-result"; id: number; supported: boolean; error?: string };

export type WorkerOutbound = WorkerOutboundBody & { queueSize: number };

// ---------------------------------------------------------------------------
// Output adapter — rebuild a real EncodedVideoChunk + meta on the main thread
// ---------------------------------------------------------------------------

function rebuildChunk(payload: WorkerChunkPayload): EncodedVideoChunk {
	return new EncodedVideoChunk({
		type: payload.type,
		timestamp: payload.timestamp,
		duration: payload.duration,
		data: payload.data,
	});
}

function rebuildMeta(meta: WorkerChunkMeta | undefined): EncodedVideoChunkMetadata | undefined {
	if (!meta?.decoderConfig) return undefined;
	const dc = meta.decoderConfig;
	const decoderConfig: VideoDecoderConfig = {
		codec: dc.codec,
		codedWidth: dc.codedWidth,
		codedHeight: dc.codedHeight,
	};
	if (dc.description) {
		decoderConfig.description = new Uint8Array(dc.description);
	}
	if (dc.colorSpace) {
		decoderConfig.colorSpace = dc.colorSpace;
	}
	return { decoderConfig };
}

// ---------------------------------------------------------------------------
// Static isConfigSupported — one shared support worker, reused across calls
// ---------------------------------------------------------------------------

let supportWorker: Worker | null = null;
let supportSeq = 0;
const supportPending = new Map<number, (v: { supported: boolean; error?: string }) => void>();

function getSupportWorker(): Worker {
	if (!supportWorker) {
		const w = new WorkerConstructor();
		w.addEventListener("message", (e: MessageEvent<WorkerOutbound>) => {
			const msg = e.data;
			if (msg.kind === "isConfigSupported-result") {
				const resolve = supportPending.get(msg.id);
				if (resolve) {
					supportPending.delete(msg.id);
					resolve({ supported: msg.supported, error: msg.error });
				}
			}
		});
		w.addEventListener("error", () => {
			for (const resolve of supportPending.values()) {
				resolve({ supported: false, error: "support worker error" });
			}
			supportPending.clear();
		});
		supportWorker = w;
	}
	return supportWorker;
}

// ---------------------------------------------------------------------------
// The proxy
// ---------------------------------------------------------------------------

type VideoEncoderState = "unconfigured" | "configured" | "closed";

export interface WorkerVideoEncoderInit {
	output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
	// Matches the native WebCodecs error callback signature so existing call sites
	// typed `(error: DOMException) => void` assign cleanly.
	error: (error: DOMException) => void;
}

function toDomException(value: unknown, name = "EncodingError"): DOMException {
	if (value instanceof DOMException) return value;
	const message = value instanceof Error ? value.message : String(value);
	return new DOMException(message, name);
}

export class WorkerVideoEncoder {
	private worker: Worker;
	private readonly outputCb: WorkerVideoEncoderInit["output"];
	private readonly errorCb: WorkerVideoEncoderInit["error"];

	// SYNC-mirrored state (read 37× across exporters)
	private _state: VideoEncoderState = "unconfigured";
	private _localQueue = 0; // incremented sync on encode(), decremented sync on output
	private _workerQueue = 0; // authoritative real queue size piggybacked from worker

	private seq = 0;
	private readonly pending = new Map<number, (error?: string) => void>();

	constructor(init: WorkerVideoEncoderInit) {
		this.outputCb = init.output;
		this.errorCb = init.error;
		this.worker = new WorkerConstructor();
		this.worker.addEventListener("message", this.onMessage);
		this.worker.addEventListener("error", this.onWorkerError);
	}

	get state(): VideoEncoderState {
		return this._state;
	}

	get encodeQueueSize(): number {
		// Use the larger of our optimistic local count and the worker's real
		// queue size so backpressure never under-reports.
		return Math.max(this._localQueue, this._workerQueue);
	}

	configure(config: VideoEncoderConfig): void {
		// Mirror native VideoEncoder: configure is synchronous-looking and sets
		// state immediately. We forward async; the exporter only checks
		// `state === "configured"` afterwards, never awaits configure.
		this._state = "configured";
		const id = ++this.seq;
		this.worker.postMessage({ kind: "configure", id, config } satisfies WorkerInbound);
	}

	encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
		if (this._state !== "configured") {
			// Match native behavior: encode() on a non-configured encoder throws.
			try {
				frame.close();
			} catch {
				/* noop */
			}
			throw new DOMException(`Cannot encode in state ${this._state}`, "InvalidStateError");
		}
		this._localQueue++;
		// Transfer the frame to the worker. After this the main-side frame is
		// detached; the call site's subsequent frame.close() is a no-op (probed).
		this.worker.postMessage({ kind: "encode", frame, options } satisfies WorkerInbound, [
			frame,
		]);
	}

	flush(): Promise<void> {
		const id = ++this.seq;
		return new Promise<void>((resolve, reject) => {
			this.pending.set(id, (error) => {
				if (error) reject(new Error(error));
				else resolve();
			});
			this.worker.postMessage({ kind: "flush", id } satisfies WorkerInbound);
		});
	}

	reset(): void {
		this._state = "unconfigured";
		this._localQueue = 0;
		this._workerQueue = 0;
		const id = ++this.seq;
		this.worker.postMessage({ kind: "reset", id } satisfies WorkerInbound);
	}

	close(): void {
		if (this._state === "closed") return;
		this._state = "closed";
		this._localQueue = 0;
		this._workerQueue = 0;
		try {
			this.worker.postMessage({ kind: "close" } satisfies WorkerInbound);
		} catch {
			/* ignore */
		}
		// Tear down asynchronously to let the close message flush first.
		const w = this.worker;
		queueMicrotask(() => {
			try {
				w.terminate();
			} catch {
				/* ignore */
			}
		});
	}

	static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
		const worker = getSupportWorker();
		const id = ++supportSeq;
		const result = await new Promise<{ supported: boolean; error?: string }>((resolve) => {
			supportPending.set(id, resolve);
			worker.postMessage({ kind: "isConfigSupported", id, config } satisfies WorkerInbound);
		});
		return { supported: result.supported, config };
	}

	private onMessage = (e: MessageEvent<WorkerOutbound>): void => {
		const msg = e.data;
		// Every message carries the worker's real queue size.
		this._workerQueue = msg.queueSize;

		switch (msg.kind) {
			case "output": {
				// Worker enqueued -> emitted one chunk; reflect drain locally.
				if (this._localQueue > 0) this._localQueue--;
				if (this._state === "closed") return;
				try {
					const chunk = rebuildChunk(msg.chunk);
					const meta = rebuildMeta(msg.meta);
					this.outputCb(chunk, meta);
				} catch (err) {
					this.errorCb(toDomException(err));
				}
				return;
			}
			case "error": {
				// Native VideoEncoder closes itself on a fatal error; mirror that so
				// `while (state === "configured")` backpressure loops exit.
				this._state = "closed";
				this._localQueue = 0;
				this._workerQueue = 0;
				const err = new DOMException(msg.message, msg.name || "EncodingError");
				this.errorCb(err);
				return;
			}
			case "configure-ack": {
				const resolve = this.pending.get(msg.id);
				if (resolve) {
					this.pending.delete(msg.id);
					resolve(msg.error);
				}
				if (msg.error) {
					this._state = "closed";
					this.errorCb(toDomException(msg.error));
				}
				return;
			}
			case "flush-done": {
				const resolve = this.pending.get(msg.id);
				if (resolve) {
					this.pending.delete(msg.id);
					resolve(msg.error);
				}
				return;
			}
			case "reset-done": {
				const resolve = this.pending.get(msg.id);
				if (resolve) {
					this.pending.delete(msg.id);
					resolve(msg.error);
				}
				return;
			}
			case "isConfigSupported-result":
				// handled by the support worker listener
				return;
		}
	};

	private onWorkerError = (e: ErrorEvent): void => {
		this._state = "closed";
		this._localQueue = 0;
		this._workerQueue = 0;
		this.errorCb(toDomException(e.message || "WorkerVideoEncoder worker error"));
		for (const resolve of this.pending.values()) {
			resolve(e.message || "worker error");
		}
		this.pending.clear();
	};
}
