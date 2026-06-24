import { describe, expect, it } from "vitest";
import {
	classifyCompositeMs,
	compositeBands,
	recordingToCompositeMs,
	shiftSpan,
} from "./introOutroComposite";

const LEAD = 7000;
const REC = 180000;
const TAIL = 8000;

describe("compositeBands", () => {
	it("lays out intro | recording | outro contiguously", () => {
		expect(compositeBands(LEAD, REC, TAIL)).toEqual({
			recStartMs: 7000,
			recEndMs: 187000,
			totalMs: 195000,
		});
	});

	it("treats missing sides as zero-width", () => {
		expect(compositeBands(0, REC, 0)).toEqual({
			recStartMs: 0,
			recEndMs: REC,
			totalMs: REC,
		});
	});
});

describe("classifyCompositeMs", () => {
	it("classifies the intro band with progress", () => {
		expect(classifyCompositeMs(0, LEAD, REC, TAIL)).toEqual({ band: "intro", progress: 0 });
		expect(classifyCompositeMs(3500, LEAD, REC, TAIL)).toEqual({
			band: "intro",
			progress: 0.5,
		});
	});

	it("maps the recording band back to recording time", () => {
		expect(classifyCompositeMs(LEAD, LEAD, REC, TAIL)).toEqual({
			band: "recording",
			recordingMs: 0,
		});
		expect(classifyCompositeMs(LEAD + 1000, LEAD, REC, TAIL)).toEqual({
			band: "recording",
			recordingMs: 1000,
		});
		// Recording end stays in the recording band (outro starts strictly after).
		expect(classifyCompositeMs(LEAD + REC, LEAD, REC, TAIL)).toEqual({
			band: "recording",
			recordingMs: REC,
		});
	});

	it("classifies the outro band with progress", () => {
		expect(classifyCompositeMs(LEAD + REC + 4000, LEAD, REC, TAIL)).toEqual({
			band: "outro",
			progress: 0.5,
		});
	});

	it("has no intro/outro band when those sides are absent", () => {
		expect(classifyCompositeMs(0, 0, REC, 0)).toEqual({ band: "recording", recordingMs: 0 });
		expect(classifyCompositeMs(REC + 5000, 0, REC, 0)).toEqual({
			band: "recording",
			recordingMs: REC,
		});
	});
});

describe("recordingToCompositeMs", () => {
	it("shifts recording time forward by the intro length", () => {
		expect(recordingToCompositeMs(0, LEAD)).toBe(7000);
		expect(recordingToCompositeMs(1000, LEAD)).toBe(8000);
		expect(recordingToCompositeMs(1000, 0)).toBe(1000);
	});
});

describe("shiftSpan", () => {
	it("shifts a span both ways", () => {
		expect(shiftSpan({ start: 1000, end: 2000 }, LEAD)).toEqual({ start: 8000, end: 9000 });
		expect(shiftSpan({ start: 8000, end: 9000 }, -LEAD)).toEqual({ start: 1000, end: 2000 });
	});
});
