// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
// Minimal type surface ReportDialog needs — kept separate from the SDK's
// full types.ts (which also covers auto-capture/breadcrumbs, irrelevant here).

export type ReportType =
  | "BUG"
  | "FEATURE_REQUEST"
  | "UI_IMPROVEMENT"
  | "PERFORMANCE"
  | "SECURITY"
  | "QUESTION"
  | "OTHER";

export type ReportSeverity = "low" | "medium" | "high";

export interface ReportResult {
  success: boolean;
  reportId?: string;
  issueUrl?: string;
  issueNumber?: number;
  title?: string;
  intent?: string;
  message?: string;
}

/** The function a host (SDK or extension) supplies to actually submit a report. */
export type ReportFn = (
  type: ReportType,
  description: string,
  metadata?: Record<string, string>
) => Promise<ReportResult | null>;

/** Optional: polish description text. Never throws — returns original text on failure. */
export type EnhanceTextFn = (text: string, screenshot?: string | null) => Promise<string>;
