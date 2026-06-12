> **RESOLVED (both walls down).** Headless mp4 export now works end-to-end.
> 1. WebCodecs encode/decode moved into Workers (the original bug below).
> 2. The render backend is threaded from export options (was hardcoded to a
>    WebGPU-defaulting `undefined`). WebGPU can't configure a canvas without a
>    real display; **WebGL renders fine headlessly**. Force it with
>    `RECORDLY_SMOKE_EXPORT_RENDER_BACKEND=webgl` (or `preferredRenderBackend:
>    "webgl"` in export options). Verified: `bun run test:e2e:export` BASELINE
>    produces a real h264 mp4 with no display. The GUI default is unchanged.
>
> Historical context below.

# BUG: mp4 export uses main-thread `VideoEncoder` → fails in headless/automation

## Symptom
`smoke-export` (and any automated export) fails with `VideoEncoder is not defined`.
Intermittent for raw input, consistent for a loaded project. The GUI app exports
fine (packaged/real-display build).

## Root cause (verified)
In this Electron build (39.2.7, Chromium ~138), **WebCodecs `VideoEncoder` is
exposed only inside Workers, not the main renderer frame.** Probed directly:

```
main frame : typeof VideoEncoder === "undefined"   (VideoDecoder too)
worker     : typeof VideoEncoder === "function"     (reliable)
isSecureContext: true, navigator.gpu: object
```

Not fixable by flags — tested `--enable-features=WebCodecs,WebCodecsVideoEncoder`,
`--enable-blink-features=WebCodecs`, `--ignore-gpu-blocklist`, `--use-angle=metal`,
`--enable-unsafe-webgpu`: main frame stays `undefined` every time.

**Every export path encodes on the main thread:**
- `src/lib/exporter/modernVideoExporter.ts:2695`, `:3391`
- `src/lib/exporter/videoExporter.ts:736`, `:1250`

The "native" export (`nativeVideoExportStart`, `inputMode: "h264-stream"`,
modernVideoExporter.ts:2667) still **encodes with `new VideoEncoder()` on the main
thread** (line 2695) and only *muxes* the h264 natively — so it doesn't dodge the
problem. There is no existing path that avoids main-thread WebCodecs.

## The fix — move WebCodecs encode into a Worker
Surgical option (preferred): a `WorkerVideoEncoder` that mimics the `VideoEncoder`
API but runs the real encoder in a worker.

API surface to reproduce (from grep): `configure`, `encode(frame, {keyFrame})`,
`flush`, `close`, `reset`, `state`, `encodeQueueSize`, the `{output, error}`
callbacks, and static `isConfigSupported`.

Hard parts (why it's a real PR, not a patch):
1. **`.state` / `.encodeQueueSize` are SYNC** (read 37× total) but the worker is
   async — the proxy must MIRROR them locally (track config/close + inc/dec the
   queue on post/ack) and stay consistent on errors/flush.
2. **VideoFrame transfer** — `encode(frame)` must transfer the `VideoFrame` to the
   worker (it's Transferable); main can't touch it after. Mind frame lifecycle/close.
3. **4 encoder instances** + ordered `EncodedVideoChunk` output back to the muxer.
4. **`isConfigSupported`** (static, 8 sites) must round-trip to the worker.

Plan:
1. Add `src/lib/exporter/workerVideoEncoder.ts` + `videoEncoder.worker.ts`.
2. Replace the 4 `new VideoEncoder(...)` sites + the static `isConfigSupported`
   calls with the proxy.
3. Regression-test: GUI export still produces a correct mp4 (audio/video sync,
   duration, keyframes), AND headless `test:e2e:export` now renders edited mp4s.

Alternative: a true raw-frame native encode (renderer sends RGBA frames → main
process VideoToolbox/FFmpeg encodes). Avoids WebCodecs entirely but needs a
native-side input mode for raw frames — a bigger native change.

## Until fixed
- Editing + edits-persistence are fully verified by e2e (`test:e2e:ui`,
  `test:e2e:export`). Only the final mp4 *render* is blocked headlessly.
- Export reliably from the **GUI app**, or run automation on a real-GPU runner.
