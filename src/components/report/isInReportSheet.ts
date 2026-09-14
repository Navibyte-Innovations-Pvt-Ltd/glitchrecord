/** The shared dialog's layers, and InlineReport's own loading / sign-in panel. */
const REPORT_SHEET_SELECTOR = "[data-glitchgrab-layer], .gg-inline-report-backdrop";

/**
 * Was this key pressed inside the Report Bug sheet?
 *
 * The sheet mounts over the editor, and the editor listens for keys on the whole
 * window — Space plays the video, Delete/Backspace removes the selected clip. Its
 * guards only skip text fields, so with a sheet *button* focused those keys went
 * to the editor instead: Space started playback, Backspace deleted a clip.
 *
 * Duck-typed on `closest` rather than `instanceof Element`, so it also runs in
 * the Node unit lane, where there is no DOM.
 */
export function isInReportSheet(target: EventTarget | null): boolean {
	const el = target as { closest?: (selector: string) => unknown } | null;
	return typeof el?.closest === "function" && el.closest(REPORT_SHEET_SELECTOR) != null;
}
