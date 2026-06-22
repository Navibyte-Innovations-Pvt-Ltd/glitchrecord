// Regression evidence for the timeline-scroll FREEZE.
//
// Root cause (seen in the live console, hundreds of times): the timeline wheel
// handler was wired via React's `onWheel` prop. React registers wheel listeners as
// PASSIVE, so the handler's `event.preventDefault()` is a no-op AND the browser logs
// "Unable to preventDefault inside passive event listener invocation." on EVERY wheel
// tick. A trackpad scroll fires dozens of wheel events; each logs an error. The flood
// (plus the failed pan) saturates the main thread → the editor freezes.
//
// Fix: attach the wheel handler as a NATIVE NON-PASSIVE listener
// (addEventListener("wheel", handler, { passive: false })) so preventDefault works and
// no warning is emitted. These guards lock that in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("timeline wheel handler is non-passive (no preventDefault-in-passive flood)", () => {
	const hookSrc = readFileSync(path.join(__dirname, "useTimelineRange.ts"), "utf8");
	const editorSrc = readFileSync(
		path.join(__dirname, "..", "TimelineEditor.tsx"),
		"utf8",
	);

	it("registers a native wheel listener with { passive: false }", () => {
		expect(hookSrc).toMatch(/addEventListener\(\s*["']wheel["']/);
		expect(hookSrc).toMatch(/passive:\s*false/);
	});

	it("does NOT wire the wheel handler through React's passive onWheel prop", () => {
		// The buggy form was `onWheel={handleTimelineWheel}` — assert it's gone, because
		// React makes wheel listeners passive and preventDefault would throw the warning.
		expect(editorSrc).not.toMatch(/onWheel=\{handleTimelineWheel\}/);
	});
});
