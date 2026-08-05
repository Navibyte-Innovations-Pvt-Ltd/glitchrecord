// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
/**
 * The global keyboard shortcut that opens the Glitchgrab report dialog.
 * Single source of truth — the provider's keydown handler and every label
 * rendered anywhere (SDK dialog, host app UI) derive from this.
 */

/** Server-safe label. Used during SSR and as the non-Mac label. */
export const GLITCHGRAB_SHORTCUT = "Ctrl+Shift+G";

/** Mac label, using the platform's modifier glyphs. */
export const GLITCHGRAB_SHORTCUT_MAC = "⌘⇧G";

/** True when running on a Mac-like platform. Always false on the server. */
function isMac(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  } catch {
    return false;
  }
}

/**
 * OS-aware label for the report-dialog shortcut — `⌘⇧G` on Mac,
 * `Ctrl+Shift+G` elsewhere. Returns the non-Mac label on the server, so
 * render it client-side (or after mount) to avoid a hydration mismatch.
 */
export function getShortcutLabel(): string {
  return isMac() ? GLITCHGRAB_SHORTCUT_MAC : GLITCHGRAB_SHORTCUT;
}

/** True when the keyboard event matches the report-dialog shortcut. */
export function matchesShortcut(e: KeyboardEvent): boolean {
  return (
    (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "g"
  );
}
