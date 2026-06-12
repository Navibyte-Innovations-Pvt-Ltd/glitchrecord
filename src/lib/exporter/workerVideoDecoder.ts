/**
 * workerVideoDecoder.ts
 *
 * `WorkerVideoDecoder` — a drop-in proxy that mimics the WebCodecs
 * `VideoDecoder` API but runs the real decoder inside a DedicatedWorker
 * (`videoDecoder.worker.ts`).
 *
 * WHY: In this Electron build (39.2.7 / Chromium ~138) `VideoDecoder` is exposed
 * ONLY inside Workers, not the main renderer frame. The export pipelines decode
 * the source mp4 frame-by-frame via a main-thread `new VideoDecoder()` (to apply
 * speed/trim edits), so headless export throws `VideoDecoder is not defined` even
 * after the encoder was moved to a worker. This proxy keeps the existing
 * main-thread decode code unchanged in shape.
 *
 * API surface reproduced (used by streamingDecoder / forwardFrameSource):
 *  - constructor({ output, error })
 *  - configure(config)
 *  - decode(chunk)
 *  - flush(): Promise<void>
 *  - close()
 *  - reset()
 *  - get state()             (SYNC)
 *  - get decodeQueueSize()   (SYNC)
 *  - static isConfigSupported(config)
 *
 * Direction-specific handling:
 *  1. Input `EncodedVideoChunk` is built on MAIN by the demuxer and is NOT
 *     Transferable. `decode()` copies it to an ArrayBuffer + {type,timestamp,
 *     duration}, transfers that, and the worker rebuilds a real chunk.
 *  2. Output `VideoFrame` IS Transferable — it round-trips worker->main and is
 *     handed to the existing `output` callback unchanged (probed: renders fine).
 *  3. `state` / `decodeQueueSize` are read synchronously — mirrored locally and
 *     reconciled against the worker's real queue size piggybacked on every msg.
 */

import WorkerConstructor from "./videoDecoder.worker?worker";

// ---------------------------------------------------------------------------
// Wire protocol types (shared with videoDecoder.worker.ts)
// ---------------------------------------------------------------------------

export interface DecoderChunkPayload {
	type: "key" | "delta";
	timestamp: number;
	duration?: number;
	data: ArrayBuffer;
}

export type DecoderWorkerInbound =
	| { kind: "configure"; id: number; config: VideoDecoderConfig }
	| { kind: "decode"; chunk: DecoderChunkPayload }
	| { kind: "flush"; id: number }
	| { kind: "reset"; id: number }
	| { kind: "close" }
	| { kind: "isConfigSupported"; id: number; config: VideoDecoderConfig };

/** Worker→main message bodies, before the per-message `queueSize` is attached. */
export type DecoderWorkerOutboundBody =
	| { kind: "output"; frame: VideoFrame }
	| { kind: "error"; message: string; name: string }
	| { kind: "configure-ack"; id: number; error?: string }
	| { kind: "flush-done"; id: number; error?: string }
	| { kind: "reset-done"; id: number; error?: string }
	| { kind: "isConfigSupported-result"; id: number; supported: boolean; error?: string };

export type DecoderWorkerOutbound = DecoderWorkerOutboundBody & { queueSize: number };

// ---------------------------------------------------------------------------
// Static isConfigSupported — one shared support worker
// ---------------------------------------------------------------------------

let supportWorker: Worker | null = null;
let supportSeq = 0;
const supportPending = new Map<number, (v: { supported: boolean; error?: string }) => void>();

