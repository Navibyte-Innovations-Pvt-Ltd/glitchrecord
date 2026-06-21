export const TIMELINE_AXIS_HEIGHT_PX = 32;
export const TIMELINE_ROW_MIN_HEIGHT_PX = 22;

function normalizeRowCount(rowCount: number) {
	if (!Number.isFinite(rowCount)) {
		return 0;
	}

	return Math.max(0, Math.floor(rowCount));
}

export function getTimelineRowsMinHeightPx(rowCount: number) {
	return normalizeRowCount(rowCount) * TIMELINE_ROW_MIN_HEIGHT_PX;
}

export function getTimelineContentMinHeightPx(rowCount: number) {
	return TIMELINE_AXIS_HEIGHT_PX + getTimelineRowsMinHeightPx(rowCount);
}

// The timeline panel is user-resizable, so content should fill the available
// viewport rather than over-stretch to keep a fixed number of rows visible.
// Per-row min-height (getTimelineContentMinHeightPx) is what forces scrolling,
// and only when the panel is too short to fit every row at its minimum height.
// Dragging the panel taller therefore reveals more rows (e.g. the audio track)
// instead of just scaling the same two.
export function getTimelineViewportStretchFactor(rowCount: number) {
	void normalizeRowCount(rowCount);
	return 1;
}
