import { describe, expect, it } from "vitest";
import { trimRangesToEnd } from "./trimToEnd";

interface Block {
	id: string;
	startMs: number;
	endMs: number;
}

describe("trimRangesToEnd (cut everything right of the playhead)", () => {
	const blocks: Block[] = [
		{ id: "before", startMs: 0, endMs: 10_000 },
		{ id: "spanning", startMs: 8_000, endMs: 20_000 },
		{ id: "after", startMs: 21_000, endMs: 30_000 },
	];

	it("removes blocks fully after the cut", () => {
		const out = trimRangesToEnd(blocks, 15_000);
		expect(out.find((b) => b.id === "after")).toBeUndefined();
	});

	it("clips a block that spans the cut so it ends at the cut", () => {
		const out = trimRangesToEnd(blocks, 15_000);
		expect(out.find((b) => b.id === "spanning")).toMatchObject({ startMs: 8_000, endMs: 15_000 });
	});

	it("leaves blocks fully before the cut untouched (same object)", () => {
		const out = trimRangesToEnd(blocks, 15_000);
		expect(out.find((b) => b.id === "before")).toBe(blocks[0]);
	});

	it("a cut at the very end keeps everything", () => {
		expect(trimRangesToEnd(blocks, 30_000)).toHaveLength(3);
	});

	it("a cut at 0 removes everything", () => {
		expect(trimRangesToEnd(blocks, 0)).toHaveLength(0);
	});

	it("a block whose start == cut is removed (nothing left of it survives)", () => {
		const out = trimRangesToEnd([{ id: "x", startMs: 15_000, endMs: 20_000 }], 15_000);
		expect(out).toHaveLength(0);
	});

	it("a block whose end == cut is kept whole (boundary inclusive on the left side)", () => {
		const out = trimRangesToEnd([{ id: "x", startMs: 10_000, endMs: 15_000 }], 15_000);
		expect(out).toEqual([{ id: "x", startMs: 10_000, endMs: 15_000 }]);
	});
});
