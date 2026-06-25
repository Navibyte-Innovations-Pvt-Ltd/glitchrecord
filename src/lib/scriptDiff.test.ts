import { describe, expect, it } from "vitest";
import { changedRange } from "./scriptDiff";

describe("changedRange", () => {
	it("isolates a single changed middle word", () => {
		const prev = "the quick brown fox";
		const next = "the quick red fox";
		const [start, end] = changedRange(prev, next);
		expect(next.slice(start, end)).toBe("red");
	});

	it("spans an inserted paragraph, not the untouched ones around it", () => {
		const prev = "[Intro]\nhi\n\n[Pricing]\nbye";
		const next = "[Intro]\nhi\n\n[Seats]\nA-33 to A-37\n\n[Pricing]\nbye";
		const [start, end] = changedRange(prev, next);
		// The shared "[" before the diverging section stays in the common prefix.
		expect(next.slice(start, end)).toContain("Seats]");
		expect(next.slice(start, end)).toContain("A-33 to A-37");
		expect(next.slice(0, start)).toBe("[Intro]\nhi\n\n[");
		expect(next.slice(end)).toContain("Pricing]\nbye");
	});

	it("returns the whole of next on a full rewrite (no common edges)", () => {
		expect(changedRange("aaa", "bbbb")).toEqual([0, 4]);
	});

	it("returns an empty span at the divergence point when next is a pure prefix", () => {
		// next === prev → nothing changed; start === end.
		const [start, end] = changedRange("hello world", "hello world");
		expect(start).toBe(end);
	});

	it("handles appended text (common prefix, empty suffix)", () => {
		const [start, end] = changedRange("line one\n", "line one\nline two\n");
		expect("line one\nline two\n".slice(start, end)).toBe("line two\n");
	});
});
