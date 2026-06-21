import { describe, expect, it } from "vitest";
import {
	getTimelineContentMinHeightPx,
	getTimelineRowsMinHeightPx,
	getTimelineViewportStretchFactor,
	TIMELINE_AXIS_HEIGHT_PX,
	TIMELINE_ROW_MIN_HEIGHT_PX,
} from "./timelineLayout";

describe("timelineLayout", () => {
	it("reserves vertical space for every rendered timeline row", () => {
		expect(getTimelineRowsMinHeightPx(5)).toBe(5 * TIMELINE_ROW_MIN_HEIGHT_PX);
		expect(getTimelineContentMinHeightPx(5)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 5 * TIMELINE_ROW_MIN_HEIGHT_PX,
		);
	});

	it("ignores invalid row counts", () => {
		expect(getTimelineRowsMinHeightPx(-1)).toBe(0);
		expect(getTimelineRowsMinHeightPx(Number.NaN)).toBe(0);
		expect(getTimelineContentMinHeightPx(Number.POSITIVE_INFINITY)).toBe(
			TIMELINE_AXIS_HEIGHT_PX,
		);
	});

	it("floors fractional row counts", () => {
		expect(getTimelineRowsMinHeightPx(2.9)).toBe(2 * TIMELINE_ROW_MIN_HEIGHT_PX);
		expect(getTimelineContentMinHeightPx(2.9)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 2 * TIMELINE_ROW_MIN_HEIGHT_PX,
		);
	});

	it("fills the viewport without over-stretching (panel is resizable)", () => {
		// Content fills the available height; per-row min-height drives scroll.
		// Dragging the panel taller reveals more rows instead of scaling the same two.
		expect(getTimelineViewportStretchFactor(2)).toBe(1);
		expect(getTimelineViewportStretchFactor(4)).toBe(1);
		expect(getTimelineViewportStretchFactor(5)).toBe(1);
		expect(getTimelineViewportStretchFactor(0)).toBe(1);
	});
});
