/**
 * videoEncoder.worker.ts
 *
 * Runs the real WebCodecs `VideoEncoder` inside a DedicatedWorker.
 *
 * WHY: In this Electron build (39.2.7 / Chromium ~138) `VideoEncoder` is exposed
 * ONLY inside Workers, not the main renderer frame (probed: main `undefined`,
 * worker `function`). Headless/automated mp4 export therefore fails on the main
 * thread with `VideoEncoder is not defined`. We move the encode here and proxy
 * the API from the main thread via `WorkerVideoEncoder`.
 *
 * Protocol (main -> worker): see `WorkerInbound` in workerVideoEncoder.ts
 * Protocol (worker -> main): see `WorkerOutbound`.
 *
 * Ordering guarantees we rely on:
 *  - `postMessage` delivers messages to the main thread in send order, so an
 *    `output` message posted before a `flush-done`/`reset-done` message always
 *    arrives first. We post `output` synchronously from the encoder's `output`
 *    callback, then post the `flush-done` only after the real `flush()` promise
 *    resolves -> all chunks precede the flush ack.
 *  - We piggyback the worker's *real* `encoder.encodeQueueSize` on every message
 *    so the main-thread proxy can mirror backpressure accurately.
 */

import type {
	WorkerChunkMeta,
	WorkerChunkPayload,
	WorkerInbound,
	WorkerOutbound,
	WorkerOutboundBody,
} from "./workerVideoEncoder";

interface WorkerScope {
	onmessage: ((e: MessageEvent<WorkerInbound>) => void) | null;
	postMessage: (message: WorkerOutbound, transfer?: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;

let encoder: VideoEncoder | null = null;

function currentQueueSize(): number {
	return encoder ? encoder.encodeQueueSize : 0;
}

/** Post a message tagging it with the real queue size for the main mirror. */
function post(message: WorkerOutboundBody, transfer?: Transferable[]): void {
	scope.postMessage({ ...message, queueSize: currentQueueSize() } as WorkerOutbound, transfer);
}

function serializeMeta(meta: EncodedVideoChunkMetadata | undefined): WorkerChunkMeta | undefined {
	if (!meta) return undefined;
	const out: WorkerChunkMeta = {};
	const dc = meta.decoderConfig;
	if (dc) {
		let description: ArrayBuffer | undefined;
		if (dc.description) {
			const d = dc.description;
			const view = ArrayBuffer.isView(d)
				? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
				: new Uint8Array(d);
			// Copy into a fresh ArrayBuffer so we can transfer it without
			// detaching the encoder's internal buffer.
			const copy = new Uint8Array(view.byteLength);
			copy.set(view);
			description = copy.buffer;
		}
		out.decoderConfig = {
			codec: dc.codec,
			codedWidth: dc.codedWidth,
			codedHeight: dc.codedHeight,
			description,
			colorSpace: dc.colorSpace
				? {
						primaries: dc.colorSpace.primaries ?? undefined,
						transfer: dc.colorSpace.transfer ?? undefined,
						matrix: dc.colorSpace.matrix ?? undefined,
						fullRange: dc.colorSpace.fullRange ?? undefined,
					}
				: undefined,
		};
	}
	return out;
}

function handleOutput(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
	const data = new ArrayBuffer(chunk.byteLength);
	chunk.copyTo(data);
	const payload: WorkerChunkPayload = {
		type: chunk.type,
		timestamp: chunk.timestamp,
		duration: chunk.duration ?? undefined,
		data,
	};
	const serializedMeta = serializeMeta(meta);
	const transfer: Transferable[] = [data];
	if (serializedMeta?.decoderConfig?.description) {
		transfer.push(serializedMeta.decoderConfig.description);
	}
	post({ kind: "output", chunk: payload, meta: serializedMeta }, transfer);
}

function createEncoder(): void {
	encoder = new VideoEncoder({
		output: (chunk, meta) => {
			try {
				handleOutput(chunk, meta);
			} catch (err) {
				post({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
					name: err instanceof Error ? err.name : "Error",
				});
			}
		},
		error: (err) => {
			post({
				kind: "error",
				message: err instanceof Error ? err.message : String(err),
				name: err instanceof Error ? err.name : "Error",
			});
		},
	});
}

scope.onmessage = async (e: MessageEvent<WorkerInbound>) => {
	const msg = e.data;
	switch (msg.kind) {
		case "isConfigSupported": {
			try {
				const support = await VideoEncoder.isConfigSupported(msg.config);
				post({
					kind: "isConfigSupported-result",
					id: msg.id,
					supported: !!support.supported,
					// `config` from support is informational; we don't round-trip it.
				});
			} catch (err) {
				post({
					kind: "isConfigSupported-result",
					id: msg.id,
					supported: false,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			return;
		}
		case "configure": {
			try {
				if (!encoder || encoder.state === "closed") {
					createEncoder();
				}
				encoder!.configure(msg.config);
				post({ kind: "configure-ack", id: msg.id });
			} catch (err) {
				post({
					kind: "configure-ack",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			return;
		}
		case "encode": {
			const frame = msg.frame;
			try {
				if (!encoder || encoder.state !== "configured") {
					frame.close();
					post({
						kind: "error",
						message: `encode() called while encoder state is ${encoder?.state ?? "null"}`,
						name: "InvalidStateError",
					});
					return;
				}
				encoder.encode(frame, msg.options);
			} catch (err) {
				post({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
					name: err instanceof Error ? err.name : "Error",
				});
			} finally {
				// The worker now owns the transferred frame; release GPU memory.
				try {
					frame.close();
				} catch {
					/* already closed */
				}
			}
			return;
		}
		case "flush": {
			try {
				if (!encoder) {
					post({ kind: "flush-done", id: msg.id });
					return;
				}
				await encoder.flush();
				post({ kind: "flush-done", id: msg.id });
			} catch (err) {
				post({
					kind: "flush-done",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			return;
		}
		case "reset": {
			try {
				if (encoder && encoder.state !== "closed") {
					encoder.reset();
				}
				post({ kind: "reset-done", id: msg.id });
			} catch (err) {
				post({
					kind: "reset-done",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			return;
		}
		case "close": {
			try {
				if (encoder && encoder.state !== "closed") {
					encoder.close();
				}
			} catch {
				/* ignore */
			}
			encoder = null;
			return;
		}
	}
};
