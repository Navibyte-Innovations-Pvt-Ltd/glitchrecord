// Regression for the post-wheel-fix console FLOOD / load stall.
//
// A recording with no `.mic/.system` sidecar audio re-ran getLocalMediaUrl (IPC) →
// file:// → 404 for every candidate, on every render / StrictMode double-invoke / per-
// item caller. Fix: a module-level negative cache — once a resource fails, it is never
// resolved or fetched again. This drives the REAL loader (injectable deps) and proves
// the second attempt skips resolution entirely.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/exporter/localMediaSource", () => ({
	resolveMediaResourceUrl: vi.fn(),
}));
vi.mock("../../audio/waveform/WaveformGenerator", () => ({
	waveformGenerator: { generate: vi.fn() },
}));
vi.mock("../../projectPersistence", () => ({ fromFileUrl: (u: string) => u }));

const { loadWaveformResource } = await import("./useTimelineAudioPeaks");

describe("loadWaveformResource negative cache", () => {
	it("does NOT re-resolve or re-fetch a resource that already failed", async () => {
		// Unique path → isolated from the shared module-level cache.
		const missing = "/tmp/missing-A.system.wav";
		const resolve = vi.fn().mockRejectedValue(new Error("denied"));
		const generate = vi.fn();

		await expect(loadWaveformResource(missing, 100, { resolve, generate })).rejects.toThrow();
		expect(resolve).toHaveBeenCalledTimes(1);

		// Second attempt for the SAME missing resource: short-circuits, no IPC/fetch.
		await expect(loadWaveformResource(missing, 100, { resolve, generate })).rejects.toThrow();
		expect(resolve).toHaveBeenCalledTimes(1); // still 1 — negative cache hit
		expect(generate).not.toHaveBeenCalled();
	});

	it("dedupes CONCURRENT loads of the same resource — resolves only ONCE (the real flood)", async () => {
		// The actual console flood: StrictMode double-invoke + mic/system hooks fire the
		// SAME resource at once, before any has failed. Without in-flight dedup each one
		// runs getLocalMediaUrl + fetch → 404. They must share a single resolve.
		const racing = "/tmp/racing-D.system.wav";
		let resolveCount = 0;
		const resolve = vi.fn().mockImplementation(async () => {
			resolveCount++;
			// Simulate the async IPC so both callers overlap before the first rejects.
			await new Promise((r) => setTimeout(r, 5));
			throw new Error("denied");
		});
		const generate = vi.fn();

		// Fire BOTH at the same tick (no await between) — the concurrent case.
		const a = loadWaveformResource(racing, 100, { resolve, generate });
		const b = loadWaveformResource(racing, 100, { resolve, generate });
		await expect(a).rejects.toThrow();
		await expect(b).rejects.toThrow();

		expect(resolveCount).toBe(1); // ONE resolve for both concurrent callers
		expect(generate).not.toHaveBeenCalled();
	});

	it("resolves and generates a fresh (untried) resource normally", async () => {
		const ok = "/tmp/fresh-B.system.wav";
		const peaks = { peaks: [0.1, 0.2], maxPeak: 0.2 };
		const resolve = vi.fn().mockResolvedValue("file:///tmp/fresh-B.system.wav");
		const generate = vi.fn().mockResolvedValue(peaks);

		await expect(loadWaveformResource(ok, 64, { resolve, generate })).resolves.toBe(peaks);
		expect(resolve).toHaveBeenCalledWith(ok);
		expect(generate).toHaveBeenCalledWith("file:///tmp/fresh-B.system.wav", 64);
	});

	it("caches the failure on the FIRST resource and still tries the next candidate", async () => {
		// Mirrors the real fallback loop: candidate 1 missing → cached; candidate 2 ok.
		const bad = "/tmp/bad-C.mic.wav";
		const good = "/tmp/good-C.system.wav";
		const peaks = { peaks: [0.5], maxPeak: 0.5 };
		const resolve = vi
			.fn()
			.mockImplementation((r: string) =>
				r === good ? Promise.resolve(`file://${good}`) : Promise.reject(new Error("404")),
			);
		const generate = vi.fn().mockResolvedValue(peaks);

		await expect(loadWaveformResource(bad, 32, { resolve, generate })).rejects.toThrow();
		await expect(loadWaveformResource(good, 32, { resolve, generate })).resolves.toBe(peaks);

		// Re-trying the bad one does NOT resolve again; the good one is unaffected.
		const resolveCallsBefore = resolve.mock.calls.length;
		await expect(loadWaveformResource(bad, 32, { resolve, generate })).rejects.toThrow();
		expect(resolve.mock.calls.length).toBe(resolveCallsBefore); // bad short-circuited
	});
});
