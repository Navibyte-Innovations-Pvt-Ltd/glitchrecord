// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
/**
 * File types the report dialog offers in its picker. Mirrors the server-side
 * allowlist in `apps/web/lib/attachments-constants.ts` — the server is the
 * authority, this list only shapes the native file dialog.
 *
 * Text-like files (html, json, log…) are previewed in the GitHub issue body and
 * stored whole on the CDN as plain text; binaries (pdf, docx…) are committed to
 * the repo attachments branch.
 */
const TEXT_ATTACHMENT_EXTENSIONS = [
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".log",
  ".yml",
  ".yaml",
  ".csv",
  ".har",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".scss",
  ".py",
  ".sh",
] as const;

const BINARY_ATTACHMENT_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip"] as const;

export const ATTACHMENT_ACCEPT = [
  "image/*",
  ...TEXT_ATTACHMENT_EXTENSIONS,
  ...BINARY_ATTACHMENT_EXTENSIONS,
].join(",");

/**
 * The AI sheet's picker (#1851): images, and the text files the assistant can
 * read. Binaries stay on the dialog's own picker — offering a PDF in a chat
 * that cannot read it would promise something the assistant does not do.
 */
export const ASSIST_ATTACHMENT_ACCEPT = ["image/*", ...TEXT_ATTACHMENT_EXTENSIONS].join(",");

/** True for a file the assistant reads as text. Judged by name, like the server. */
export function isAssistReadableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * The dialog holds attachments as `readAsDataURL` output. Back to text, UTF-8,
 * so an HTML mockup with "—" or Marathi in it reaches the model intact. Null on
 * anything that is not a data URL — never throws.
 */
export function decodeTextDataUrl(dataUrl: string): string | null {
  try {
    if (!dataUrl.startsWith("data:")) return null;
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const meta = dataUrl.slice(5, comma);
    const payload = dataUrl.slice(comma + 1);
    if (!meta.endsWith(";base64")) return decodeURIComponent(payload);
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}
