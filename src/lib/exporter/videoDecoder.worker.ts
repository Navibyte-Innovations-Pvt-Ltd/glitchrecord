/**
 * videoDecoder.worker.ts
 *
 * Runs the real WebCodecs `VideoDecoder` inside a DedicatedWorker.
 *
 * WHY: In this Electron build (39.2.7 / Chromium ~138) `VideoDecoder` (like
 * `VideoEncoder`) is exposed ONLY inside Workers, not the main renderer frame
 * (probed: main `undefined`, worker `function`). The edited- AND raw-export
 * pipelines decode the source mp4 frame-by-frame via a main-thread
 * `new VideoDecoder()` and therefore fail headlessly with
 * `VideoDecoder is not defined`. We move decode here and proxy the API from the
 * main thread via `WorkerVideoDecoder`.
 *
 * Direction notes:
 *  - Input chunks (`EncodedVideoChunk`) are built on the MAIN thread by the
 *    demuxer; they are NOT Transferable, so the proxy ships {type,timestamp,
 *    duration,data:ArrayBuffer} and we rebuild a real `EncodedVideoChunk` here.
 *  - Output `VideoFrame`s ARE Transferable — we transfer them back to main, where
 *    they render correctly (probed: a worker→main frame draws a non-black pixel).
 *  - We piggyback the worker's real `decoder.decodeQueueSize` on every message so
 *    the main-thread proxy mirrors backpressure accurately.
 */

import type {
	DecoderWorkerInbound,
	DecoderWorkerOutbound,
	DecoderWorkerOutboundBody,
} from "./workerVideoDecoder";

interface WorkerScope {
	onmessage: ((e: MessageEvent<DecoderWorkerInbound>) => void) | null;
	postMessage: (message: DecoderWorkerOutbound, transfer?: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;

let decoder: VideoDecoder | null = null;

function currentQueueSize(): number {
	return decoder ? decoder.decodeQueueSize : 0;
}

function post(message: DecoderWorkerOutboundBody, transfer?: Transferable[]): void {
	scope.postMessage(
		{ ...message, queueSize: currentQueueSize() } as DecoderWorkerOutbound,
		transfer,
	);
}

function deserializeDecoderConfig(config: VideoDecoderConfig): VideoDecoderConfig {
	// `description` survived structuredClone as an ArrayBuffer/typed array; the
	// WebCodecs API accepts it directly.
	return config;
}

function createDecoder(): void {
	decoder = new VideoDecoder({
		output: (frame: VideoFrame) => {
			// Transfer the frame back to the main thread for rendering. The frame
			// must appear in BOTH the message body (so main can read it) and the
			// transfer list (so it moves without a copy).
			post({ kind: "output", frame }, [frame]);
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

scope.onmessage = async (e: MessageEvent<DecoderWorkerInbound>) => {
	const msg = e.data;
	switch (msg.kind) {
		case "configure": {
			try {
				if (!decoder || decoder.state === "closed") {
					createDecoder();
				}
				decoder!.configure(deserializeDecoderConfig(msg.config));
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
		case "decode": {
			try {
				if (!decoder || decoder.state !== "configured") {
					post({
						kind: "error",
						message: `decode() called while decoder state is ${decoder?.state ?? "null"}`,
						name: "InvalidStateError",
					});
					return;
				}
				const chunk = new EncodedVideoChunk({
					type: msg.chunk.type,
					timestamp: msg.chunk.timestamp,
					duration: msg.chunk.duration,
					data: msg.chunk.data,
				});
				decoder.decode(chunk);
			} catch (err) {
				post({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
					name: err instanceof Error ? err.name : "Error",
				});
			}
			return;
		}
		case "flush": {
			try {
				if (!decoder) {
					post({ kind: "flush-done", id: msg.id });
					return;
				}
				await decoder.flush();
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
				if (decoder && decoder.state !== "closed") {
					decoder.reset();
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
				if (decoder && decoder.state !== "closed") {
					decoder.close();
				}
			} catch {
				/* ignore */
			}
			decoder = null;
			return;
		}
		case "isConfigSupported": {
			try {
				const support = await VideoDecoder.isConfigSupported(msg.config);
				post({
					kind: "isConfigSupported-result",
					id: msg.id,
					supported: !!support.supported,
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
	}
};