function getSupportWorker(): Worker {
	if (!supportWorker) {
		const w = new WorkerConstructor();
		w.addEventListener("message", (e: MessageEvent<DecoderWorkerOutbound>) => {
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

type VideoDecoderState = "unconfigured" | "configured" | "closed";

export interface WorkerVideoDecoderInit {
	output: (frame: VideoFrame) => void;
	// Matches the native WebCodecs error callback signature so existing call sites
	// typed `(e: DOMException) => void` assign cleanly.
	error: (error: DOMException) => void;
}

function toDomException(value: unknown, name = "EncodingError"): DOMException {
	if (value instanceof DOMException) return value;
	const message = value instanceof Error ? value.message : String(value);
	return new DOMException(message, name);
}

function serializeChunk(chunk: EncodedVideoChunk): {
	payload: DecoderChunkPayload;
	transfer: Transferable[];
} {
	const data = new ArrayBuffer(chunk.byteLength);
	chunk.copyTo(data);
	return {
		payload: {
			type: chunk.type,
			timestamp: chunk.timestamp,
			duration: chunk.duration ?? undefined,
			data,
		},
		transfer: [data],
	};
}

export class WorkerVideoDecoder {
	private worker: Worker;
	private readonly outputCb: WorkerVideoDecoderInit["output"];
	private readonly errorCb: WorkerVideoDecoderInit["error"];

	private _state: VideoDecoderState = "unconfigured";
	private _localQueue = 0;
	private _workerQueue = 0;

	private seq = 0;
	private readonly pending = new Map<number, (error?: string) => void>();

	constructor(init: WorkerVideoDecoderInit) {
		this.outputCb = init.output;
		this.errorCb = init.error;
		this.worker = new WorkerConstructor();
		this.worker.addEventListener("message", this.onMessage);
		this.worker.addEventListener("error", this.onWorkerError);
	}

	get state(): VideoDecoderState {
		return this._state;
	}

	get decodeQueueSize(): number {
		return Math.max(this._localQueue, this._workerQueue);
	}

	configure(config: VideoDecoderConfig): void {
		this._state = "configured";
		const id = ++this.seq;
		// `description` (avcC) may be a typed array view; copy into a transferable
		// ArrayBuffer so it round-trips and the worker buffer isn't shared.
		const cloned: VideoDecoderConfig = { ...config };
		const transfer: Transferable[] = [];
		if (config.description) {
			const d = config.description;
			const view = ArrayBuffer.isView(d)
				? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
				: new Uint8Array(d);
			const copy = new Uint8Array(view.byteLength);
			copy.set(view);
			cloned.description = copy.buffer;
			transfer.push(copy.buffer);
		}
		this.worker.postMessage(
			{ kind: "configure", id, config: cloned } satisfies DecoderWorkerInbound,
			transfer,
		);
	}

	decode(chunk: EncodedVideoChunk): void {
		if (this._state !== "configured") {
			throw new DOMException(`Cannot decode in state ${this._state}`, "InvalidStateError");
		}
		this._localQueue++;
		const { payload, transfer } = serializeChunk(chunk);
		this.worker.postMessage(
			{ kind: "decode", chunk: payload } satisfies DecoderWorkerInbound,
			transfer,
		);
	}

	flush(): Promise<void> {
		const id = ++this.seq;
		return new Promise<void>((resolve, reject) => {
			this.pending.set(id, (error) => {
				if (error) reject(new Error(error));
				else resolve();
			});
			this.worker.postMessage({ kind: "flush", id } satisfies DecoderWorkerInbound);
		});
	}

	reset(): void {
		this._state = "unconfigured";
		this._localQueue = 0;
		this._workerQueue = 0;
		const id = ++this.seq;
		this.worker.postMessage({ kind: "reset", id } satisfies DecoderWorkerInbound);
	}

	close(): void {
		if (this._state === "closed") return;
		this._state = "closed";
		this._localQueue = 0;
		this._workerQueue = 0;
		try {
			this.worker.postMessage({ kind: "close" } satisfies DecoderWorkerInbound);
		} catch {
			/* ignore */
		}
		const w = this.worker;
		queueMicrotask(() => {
			try {
				w.terminate();
			} catch {
				/* ignore */
			}
		});
	}

	static async isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport> {
		const worker = getSupportWorker();
		const id = ++supportSeq;
		const result = await new Promise<{ supported: boolean; error?: string }>((resolve) => {
			supportPending.set(id, resolve);
			worker.postMessage({
				kind: "isConfigSupported",
				id,
				config,
			} satisfies DecoderWorkerInbound);
		});
		return { supported: result.supported, config };
	}

	private onMessage = (e: MessageEvent<DecoderWorkerOutbound>): void => {
		const msg = e.data;
		this._workerQueue = msg.queueSize;

		switch (msg.kind) {
			case "output": {
				if (this._localQueue > 0) this._localQueue--;
				if (this._state === "closed") {
					try {
						msg.frame.close();
					} catch {
						/* ignore */
					}
					return;
				}
				try {
					this.outputCb(msg.frame);
				} catch (err) {
					this.errorCb(toDomException(err));
				}
				return;
			}
			case "error": {
				this._state = "closed";
				this._localQueue = 0;
				this._workerQueue = 0;
				this.errorCb(new DOMException(msg.message, msg.name || "EncodingError"));
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
			case "flush-done":
			case "reset-done": {
				const resolve = this.pending.get(msg.id);
				if (resolve) {
					this.pending.delete(msg.id);
					resolve(msg.error);
				}
				return;
			}
			case "isConfigSupported-result":
				return;
		}
	};

	private onWorkerError = (e: ErrorEvent): void => {
		this._state = "closed";
		this._localQueue = 0;
		this._workerQueue = 0;
		this.errorCb(toDomException(e.message || "WorkerVideoDecoder worker error"));
		for (const resolve of this.pending.values()) {
			resolve(e.message || "worker error");
		}
		this.pending.clear();
	};
}
