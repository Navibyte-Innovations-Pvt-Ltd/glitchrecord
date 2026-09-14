// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
import type { AssistTurnResult } from "./types";

/**
 * Turning the `/api/v1/ai/report-chat` response into what the sheet renders —
 * one copy for every host.
 *
 * The SDK, the Chrome extension and GlitchRecord each mapped it by hand, and
 * GlitchRecord's copy kept only question/report: its sheet never got the
 * "Yes, that's it" chip, "our team is already on #N", or an answer from the
 * project's guides. A field added here reaches all three.
 *
 * React-free on purpose: GlitchRecord's Electron main process imports it.
 */

/** Shown when the assistant cannot be reached — the plain form takes over. */
export const ASSIST_OFFLINE_MESSAGE =
  "The assistant is unavailable — write your report below and send it as normal.";

export function assistOffline(): AssistTurnResult {
  return { conversationId: null, question: null, report: null, degraded: ASSIST_OFFLINE_MESSAGE };
}

type IssueRef = { number: number; title: string; url: string; status?: string };

interface ReportChatEnvelope {
  success?: boolean;
  error?: string;
  retryable?: boolean;
  data?: {
    conversationId?: string | null;
    question?: string | null;
    options?: unknown;
    report?: string | null;
    duplicate?: IssueRef | null;
    related?: IssueRef | null;
    solved?: string | null;
    aboutGlitchgrab?: boolean;
  };
}

/**
 * @param ok   `response.ok`
 * @param body the parsed JSON body, or `null` when it was not JSON
 */
export function toAssistTurnResult(ok: boolean, body: unknown): AssistTurnResult {
  const envelope = (body ?? null) as ReportChatEnvelope | null;
  if (!ok || !envelope?.success) {
    return {
      ...assistOffline(),
      // The server words why (cap, rate limit, switched off). An hourly limit
      // keeps the assistant button for this report.
      degraded: envelope?.error ?? ASSIST_OFFLINE_MESSAGE,
      retryable: envelope?.retryable === true,
    };
  }
  const d = envelope.data ?? {};
  return {
    conversationId: d.conversationId ?? null,
    question: d.question ?? null,
    options: Array.isArray(d.options)
      ? d.options.filter((o): o is string => typeof o === "string")
      : [],
    report: d.report ?? null,
    duplicate: d.duplicate ?? null,
    related: d.related ?? null,
    solved: d.solved ?? null,
    aboutGlitchgrab: d.aboutGlitchgrab === true,
    degraded: null,
  };
}
