export const TIMELINE_AXIS_HEIGHT_PX = 32;
export const TIMELINE_ROW_MIN_HEIGHT_PX = 22;
// Cap each row so they stay compact thin lanes even when the panel is dragged
// tall — extra panel height becomes scroll/empty space instead of fat rows.
export const TIMELINE_ROW_MAX_HEIGHT_PX = 40;

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
