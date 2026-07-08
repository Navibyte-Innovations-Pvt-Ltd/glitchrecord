// Lane-1 unit tests for the event-panel stats: per-profile time split + the
// silent-stretch gap finder that feeds screenshots to the AI. Run: bun test / vitest.
import { describe, expect, it } from "vitest";
import { computeProfileTimes, computeSilentGaps, hostOf, type StatEvent } from "./eventStats";

describe("hostOf", () => {
	it("extracts host, tolerates junk", () => {
		expect(hostOf("http://testing.localhost:3333/view_seat")).toBe("testing.localhost:3333");
		expect(hostOf("http://localhost:3333/dashboard")).toBe("localhost:3333");
		expect(hostOf(undefined)).toBe("");
		expect(hostOf("not a url")).toBe("");
	});
});

describe("computeProfileTimes", () => {
	it("returns nothing when no event carries a client", () => {
		expect(computeProfileTimes([{ t: 0 }, { t: 1000 }])).toEqual([]);
	});

	it("splits active time per profile and orders by first appearance", () => {
		// P1 (admin) at 0 and 1s; switch to P2 (student) at 3s..7s; back to P1 at 9s (last).
		const events: StatEvent[] = [
			{ t: 0, client: "admin", url: "http://localhost:3333/dashboard" },
			{ t: 1000, client: "admin", url: "http://localhost:3333/dashboard" },
			{ t: 3000, client: "student", url: "http://testing.localhost:3333/" },
			{ t: 7000, client: "student", url: "http://testing.localhost:3333/view_seat" },
			{ t: 9000, client: "admin", url: "http://localhost:3333/dashboard" },
		];
		const [p1, p2] = computeProfileTimes(events);
		expect(p1.client).toBe("admin"); // first-seen → P1
		expect(p1.label).toBe("localhost:3333");
		expect(p2.client).toBe("student");
		expect(p2.label).toBe("testing.localhost:3333");
		// admin gaps: 0→1 (1s) + 1→3 (2s) + 9→end (0) = 3s. student: 3→7 (4s) + 7→9 (2s) = 6s.
		expect(p1.activeMs).toBe(3000);
		expect(p2.activeMs).toBe(6000);
		// Active times sum to the full span (0..9s) — no time silently lost.
		expect(p1.activeMs + p2.activeMs).toBe(9000);
	});

	it("is order-independent (sorts by t first)", () => {
		const shuffled: StatEvent[] = [
			{ t: 7000, client: "b" },
			{ t: 0, client: "a" },
			{ t: 3000, client: "b" },
		];
		const [first] = computeProfileTimes(shuffled);
		expect(first.client).toBe("a"); // earliest t wins P1 regardless of array order
	});
});

describe("computeSilentGaps", () => {
	it("flags a lead-in before the first event", () => {
		const gaps = computeSilentGaps([{ t: 55000, client: "admin" }, { t: 56000, client: "admin" }]);
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("lead-in");
		expect(gaps[0].tMs).toBe(27500); // midpoint of the 0→55s lead-in
	});

	it("ignores a trivial lead-in and tiny gaps", () => {
		const gaps = computeSilentGaps([{ t: 500 }, { t: 2000 }, { t: 4000 }]);
		expect(gaps).toEqual([]); // lead-in < 6s, gaps < 10s
	});

	it("flags a long idle pause at its midpoint", () => {
		// 0s event, then a 20s silent pause, then 20s event.
		const gaps = computeSilentGaps([{ t: 0 }, { t: 20000 }]);
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("idle");
		expect(gaps[0].tMs).toBe(10000);
	});

	it("caps frames and keeps them in timeline order (lead-in first)", () => {
		const events: StatEvent[] = [{ t: 40000 }];
		let t = 40000;
		for (let i = 0; i < 12; i++) {
			t += 15000; // 15s gaps → each > SILENT_GAP_MIN_MS
			events.push({ t });
		}
		const gaps = computeSilentGaps(events);
		expect(gaps.length).toBeLessThanOrEqual(8); // MAX_SILENT_FRAMES
		expect(gaps[0].kind).toBe("lead-in"); // lead-in always kept + first
		// remaining are in ascending timeline order
		const times = gaps.map((g) => g.tMs);
		expect([...times].sort((a, b) => a - b)).toEqual(times);
	});

	// The outro/wrap-up bug: a 10-minute video where the last captured event is
	// at ~6m — without a trailing gap, script-gen has zero signal for the final
	// ~4 minutes and silently stops narrating there.
	it("flags a trailing gap after the last event when the video runs on well past it", () => {
		const gaps = computeSilentGaps(
			[{ t: 0 }, { t: 369000 }], // last event at 6m09s
			623000, // video is 10m23s
		);
		const trailing = gaps.find((g) => g.kind === "trailing");
		expect(trailing).toBeDefined();
		expect(trailing?.tMs).toBe(369000 + Math.round((623000 - 369000) / 2));
	});

	it("does not flag a trailing gap when videoDurationMs is omitted (backward compatible)", () => {
		const gaps = computeSilentGaps([{ t: 0 }, { t: 369000 }]);
		expect(gaps.some((g) => g.kind === "trailing")).toBe(false);
	});

	it("ignores a trivial tail (video ends right after the last event)", () => {
		const gaps = computeSilentGaps([{ t: 0 }, { t: 100000 }], 102000); // 2s tail
		expect(gaps.some((g) => g.kind === "trailing")).toBe(false);
	});

	it("keeps BOTH lead-in and trailing as priority endpoints over idle pauses when capping", () => {
		const events: StatEvent[] = [{ t: 60000 }]; // 60s lead-in
		let t = 60000;
		for (let i = 0; i < 12; i++) {
			t += 15000; // 15s idle gaps, well beyond MAX_SILENT_FRAMES capacity
			events.push({ t });
		}
		const videoDurationMs = t + 60000; // 60s trailing tail
		const gaps = computeSilentGaps(events, videoDurationMs);
		expect(gaps.length).toBeLessThanOrEqual(8);
		expect(gaps[0].kind).toBe("lead-in");
		expect(gaps[gaps.length - 1].kind).toBe("trailing");
	});
});
