// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
/**
 * File types the report dialog offers in its picker. Mirrors the server-side
 * allowlist in `apps/web/lib/attachments-constants.ts` — the server is the
 * authority, this list only shapes the native file dialog.
 *
 * Text-like files (html, json, log…) are embedded in the GitHub issue body as
 * fenced code; binaries (pdf, docx…) are committed to the repo attachments branch.
 */
export const ATTACHMENT_ACCEPT = [
  "image/*",
  // text — inlined into the issue body
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
  // binary documents
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
].join(",");
