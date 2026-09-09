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

/**
 * What the user can pick on step 1. A superset of `ReportType`: `RATING` is a
 * tile, not a report type — it never reaches the report API or GitHub, it saves
 * a star rating through `FeedbackFn` instead. Kept out of `ReportType` so the
 * report endpoint's validated enum stays exactly what it was.
 */
export type DialogTile = ReportType | "RATING";

export type ReportSeverity = "low" | "medium" | "high" | "critical";

/**
 * The picker's order, left to right. Kept next to the union so a new level
 * can't be added to the type and forgotten in the two pickers that render it
 * (the dialog's own row and the assist sheet's).
 *
 * Mirrored server-side by `SEVERITY_VALUES` in `apps/web/lib/severity.ts`,
 * which rejects anything outside it — add a level in both, or the button files
 * a 400.
 */
export const SEVERITY_LEVELS: readonly ReportSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

/**
 * Display text. The buttons used to render the raw union value through
 * `text-transform: capitalize`, which meant the label and the GitHub label
 * (`severity:<value>`) could never diverge — fine until a level needs wording
 * the label can't carry.
 */
export const SEVERITY_LABELS: Record<ReportSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export interface ReportResult {
  success: boolean;
  reportId?: string;
  issueUrl?: string;
  issueNumber?: number;
  title?: string;
  intent?: string;
  message?: string;
}

/**
 * Who the dialog says is filing the report. Hosts resolve this differently —
 * the SDK from its `session` prop, the extension and GlitchRecord from the
 * server-side `ExtensionSession` identity — so the dialog takes it as data and
 * never guesses.
 *
 * `null`/omitted renders the anonymous state rather than nothing: a reporter
 * who believes they're signed in and isn't would otherwise file a report with
 * no way to be followed up, and never know.
 */
export interface ReportReporter {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  /** Optional role suffix, e.g. "tester" — shown next to the name */
  role?: string | null;
}

/** The function a host (SDK or extension) supplies to actually submit a report. */
export type ReportFn = (
  type: ReportType,
  description: string,
  metadata?: Record<string, string>
) => Promise<ReportResult | null>;

/**
 * Saves a 1–5 star rating. Supplying this is what makes the `RATING` tile
 * appear — a host with no feedback wiring (GlitchRecord desktop today) simply
 * doesn't show it rather than showing a tile that fails on submit.
 */
export type FeedbackFn = (
  rating: number,
  message?: string
) => Promise<{ success: boolean } | null>;

/** Optional: polish description text. Never throws — returns original text on failure. */
export type EnhanceTextFn = (text: string, screenshot?: string | null) => Promise<string>;

/**
 * One turn of the AI report assistant (#330).
 *
 * `question` and `report` are mutually exclusive: the assistant is either still
 * asking, or it has written the description. `degraded` is set when the
 * assistant cannot help right now — over the project's monthly cap, rate
 * limited, model down, or simply switched off. That is not an error state: the
 * panel closes, the message is shown once, and the plain form the dialog has
 * always had takes over. Filing a report must never depend on a model.
 */
export interface AssistTurnResult {
  conversationId: string | null;
  question: string | null;
  /**
   * Tappable answers to `question`. Sent when the reporter has said something
   * too vague to act on — "it could be better" — and the assistant read
   * candidates off the screenshot instead of asking them to phrase it again.
   * Empty when it asked an open question.
   */
  options?: string[];
  report: string | null;
  /**
   * An issue that is already open for this exact problem. Server-validated
   * against the repo's real open issues, so the number is safe to send back:
   * the report is added to that issue as a comment instead of opening another.
   */
  duplicate?: { number: number; title: string; url: string } | null;
  /**
   * The project's own brief answered it and the reporter confirmed. Nothing is
   * filed — the sheet shows this line and the dialog closes. Someone whose
   * problem already had an answer leaves with the answer, not a ticket number.
   */
  solved?: string | null;
  degraded?: string | null;
}

/**
 * How many images ride along with one assistant turn.
 *
 * Capped rather than unbounded: every image is vision tokens against the
 * repo's monthly conversation cap, and a reporter who drags in eight shots
 * would spend the project's month on one bug. The newest win — the picture
 * someone just pasted is the one they are talking about.
 */
export const MAX_ASSIST_IMAGES = 3;

export interface AssistTurnParams {
  messages: { role: "user" | "assistant"; content: string }[];
  conversationId: string | null;
  /**
   * Images the model reads — the auto-captured page shot plus anything the
   * reporter pasted or attached, newest last, at most `MAX_ASSIST_IMAGES`.
   */
  screenshots?: string[];
  /**
   * @deprecated Superseded by `screenshots`, and still sent alongside it: a
   * host running an older server would otherwise show the model nothing.
   */
  screenshot?: string | null;
  /** Page URL, visited pages, breadcrumbs, report type. Host-supplied. */
  context?: Record<string, unknown> | null;
}

/**
 * Runs one assistant turn. Supplied by the host (SDK / extension /
 * GlitchRecord), because only the host knows how to authenticate. Must never
 * throw — a failure comes back as `degraded`.
 */
export type AssistFn = (params: AssistTurnParams) => Promise<AssistTurnResult>;
