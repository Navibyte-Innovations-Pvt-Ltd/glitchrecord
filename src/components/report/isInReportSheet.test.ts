import { describe, expect, it } from "vitest";
import { isInReportSheet } from "./isInReportSheet";

// Editor shortcuts skip keys pressed inside the Report Bug sheet. Pinned: both
// sheet layers count (the shared dialog and InlineReport's own panel), anything
// else on the page does not, and a non-element target never throws.

/** A stand-in for an element whose ancestors match only `matching`. */
const target = (matching: string | null) => ({
	closest: (selector: string) =>
		matching && selector.split(",").map((s) => s.trim()).includes(matching) ? {} : null,
});

describe("isInReportSheet", () => {
	it("BUG guard: a button inside the shared report dialog counts", () => {
		expect(isInReportSheet(target("[data-glitchgrab-layer]") as unknown as EventTarget)).toBe(true);
	});

	it("counts the loading / sign-in panel shown before the dialog", () => {
		expect(isInReportSheet(target(".gg-inline-report-backdrop") as unknown as EventTarget)).toBe(true);
	});

	it("leaves keys on the editor itself alone", () => {
		expect(isInReportSheet(target(null) as unknown as EventTarget)).toBe(false);
	});

	it("never throws on a target that is not an element", () => {
		expect(isInReportSheet(null)).toBe(false);
		expect(isInReportSheet({} as EventTarget)).toBe(false);
	});
});
