// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  AssistFile,
  AssistFn,
  AssistSheetEvent,
  AssistTurnResult,
  AttachKind,
  DialogTile,
  ReportSeverity,
} from "./types";
import {
  MAX_ASSIST_FILE_CHARS,
  MAX_ASSIST_FILE_CHARS_EACH,
  MAX_ASSIST_FILES,
  MAX_ASSIST_IMAGE_CHARS,
  MAX_ASSIST_IMAGES,
  SEVERITY_LEVELS,
  SEVERITY_LABELS,
} from "./types";
import {
  ASSIST_ATTACHMENT_ACCEPT,
  decodeTextDataUrl,
  isAssistReadableFile,
} from "./attachments";
import { getTypeLabel } from "./labels";

/**
 * The AI report assistant, as a sheet (#330).
 *
 * A right-hand drawer on a wide screen, a bottom sheet under 640px — the shape
 * every chat surface a reporter has ever used already has. It replaced an
 * in-dialog panel that technically worked and read like a form field: a
 * conversation crammed into 150px of a 420px card never felt like talking to
 * anyone.
 *
 * The sheet owns the whole flow — chat, then the draft, then Send. There is no
 * hand-back to the dialog, because a context switch at the exact moment someone
 * is finished is the worst possible time to move them.
 *
 * It does NOT own submission. `description`, `severity` and `onSend` are the
 * dialog's own state and handler passed straight through, so there is exactly
 * one submit path in this package and the sheet cannot drift from it.
 *
 * Every failure path ends the same way: `onDegrade` fires, the sheet closes,
 * and the plain form is there. Filing a bug never depends on a model.
 */

export interface AssistTheme {
  bg: string;
  bgSecondary: string;
  border: string;
  text: string;
  textMuted: string;
  inputBg: string;
  inputBorder: string;
  accent: string;
  accentText: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * A draft the model wrote. Its `content` is the draft TEXT, not a "here's
   * your report" line — the model has to see what it wrote, or "keep chatting"
   * makes the reporter describe the whole thing again (#357).
   */
  kind?: "report";
}

/**
 * The images one turn can carry: newest first, at most `MAX_ASSIST_IMAGES`,
 * and never more than `MAX_ASSIST_IMAGE_CHARS` between them. An image that
 * would overflow is skipped rather than ending the pick, so a heavy paste costs
 * itself, not the small page shot behind it. Returned oldest-first, the order
 * the model reads them in.
 */
function pickAssistImages(all: string[]): string[] {
  const picked: string[] = [];
  let total = 0;
  for (let i = all.length - 1; i >= 0 && picked.length < MAX_ASSIST_IMAGES; i--) {
    const shot = all[i];
    if (total + shot.length > MAX_ASSIST_IMAGE_CHARS) continue;
    picked.unshift(shot);
    total += shot.length;
  }
  return picked;
}

/** A non-image file attached to the report, as the dialog holds it. */
interface SheetFile {
  name: string;
  size: number;
  dataUrl: string;
}

/** Stable empty default, so the memo below does not re-decode every render. */
const NO_FILES: SheetFile[] = [];

/**
 * The text files one turn can carry (#1851): readable types only, newest
 * first, at most `MAX_ASSIST_FILES` and `MAX_ASSIST_FILE_CHARS` between them,
 * each cut at `MAX_ASSIST_FILE_CHARS_EACH`. Returned oldest-first with each
 * file's index in `files`, so the strip marks exactly the ones sent.
 */
function pickAssistFiles(files: SheetFile[]): { index: number; file: AssistFile }[] {
  const picked: { index: number; file: AssistFile }[] = [];
  let total = 0;
  for (let i = files.length - 1; i >= 0 && picked.length < MAX_ASSIST_FILES; i--) {
    const attached = files[i];
    if (!isAssistReadableFile(attached.name)) continue;
    const text = decodeTextDataUrl(attached.dataUrl);
    if (!text || !text.trim()) continue;
    const content = text.slice(0, MAX_ASSIST_FILE_CHARS_EACH);
    if (total + content.length > MAX_ASSIST_FILE_CHARS) continue;
    picked.unshift({ index: i, file: { name: attached.name, content } });
    total += content.length;
  }
  return picked;
}

interface AssistSheetProps {
  assist: AssistFn;
  theme: AssistTheme;
  /**
   * Every image attached to the report, oldest first — the auto-captured page
   * shot, then anything pasted or picked in here. The newest that fit
   * `MAX_ASSIST_IMAGES` and `MAX_ASSIST_IMAGE_CHARS` go to the model
   * (`pickAssistImages`); the strip above the composer shows all of them, because a
   * paste that lands somewhere invisible reads as a paste that failed (#352).
   */
  screenshots: string[];
  /**
   * The shot the dialog captured itself when it opened, if it did. Every other
   * entry of `screenshots` was added by the reporter — and is usually the thing
   * they are complaining about, which may not be this page at all (#357).
   */
  pageShot?: string | null;
  /**
   * Add images or files from inside the sheet. The host owns both lists and
   * sorts them: images to `screenshots`, anything else to `files`.
   */
  onAddFiles?: (files: File[]) => void;
  /**
   * Every non-image file attached to the report, oldest first (#1851). The
   * text ones the assistant can read are sent with each turn; the rest (pdf,
   * docx) are shown so the reporter knows they are attached, and dimmed.
   */
  files?: SheetFile[];
  /** Take one file back off the report, by its index in `files`. */
  onRemoveFile?: (index: number) => void;
  /**
   * Take one image back off the report, by its index in `screenshots` (#360).
   * Without it a wrong paste could only be undone by leaving the sheet — and
   * the reporter had no idea the dialog behind it had a remove button.
   */
  onRemoveImage?: (index: number) => void;
  /** How many screenshots + files are attached, for the draft's summary line. */
  attachmentCount: number;
  /** Page URL / breadcrumbs / report type — whatever the host knows. */
  context: Record<string, unknown> | null;
  /** "Bug Report", "Feature Request", … — shown in the header. */
  reportTypeLabel: string;

  /**
   * The picker turn (#330 follow-up). ⌘⇧G now lands here instead of on the
   * dialog's tile grid, so the very first thing the sheet does is ask what
   * this is — as chips, not as a model turn. Deterministic, instant, and it
   * costs nothing from the project's monthly conversation cap.
   *
   * `typePicked` is true when the host already knows (a tile was clicked in
   * the dialog, or the host opened with a type), and the picker is skipped.
   */
  typePicked: boolean;
  /** What the dialog currently holds — decides whether a picked type is a
   *  rating (stars, no model) or a report (chat). */
  currentTile: DialogTile;
  tiles: DialogTile[];
  onPickType: (tile: DialogTile) => void;

  /**
   * The rating step. A star needs no assistant, so this branch never calls the
   * model: stars + an optional line, straight down the host's FeedbackFn.
   * The submit path itself stays the dialog's — `onSend` is its `handleSubmit`,
   * which already routes a RATING through `FeedbackFn` instead of the report
   * API. The sheet never grows a second way to submit.
   */
  rating: number;
  onRatingChange: (value: number) => void;
  /** The host's "Reporting to <project>" line, reused verbatim. */
  projectSlot?: ReactNode;
  reporterName?: string | null;

  /** The dialog's description state. The draft box edits it in place. */
  description: string;
  onDescriptionChange: (value: string) => void;
  /** `null` until picked — the sheet never pre-selects one either (#353). */
  severity: ReportSeverity | null;
  onSeverityChange: (value: ReportSeverity) => void;
  showSeverity: boolean;
  /**
   * The dialog owns submission, so a refused send (no severity, low-quality
   * text) sets an error the reporter cannot see behind this sheet. Rendered
   * above Send.
   */
  validationError?: string | null;
  /**
   * True only when the refusal was ABOUT severity. Computed by the dialog,
   * which owns the error: painting the row red for a low-quality-text refusal
   * would point at the wrong field and teach people to ignore red.
   */
  severityRefused?: boolean;

  /**
   * Tells the dialog which issue to attach to, so its ONE submit path carries
   * the number into report metadata. Null clears it — the reporter kept typing
   * and it stopped looking like a duplicate. `kind` says whether it is the same
   * problem or a related request for that issue.
   */
  onDuplicateChange?: (issueNumber: number | null, kind?: AttachKind) => void;

  /**
   * Tells the dialog which chat this is, so its ONE submit path carries the id
   * into report metadata. That link is the only way to answer "how many prompts
   * does a filed issue cost" — a conversation with no report against it is one
   * that went nowhere, and that is a finding too.
   */
  onConversationChange?: (conversationId: string | null) => void;

  isSubmitting: boolean;
  submitted: boolean;
  onSend: () => void;

  /** `retryable`: the reason clears on its own, so the assistant is not retired. */
  onDegrade: (message: string, retryable?: boolean) => void;
  onClose: () => void;
  /**
   * Close the whole dialog, not just the sheet. Used when the brief answered
   * the question: dropping them back onto an empty report form after telling
   * them they are done would read as "now file it anyway".
   */
  onFinish?: () => void;
  /**
   * Opens the dialog's "Problem with Glitchgrab?" panel (#366). The sheet is
   * where the assistant goes wrong, so the way to say so lives here too — as a
   * link, and as a card when the assistant itself decides the chat is about
   * Glitchgrab. `prefill` is the reporter's own words, so they never retype.
   * Omitted when the host did not offer it.
   */
  onReportGlitchgrabProblem?: (prefill?: string) => void;
}

/**
 * Openers, not instructions. Someone who does not know what to type is the
 * whole reason this surface exists; a blank box helps them least.
 */
const STARTERS = [
  "Something on this page is broken",
  "It did the wrong thing",
  "I wish it could…",
];

/**
 * The check-back chip the prompt offers before the first report
 * (`apps/web/lib/ai-assist/prompt.ts`, pinned in `prompt.test.ts`). Tapping it
 * already confirmed the restatement, so the report it produces files itself
 * after a short countdown instead of asking for a second Send (#402). A plain
 * typed yes arms it too (`isAffirmativeReply`): reporters answer "Is that right?"
 * by typing "yes", and were then made to press Send on top of saying yes.
 */
const CONFIRM_OPTION = "Yes, that's it";

/**
 * The assistant saying back what it understood ("So you're saying… Is that
 * right?"). The prompt pairs it with the "Yes, that's it" chip, but the model
 * does not always send the chip — and a yes to the question is the same answer
 * either way.
 */
export function isCheckBackQuestion(text: string): boolean {
  const t = text.trim();
  return (
    /^so,? you['’]?re saying\b/i.test(t) ||
    /\b(is that right|is that correct|did i get (that|it) right|have i got (that|it) right)\s*\??\s*$/i.test(t)
  );
}

/**
 * A reply that is only a yes — "yes", "yeah", "correct", "haan", "👍". Anything
 * with more in it is a correction and must go back to the model, so the whole
 * message has to be the yes.
 */
export function isAffirmativeReply(text: string): boolean {
  return /^(y|ya|yah|yes|yess|yeah|yep|yup|ok|okay|sure|correct|right|exactly|confirm(ed)?|that['’]?s (it|right|correct)|yes,? that['’]?s (it|right)|haan|han|ha|ho|hmm yes|👍)[\s.!👍]*$/i.test(
    text.trim(),
  );
}

/**
 * Seconds a confirmed draft stays on screen before it files itself (#402). The
 * reporter never read the draft before confirming — it is written after the
 * tap — so this is the window in which a wrong or injected draft gets stopped.
 */
const AUTO_FILE_SECONDS = 4;

const NARROW_QUERY = "(max-width: 640px)";

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia(NARROW_QUERY);
      setNarrow(mq.matches);
      const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      // Never crash a host page over a layout preference.
    }
  }, []);
  return narrow;
}

function Sparkle({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Small round avatar so a transcript reads as two people, not one log. */
function Avatar({
  who,
  theme: t,
  initials,
}: {
  who: "user" | "assistant";
  theme: AssistTheme;
  /** The reporter's own initials. A stray "Y" for "You" reads as a typo. */
  initials?: string;
}) {
  const isAi = who === "assistant";
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: "24px",
        height: "24px",
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: "2px",
        backgroundColor: isAi ? `${t.accent}22` : t.bgSecondary,
        border: `1px solid ${isAi ? t.accent : t.inputBorder}`,
        color: isAi ? t.accent : t.textMuted,
        fontSize: "10px",
        fontWeight: 700,
      }}
    >
      {isAi ? (
        <Sparkle color={t.accent} size={12} />
      ) : initials ? (
        initials
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

export function AssistSheet({
  assist,
  theme: t,
  screenshots,
  pageShot = null,
  onAddFiles,
  files = NO_FILES,
  onRemoveFile,
  onRemoveImage,
  attachmentCount,
  context,
  reportTypeLabel,
  typePicked,
  currentTile,
  tiles,
  onPickType,
  rating,
  onRatingChange,
  projectSlot,
  reporterName,
  description,
  onDescriptionChange,
  severity,
  onSeverityChange,
  showSeverity,
  validationError,
  severityRefused = false,
  onDuplicateChange,
  onConversationChange,
  isSubmitting,
  submitted,
  onSend,
  onDegrade,
  onClose,
  onFinish,
  onReportGlitchgrabProblem,
}: AssistSheetProps) {
  const narrow = useIsNarrow();
  /** A send the dialog refused because nothing is picked yet — turns the row red. */
  /**
   * The picker mirrors the dialog's gate exactly — `showSeverity` AND a bug.
   * A feature request has no severity to give, and showing "required" on a
   * field the dialog will not ask for makes Send unexplainable.
   */
  const severityAsked = showSeverity && currentTile === "BUG";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  /** Star hover preview — local, because it is pure presentation. */
  const [hoveredStar, setHoveredStar] = useState(0);
  /**
   * Tappable answers offered with the last question. Cleared the moment
   * anything is sent — a stale chip row invites answering a question that has
   * already moved on.
   */
  const [options, setOptions] = useState<string[]>([]);
  /**
   * The already-open issue this turned out to be. Server-validated, so the
   * number is safe to hand back on submit: the report is added to that issue
   * as a comment rather than opening a second one.
   */
  const [duplicate, setDuplicate] = useState<
    (NonNullable<AssistTurnResult["duplicate"]> & { kind: AttachKind }) | null
  >(null);
  /** The assistant said "this is about Glitchgrab, not this app" (#366) — show the offer card. */
  const [glitchgrabOffer, setGlitchgrabOffer] = useState(false);
  /**
   * The brief answered it. Nothing is filed and the dialog closes — the whole
   * point of giving the assistant the project's guides is that some people
   * should never have to write a report at all.
   */
  const [solved, setSolved] = useState<string | null>(null);
  /**
   * A bug is asked how bad it is right after its type, before the chat (#402).
   * Asked once: a severity already picked on the form is not asked again.
   */
  const needsSeverity = (tile: DialogTile) => showSeverity && tile === "BUG" && !severity;
  /**
   * "type" → the picker chips, "severity" → how bad a bug is, "rating" →
   * stars, "chat" → the conversation, "draft" → the model's report, ready to
   * send. A sheet opened from the dialog's own "Describe it with AI" button
   * already knows its type and starts at "chat" (or "severity" for a bug);
   * ⌘⇧G starts at "type".
   */
  const [phase, setPhase] = useState<
    "type" | "severity" | "rating" | "chat" | "draft" | "solved"
  >(() =>
    !typePicked
      ? "type"
      : currentTile === "RATING"
        ? "rating"
        : needsSeverity(currentTile)
          ? "severity"
          : "chat",
  );
  /**
   * Seconds until a confirmed draft files itself (#402), null when nothing is
   * counting. Driven by the effect below, so closing the sheet, a degrade or
   * the dialog starting its own submit all stop it without a stray timer.
   */
  const [autoFileLeft, setAutoFileLeft] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  /** Guards the seed below against React 18's double-invoked effects. */
  const seededRef = useRef(false);
  /** The opening turn is waiting for the severity answer (#402). */
  const seedPendingRef = useRef(false);
  /**
   * Clicks the server has not seen yet (#357). They ride along with the next
   * turn, or go on their own when the sheet is left — the moment someone gives
   * up on the assistant is exactly the click worth keeping.
   */
  const eventsRef = useRef<AssistSheetEvent[]>([]);
  /** The model's own last draft, to tell "sent as drafted" from "edited". */
  const aiDraftRef = useRef<string | null>(null);

  function logEvent(type: AssistSheetEvent["type"], detail?: string) {
    eventsRef.current.push({ type, at: Date.now(), ...(detail ? { detail } : {}) });
  }

  function takeEvents(): AssistSheetEvent[] | undefined {
    if (eventsRef.current.length === 0) return undefined;
    const events = eventsRef.current;
    eventsRef.current = [];
    return events;
  }

  /**
   * Send pending clicks without a model turn. Fire-and-forget: the server
   * answers an empty `messages` with no model call and nothing counted, and
   * nobody waits on it. Needs a conversation to attach to — clicks before the
   * first reply have nowhere to go and ride with that reply instead.
   */
  function flushEvents() {
    if (!conversationId) return;
    const events = takeEvents();
    if (!events) return;
    try {
      void Promise.resolve(
        assist({ messages: [], conversationId, events, screenshots: [], context: null }),
      ).catch(() => {});
    } catch {
      // A host's fn threw synchronously. Losing a click log is fine.
    }
  }

  // What the next turn will actually send — the strip marks exactly these, so
  // an image dropped for size reads as unread, not just one dropped for count.
  const readShots = new Set(pickAssistImages(screenshots));
  // Decoding a mockup is not free, and this body re-runs on every keystroke.
  const sentFiles = useMemo(() => pickAssistFiles(files), [files]);
  const readFiles = new Set(sentFiles.map((f) => f.index));

  /** Every way out of the sheet that is not Send. */
  function leave(type: "write_myself" | "closed", detail?: string) {
    logEvent(type, detail);
    flushEvents();
    onClose();
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, phase]);

  useEffect(() => {
    if (phase === "draft") draftRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (autoFileLeft === null) return;
    // The dialog took over (Send pressed by hand) or the draft went away.
    if (isSubmitting || submitted || phase !== "draft") {
      setAutoFileLeft(null);
      return;
    }
    if (autoFileLeft <= 0) {
      sendDraft(true);
      return;
    }
    const id = setTimeout(() => setAutoFileLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
    // `sendDraft` is re-created every render; the tick that reaches 0 renders
    // first, so it is always the current one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFileLeft, isSubmitting, submitted, phase]);

  /** The reporter touched the draft, so it is theirs to send now (#402). */
  function stopAutoFile(reason: string) {
    if (autoFileLeft === null) return;
    setAutoFileLeft(null);
    logEvent("auto_file_stopped", reason);
  }

  /**
   * A turn that failed carried clicks with it. Put them back and flush them on
   * their own — the clicks right before an outage are exactly the ones worth
   * reading, and a cap/rate-limit degrade still accepts an events-only flush.
   */
  function degradeKeepingEvents(
    events: AssistSheetEvent[] | undefined,
    message: string,
    retryable?: boolean,
  ) {
    if (events) eventsRef.current = [...events, ...eventsRef.current];
    flushEvents();
    onDegrade(message, retryable);
  }

  /**
   * `autoFile`: this turn answers the check-back chip, so a plain report it
   * returns starts the countdown instead of waiting for Send (#402).
   */
  async function runTurn(history: ChatMessage[], autoFile = false) {
    setBusy(true);
    setAutoFileLeft(null);
    let result: AssistTurnResult;
    const events = takeEvents();
    try {
      // Held to a total budget, and no singular `screenshot` beside it: a body
      // over the request limit is refused at the edge with a 413 before the
      // route runs, and repeating the newest image is what tipped real turns
      // over it.
      const sent = pickAssistImages(screenshots);
      result = await assist({
        // `kind` only on drafts, so an older server sees the exact shape it
        // always did — it just learns the draft text now instead of a
        // placeholder line.
        messages: history.map((m) =>
          m.kind ? { role: m.role, content: m.content, kind: m.kind } : m,
        ),
        conversationId,
        screenshots: sent,
        // Only when there is something: an older server then sees the body
        // it always did.
        ...(sentFiles.length > 0 ? { files: sentFiles.map((f) => f.file) } : {}),
        context: {
          ...(context ?? {}),
          imageSources: sent.map((shot) => (pageShot && shot === pageShot ? "page" : "attached")),
          // Whether this dialog can open the #366 panel at all. A hint — the
          // server decides whether the model may offer it.
          canReportGlitchgrab: !!onReportGlitchgrabProblem,
        },
        events,
      });
    } catch {
      // AssistFn is documented as never-throwing, but a host is a host.
      degradeKeepingEvents(
        events,
        "The assistant is unavailable — write your report below and send it as normal.",
      );
      return;
    } finally {
      setBusy(false);
    }

    if (result.degraded) {
      degradeKeepingEvents(events, result.degraded, result.retryable === true);
      return;
    }
    if (result.conversationId) {
      setConversationId(result.conversationId);
      onConversationChange?.(result.conversationId);
    }

    // One card, one submit path for both: the SAME problem, or a related request
    // the model asked about. The server never sends both.
    const attach = result.duplicate
      ? { ...result.duplicate, kind: "duplicate" as const }
      : result.related
        ? { ...result.related, kind: "related" as const }
        : null;
    setDuplicate(attach);
    onDuplicateChange?.(attach?.number ?? null, attach?.kind);
    setGlitchgrabOffer(!!result.aboutGlitchgrab && !!onReportGlitchgrabProblem && !!result.question);

    if (result.solved) {
      setSolved(result.solved);
      setOptions([]);
      setPhase("solved");
      return;
    }

    if (result.report) {
      onDescriptionChange(result.report);
      aiDraftRef.current = result.report;
      logEvent("draft_shown");
      setMessages([...history, { role: "assistant", content: result.report, kind: "report" }]);
      setOptions([]);
      setPhase("draft");
      // Never onto somebody else's issue: attaching to the wrong thread stays a
      // deliberate click. And never without a severity the dialog would refuse.
      if (autoFile && !attach && !(severityAsked && !severity)) {
        setAutoFileLeft(AUTO_FILE_SECONDS);
      }
      return;
    }
    if (result.question) {
      setMessages([...history, { role: "assistant", content: result.question }]);
      setOptions(result.options ?? []);
      return;
    }
    onDegrade("The assistant had nothing to add — write your report below and send it as normal.");
  }

  // Whatever was already typed IS the first message. Making someone retype it
  // to "start the chat" would be the most annoying thing this feature could do.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    // Nothing to seed until we know what this is — the picker runs first, and
    // anything typed before it would be a report about an unknown thing.
    // A rating never calls the model, so whatever is in the box is a comment,
    // not the opening line of a conversation.
    if (!typePicked || currentTile === "RATING") return;
    // A bug answers "how bad is it?" first (#402); the opening turn waits.
    if (phase === "severity") {
      seedPendingRef.current = true;
      return;
    }
    seedFromDescription();
    // Intentionally once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function seedFromDescription() {
    const seed = description.trim();
    if (!seed) return;
    const history: ChatMessage[] = [{ role: "user", content: seed }];
    setMessages(history);
    void runTurn(history);
  }

  function answerSeverity(value: ReportSeverity) {
    onSeverityChange(value);
    setPhase("chat");
    if (seedPendingRef.current) {
      seedPendingRef.current = false;
      seedFromDescription();
    }
  }

  /** Typed into the composer: a plain yes to "Is that right?" counts as the tap. */
  function sendTyped(text: string) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const checkingBack =
      options.includes(CONFIRM_OPTION) ||
      (lastAssistant?.kind !== "report" && isCheckBackQuestion(lastAssistant?.content ?? ""));
    send(text, checkingBack && isAffirmativeReply(text));
  }

  function send(text: string, autoFile = false) {
    const value = text.trim();
    if (!value || busy) return;
    setOptions([]);
    // Replying at all answers the offer — the card goes, the chat carries on.
    setGlitchgrabOffer(false);
    // Typed under a draft, it is a correction to that draft (#360 — the chat box
    // stays there, so asking for a change is just replying). Logged as
    // `keep_chatting`, the first number read when tuning the prompt.
    const underDraft = phase === "draft";
    if (underDraft) {
      const edited =
        aiDraftRef.current !== null && description.trim() !== aiDraftRef.current.trim();
      logEvent("keep_chatting", edited ? "after editing" : undefined);
      setPhase("chat");
    }
    const base = underDraft ? withCurrentDraft(messages) : messages;
    const history: ChatMessage[] = [...base, { role: "user", content: value }];
    setMessages(history);
    setInput("");
    void runTurn(history, autoFile);
  }

  /**
   * One tap answers "what do you want to do?". RATING branches away from the
   * model entirely; every other tile drops into the conversation the sheet
   * already had.
   */
  function pickType(tile: DialogTile) {
    onPickType(tile);
    setPhase(tile === "RATING" ? "rating" : needsSeverity(tile) ? "severity" : "chat");
  }

  /**
   * The draft stays in the conversation — as the reporter last left it, hand
   * edits included — so the next message is read as a correction to it, not as
   * the start of a new report (#357).
   */
  function withCurrentDraft(history: ChatMessage[]): ChatMessage[] {
    const current = description.trim();
    const next = [...history];
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].kind === "report") {
        if (current) next[i] = { ...next[i], content: current };
        break;
      }
    }
    return next;
  }

  /** `auto`: the countdown ran out, so nobody pressed Send — kept apart in the log. */
  function sendDraft(auto = false) {
    setAutoFileLeft(null);
    const edited = aiDraftRef.current !== null && description.trim() !== aiDraftRef.current.trim();
    logEvent("draft_sent", auto ? "auto-filed" : edited ? "edited" : "as drafted");
    flushEvents();
    onSend();
  }

  const empty = phase === "chat" && messages.length === 0 && !busy;

  /**
   * The already-open issue, and where its fix stands. Shown beside the "is it
   * the same problem?" question and again above the draft — "we know, we're on
   * it" is the answer the reporter came for, so it is said before Send, not
   * after. `status` is the server's, off GitHub's milestone; never the model's.
   *
   * `title: false` beside the question, which already names the issue — the
   * card then adds only what the model cannot say: where the fix stands.
   */
  function renderKnownIssue({ title, footer }: { title: boolean; footer?: string }) {
    if (!duplicate) return null;
    return (
      <div
        data-gg-known-issue=""
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          padding: "9px 10px",
          borderRadius: "8px",
          border: "1px solid rgba(245,158,11,0.4)",
          backgroundColor: "rgba(245,158,11,0.08)",
          fontSize: "12px",
          lineHeight: 1.5,
          minWidth: 0,
        }}
      >
        {/* Theme text, not amber: amber on the tint is ~2:1 in light mode. */}
        <span style={{ color: t.text, fontWeight: 600 }}>
          {duplicate.kind === "related"
            ? title
              ? "Your request goes onto this issue"
              : `Connected to #${duplicate.number}`
            : title
              ? "Our team is already on this"
              : `Our team is already on #${duplicate.number}`}
        </span>
        {title && (
          <span style={{ color: t.textMuted, wordBreak: "break-word" }}>
            #{duplicate.number} {duplicate.title}
          </span>
        )}
        {/* Where THAT issue's fix stands says nothing about a new request added
            to it — "Fix expected by 18 Sep" would read as a promise for theirs. */}
        {duplicate.status && duplicate.kind !== "related" && (
          <span style={{ color: t.text, fontWeight: 600 }}>{duplicate.status}</span>
        )}
        {footer && (
          <span style={{ color: t.textMuted }}>
            {duplicate.kind === "related"
              ? "Added as a separate request on it, not a repeat — the team sees both."
              : footer}
          </span>
        )}
      </div>
    );
  }

  /** "Naresh Bhosale" → "NB". Blank when we were given no name at all. */
  const initials = (reporterName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const panelStyle: React.CSSProperties = narrow
    ? {
        width: "100%",
        maxHeight: "88dvh",
        borderTopLeftRadius: "16px",
        borderTopRightRadius: "16px",
        animation: "gg-sheet-up .22s cubic-bezier(.2,.8,.2,1)",
      }
    : {
        width: "440px",
        maxWidth: "100%",
        height: "100dvh",
        borderLeft: `1px solid ${t.border}`,
        animation: "gg-sheet-in .22s cubic-bezier(.2,.8,.2,1)",
      };

  return createPortal(
    <>
      <style>{`
        @keyframes gg-sheet-in{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}
        @keyframes gg-sheet-up{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes gg-sheet-fade{from{opacity:0}to{opacity:1}}
        @keyframes gg-autofile{from{transform:scaleX(0)}to{transform:scaleX(1)}}
        @keyframes gg-dot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-3px);opacity:1}}
        [data-gg-sheet-send]:focus-visible,[data-gg-chip]:focus-visible,[data-gg-assist-remove]:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      `}</style>
      <div
        data-glitchgrab-layer=""
        role="dialog"
        aria-modal="true"
        aria-label="Describe your report with AI"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483647,
          display: "flex",
          alignItems: narrow ? "flex-end" : "stretch",
          justifyContent: narrow ? "center" : "flex-end",
          backgroundColor: "rgba(0,0,0,0.5)",
          animation: "gg-sheet-fade .18s ease",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
        onClick={() => leave("closed")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            ...panelStyle,
            display: "flex",
            flexDirection: "column",
            // A flex child defaults to min-width:auto, so a long chat bubble
            // grows the sheet past the viewport instead of wrapping inside it.
            // This is what keeps the bottom sheet on screen.
            minWidth: 0,
            maxWidth: "100%",
            boxSizing: "border-box",
            backgroundColor: t.bg,
            color: t.text,
            boxShadow: "0 20px 60px rgba(0,0,0,.35)",
            overflow: "hidden",
            isolation: "isolate",
          }}
        >
          {/* ── Header ─────────────────────────────────────────────── */}
          <div
            data-gg-sheet-header=""
            style={{
              flexShrink: 0,
              padding: "14px 16px",
              borderBottom: `1px solid ${t.border}`,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "12px",
              minWidth: 0,
            }}
          >
            {/* No overflow:hidden here. The extension's project picker drops its
                search list out of this column, and clipping it left the list
                cut off under the search box with nothing to click (#380).
                minWidth:0 alone lets the column shrink; the picker ellipsizes
                its own label. */}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                <Sparkle color={t.accent} />
                Describe it with AI
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: t.accent,
                    border: `1px solid ${t.accent}55`,
                    borderRadius: "4px",
                    padding: "1px 5px",
                  }}
                >
                  Beta
                </span>
              </div>
              <div style={{ fontSize: "11.5px", color: t.textMuted, marginTop: "3px" }}>
                {/* The picker's own bubble asks the question — saying it again
                    here reads as two prompts for one answer. */}
                {phase === "type" ? null : reportTypeLabel}
                {/* The severity step's chips are gone once answered — this is
                    where the answer stays visible. */}
                {phase !== "type" && severityAsked && severity
                  ? ` · ${SEVERITY_LABELS[severity]}`
                  : null}
                {projectSlot ? <span style={{ marginLeft: "6px" }}>{projectSlot}</span> : null}
              </div>
            </div>
            {/* The way out of the assistant, on every width.
                This used to be a bare × on a phone, which reads as "close the
                whole thing" — so someone the assistant was not helping had no
                visible way to reach the form, only a way to give up. It is a
                switch, so it says what it switches to. */}
            <button
              type="button"
              data-gg-write-myself=""
              onClick={() => leave("write_myself", `header, ${phase}`)}
              aria-label="Write it myself instead"
              style={{
                flexShrink: 0,
                border: `1px solid ${t.inputBorder}`,
                borderRadius: "999px",
                background: "transparent",
                color: t.textMuted,
                cursor: "pointer",
                fontSize: "11.5px",
                lineHeight: 1,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                // ~32px tall either way — this is the escape hatch, not a hint.
                padding: "9px 11px",
              }}
            >
              Write it myself
            </button>
          </div>

          {/* ── Transcript ─────────────────────────────────────────── */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              minHeight: narrow ? "180px" : 0,
              overflowY: "auto",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* `marginTop: auto` is what pins a short transcript to the BOTTOM
                of a tall drawer, the way every chat surface behaves. Doing it
                with justify-content instead breaks scrolling once the
                conversation outgrows the panel. */}
            <div
              style={{
                marginTop: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                minWidth: 0,
              }}
            >
            {phase === "type" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Avatar who="assistant" theme={t} />
                  <div
                    style={{
                      padding: "9px 12px",
                      borderRadius: "12px 12px 12px 4px",
                      backgroundColor: t.bgSecondary,
                      fontSize: "13px",
                      lineHeight: 1.55,
                      maxWidth: "88%",
                    }}
                  >
                    {reporterName ? `Hi ${reporterName.split(" ")[0]} — w` : "W"}hat do you want to
                    do? Pick one and I'll take it from there.
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    paddingLeft: "32px",
                  }}
                >
                  {tiles.map((tile) => {
                    const rate = tile === "RATING";
                    return (
                      <button
                        key={tile}
                        type="button"
                        data-gg-chip=""
                        data-gg-tile={tile}
                        onClick={() => pickType(tile)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          // The rating is the only tile that isn't a report, so
                          // it wears the star colour the dialog's hero row uses
                          // rather than hiding among the report types.
                          border: `1px solid ${rate ? "rgba(245,158,11,0.5)" : t.inputBorder}`,
                          background: rate ? "rgba(245,158,11,0.08)" : "transparent",
                          color: rate ? "#f59e0b" : t.textMuted,
                          borderRadius: "999px",
                          // 8px vertical keeps the tap target at ~32px.
                          padding: "8px 12px",
                          fontSize: "12px",
                          fontWeight: rate ? 600 : 400,
                          fontFamily: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        {rate ? "★ Rate us" : getTypeLabel(tile)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* #402: one tap, right after "Bug", so a confirmed draft has
                everything the dialog needs to file it without a second stop. */}
            {phase === "severity" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Avatar who="assistant" theme={t} />
                  <div
                    style={{
                      padding: "9px 12px",
                      borderRadius: "12px 12px 12px 4px",
                      backgroundColor: t.bgSecondary,
                      fontSize: "13px",
                      lineHeight: 1.55,
                      maxWidth: "88%",
                    }}
                  >
                    How bad is it?
                  </div>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Severity"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    paddingLeft: "32px",
                  }}
                >
                  {SEVERITY_LEVELS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={severity === s}
                      data-gg-chip=""
                      data-gg-severity={s}
                      onClick={() => answerSeverity(s)}
                      style={{
                        border: `1px solid ${t.inputBorder}`,
                        background: "transparent",
                        color: t.textMuted,
                        borderRadius: "999px",
                        // Same as the picker and option chips — one chip size.
                        padding: "8px 12px",
                        fontSize: "12px",
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {SEVERITY_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phase === "rating" && !submitted && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Avatar who="assistant" theme={t} />
                  <div
                    style={{
                      padding: "9px 12px",
                      borderRadius: "12px 12px 12px 4px",
                      backgroundColor: t.bgSecondary,
                      fontSize: "13px",
                      lineHeight: 1.55,
                      maxWidth: "88%",
                    }}
                  >
                    How are we doing? Tap a star — the words are optional.
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    marginLeft: "32px",
                    padding: "12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(245,158,11,0.4)",
                    backgroundColor: "rgba(245,158,11,0.06)",
                  }}
                >
                  <div style={{ display: "flex", gap: "4px" }} role="group" aria-label="Rating">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const filled = star <= (hoveredStar || rating);
                      return (
                        <button
                          key={star}
                          type="button"
                          aria-label={`${star} star${star > 1 ? "s" : ""}`}
                          aria-pressed={star <= rating}
                          onClick={() => onRatingChange(star)}
                          onMouseEnter={() => setHoveredStar(star)}
                          onMouseLeave={() => setHoveredStar(0)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            lineHeight: 0,
                          }}
                        >
                          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3z"
                              fill={filled ? "#f59e0b" : "transparent"}
                              stroke={filled ? "#f59e0b" : t.inputBorder}
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                  <textarea
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    rows={3}
                    placeholder="What made it good — or what let you down? (optional)"
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "8px",
                      border: `1px solid ${t.inputBorder}`,
                      backgroundColor: t.inputBg,
                      color: t.text,
                      fontSize: "13px",
                      lineHeight: 1.5,
                      fontFamily: "inherit",
                      resize: "vertical",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setPhase("type")}
                    style={{
                      alignSelf: "flex-start",
                      border: "none",
                      background: "transparent",
                      color: t.textMuted,
                      fontSize: "12px",
                      fontFamily: "inherit",
                      // A bare text link is ~14px tall — half a thumb.
                      padding: "9px 0",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Report something instead
                  </button>
                </div>
              </div>
            )}

            {empty && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Avatar who="assistant" theme={t} />
                  <div
                    style={{
                      padding: "9px 12px",
                      borderRadius: "12px 12px 12px 4px",
                      backgroundColor: t.bgSecondary,
                      fontSize: "13px",
                      lineHeight: 1.55,
                      maxWidth: "88%",
                    }}
                  >
                    {reporterName ? `Hi ${reporterName.split(" ")[0]} — t` : "T"}ell me what went
                    wrong in your own words. I can already see your screenshot and what you clicked,
                    so skip the boring parts.
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    paddingLeft: "32px",
                  }}
                >
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      data-gg-chip=""
                      onClick={() => {
                        logEvent("starter_tap", s);
                        send(s);
                      }}
                      style={{
                        border: `1px solid ${t.inputBorder}`,
                        background: "transparent",
                        color: t.textMuted,
                        borderRadius: "999px",
                        padding: "6px 11px",
                        fontSize: "12px",
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const mine = m.role === "user";
              if (m.kind === "report") {
                // While the draft card is up it shows the text itself, so the
                // bubble only points at it. Once they go back to chatting, the
                // draft stays readable in the transcript: they are correcting
                // it, and a correction to something you cannot see is a guess.
                const live = phase === "draft" && i === messages.length - 1;
                return (
                  <div key={i} style={{ display: "flex", gap: "8px", minWidth: 0 }}>
                    <Avatar who="assistant" theme={t} />
                    <div
                      data-gg-draft-bubble=""
                      style={{
                        maxWidth: "82%",
                        minWidth: 0,
                        padding: "9px 12px",
                        borderRadius: "12px 12px 12px 4px",
                        fontSize: "13px",
                        lineHeight: 1.55,
                        backgroundColor: t.bgSecondary,
                        color: t.text,
                        border: live ? "none" : `1px solid ${t.accent}66`,
                      }}
                    >
                      {live ? (
                        // #402: "have a read" beside a countdown reads as a
                        // contradiction. Say what is about to happen instead.
                        autoFileLeft !== null ? (
                          "Here's your report — I'll file it unless you want to change something."
                        ) : (
                          "Here's your report — have a read."
                        )
                      ) : (
                        <>
                          <span
                            style={{
                              display: "block",
                              fontSize: "10px",
                              fontWeight: 700,
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              color: t.accent,
                              marginBottom: "4px",
                            }}
                          >
                            Draft so far
                          </span>
                          <span
                            style={{
                              display: "block",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: "160px",
                              overflowY: "auto",
                              color: t.textMuted,
                            }}
                          >
                            {m.content}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "8px",
                    minWidth: 0,
                    flexDirection: mine ? "row-reverse" : "row",
                  }}
                >
                  <Avatar who={m.role} theme={t} initials={initials} />
                  <div
                    style={{
                      maxWidth: "82%",
                      padding: "9px 12px",
                      borderRadius: mine ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                      fontSize: "13px",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      backgroundColor: mine ? t.accent : t.bgSecondary,
                      color: mine ? t.accentText : t.text,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}

            {/* Answers to the question above, as chips. The assistant sends these
                when the reporter has said something it cannot act on ("it could
                be better") — re-asking "what specifically?" is what made that
                conversation go in circles. */}
            {/* The model thinks this is an open issue and is asking. The card
                sits with the question so "is it the same problem?" is answered
                looking at the actual issue — and its status. */}
            {duplicate && !busy && phase === "chat" && (
              <div style={{ paddingLeft: "32px", minWidth: 0 }}>
                {renderKnownIssue({ title: false })}
              </div>
            )}

            {/* #366 — the assistant thinks this is about Glitchgrab itself, not
                this app. Offered, never automatic: a wrong guess must not yank
                someone out of a real report. One tap sends it on with their own
                words already in the box; one tap says no and the chat goes on. */}
            {glitchgrabOffer && onReportGlitchgrabProblem && !busy && phase === "chat" && (
              <div style={{ paddingLeft: "32px", minWidth: 0 }}>
                <div
                  data-gg-glitchgrab-offer=""
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    padding: "10px",
                    borderRadius: "8px",
                    border: `1px solid ${t.accent}55`,
                    backgroundColor: `${t.accent}14`,
                    fontSize: "12px",
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: t.text, fontWeight: 600 }}>
                    This is about Glitchgrab, not this app
                  </span>
                  <span style={{ color: t.textMuted }}>
                    It goes to the team that builds this reporter, with your chat attached.
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    <button
                      type="button"
                      data-gg-glitchgrab-offer-send=""
                      onClick={() => {
                        logEvent("glitchgrab_offer_tap");
                        setGlitchgrabOffer(false);
                        onReportGlitchgrabProblem(
                          messages
                            .filter((m) => m.role === "user")
                            .map((m) => m.content.trim())
                            .filter(Boolean)
                            .join("\n\n"),
                        );
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        border: "none",
                        backgroundColor: t.accent,
                        color: t.accentText,
                        fontSize: "12px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        // Both stretch, so on a phone each wrapped line reads as
                        // a choice rather than one button left stranded.
                        flex: "1 1 auto",
                      }}
                    >
                      Send to the Glitchgrab team
                    </button>
                    <button
                      type="button"
                      data-gg-glitchgrab-offer-no=""
                      onClick={() => {
                        logEvent("glitchgrab_offer_declined");
                        send("No — it's about this app, not the reporting tool");
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        border: `1px solid ${t.inputBorder}`,
                        background: "transparent",
                        color: t.textMuted,
                        fontSize: "12px",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        flex: "1 1 auto",
                      }}
                    >
                      No, it&apos;s about this app
                    </button>
                  </div>
                </div>
              </div>
            )}

            {options.length > 0 && !busy && phase === "chat" && !glitchgrabOffer && (
              <div
                style={{
                  display: "flex",
                  // Long labels wrapped into a ragged row that always stranded
                  // the last chip on a line of its own. Past ~24 characters
                  // these stop being chips and become a choice list, so they
                  // stack full width and read like one.
                  flexDirection: options.some((o) => o.length > 24) ? "column" : "row",
                  alignItems: options.some((o) => o.length > 24) ? "stretch" : "flex-start",
                  flexWrap: "wrap",
                  gap: "6px",
                  paddingLeft: "32px",
                }}
              >
                {options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-gg-chip=""
                    data-gg-option=""
                    onClick={() => {
                      logEvent("option_tap", option);
                      send(option, option === CONFIRM_OPTION);
                    }}
                    style={{
                      border: `1px solid ${t.inputBorder}`,
                      background: "transparent",
                      color: t.textMuted,
                      borderRadius: "999px",
                      // Same 8px as the picker chips — one tap target size in
                      // this sheet, not two.
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontFamily: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}

            {busy && (
              <div style={{ display: "flex", gap: "8px" }} role="status" aria-label="Thinking">
                <Avatar who="assistant" theme={t} />
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "12px",
                    borderRadius: "12px 12px 12px 4px",
                    backgroundColor: t.bgSecondary,
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: "5px",
                        height: "5px",
                        borderRadius: "50%",
                        backgroundColor: t.textMuted,
                        animation: `gg-dot 1.1s ease-in-out ${i * 0.15}s infinite`,
                      }}
                    />
                  ))}
                </span>
              </div>
            )}

            {/* ── The draft ────────────────────────────────────────── */}
            {phase === "draft" && !submitted && (
              <div
                style={{
                  border: `1px solid ${t.accent}`,
                  borderRadius: "12px",
                  backgroundColor: t.bgSecondary,
                  padding: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  minWidth: 0,
                  boxSizing: "border-box",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: t.accent,
                  }}
                >
                  {duplicate
                    ? `What we'll add to #${duplicate.number}${duplicate.kind === "related" ? " as a related request" : ""} · edit anything`
                    : "Your report · edit anything"}
                </span>

                {renderKnownIssue({
                  title: true,
                  footer: "Your details will be added to it instead of opening a new issue.",
                })}
                <textarea
                  ref={draftRef}
                  value={description}
                  onChange={(e) => {
                    stopAutoFile("edited the draft");
                    onDescriptionChange(e.target.value);
                  }}
                  rows={6}
                  style={{
                    width: "100%",
                    minHeight: "120px",
                    padding: "10px",
                    borderRadius: "8px",
                    border: `1px solid ${t.inputBorder}`,
                    backgroundColor: t.inputBg,
                    color: t.text,
                    fontSize: "13px",
                    lineHeight: 1.55,
                    fontFamily: "inherit",
                    resize: "vertical",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />

                {/* Answered a step ago; while the countdown runs a second
                    picker is only something to mis-tap. "Edit first" brings it
                    back so the answer can still be changed. */}
                {severityAsked && autoFileLeft === null && (
                  <div>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: t.textMuted,
                        display: "block",
                        marginBottom: "6px",
                      }}
                    >
                      How bad is it?
                      {!severity && (
                        <span
                          style={{
                            marginLeft: "6px",
                            fontSize: "11px",
                            color: severityRefused ? "#ef4444" : t.textMuted,
                          }}
                        >
                          · required
                        </span>
                      )}
                    </span>
                    <div
                      role="radiogroup"
                      aria-label="Severity"
                      style={{ display: "flex", gap: "6px" }}
                    >
                      {SEVERITY_LEVELS.map((s) => {
                        const on = severity === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onSeverityChange(s)}
                            role="radio"
                            aria-checked={on}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: "8px 2px",
                              borderRadius: "8px",
                              border: `1px solid ${
                                on
                                  ? t.accent
                                  : severityRefused
                                    ? "#ef4444"
                                    : t.inputBorder
                              }`,
                              backgroundColor: on ? t.accent : "transparent",
                              color: on ? t.accentText : t.textMuted,
                              fontSize: "12px",
                              fontWeight: 600,
                              fontFamily: "inherit",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              cursor: "pointer",
                            }}
                          >
                            {SEVERITY_LABELS[s]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {attachmentCount > 0 && (
                  <span style={{ fontSize: "11.5px", color: t.textMuted }}>
                    {attachmentCount} {attachmentCount === 1 ? "attachment" : "attachments"} will be
                    sent with this.
                  </span>
                )}
              </div>
            )}

            {phase === "solved" && solved && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Avatar who="assistant" theme={t} />
                  <div
                    style={{
                      padding: "9px 12px",
                      borderRadius: "12px 12px 12px 4px",
                      backgroundColor: t.bgSecondary,
                      fontSize: "13px",
                      lineHeight: 1.55,
                      maxWidth: "88%",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {solved}
                  </div>
                </div>
                <span
                  style={{ fontSize: "11.5px", color: t.textMuted, paddingLeft: "32px" }}
                >
                  Nothing was filed — you are all set.
                </span>
              </div>
            )}

            {submitted && (
              <div
                style={{
                  textAlign: "center",
                  padding: "24px 0",
                  color: t.accent,
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                {reportTypeLabel} sent. Thank you!
              </div>
            )}
            </div>
          </div>

          {/* ── Composer / Send ────────────────────────────────────── */}
          {/* The picker has nothing to compose — a chip IS the answer, and an
              input under it invites someone to type a type name we then have
              to parse. */}
          {!submitted && phase !== "type" && phase !== "severity" && (
            <div
              style={{
                flexShrink: 0,
                borderTop: `1px solid ${t.border}`,
                padding: "12px 16px",
                paddingBottom: narrow ? "max(12px, env(safe-area-inset-bottom))" : "12px",
                backgroundColor: t.bg,
              }}
            >
              {phase === "solved" ? (
                <button
                  type="button"
                  data-gg-sheet-send=""
                  onClick={() => (onFinish ?? onClose)()}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "none",
                    backgroundColor: t.accent,
                    color: t.accentText,
                    fontSize: "14px",
                    fontWeight: 700,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              ) : phase === "rating" ? (
                <button
                  type="button"
                  data-gg-sheet-send=""
                  onClick={onSend}
                  disabled={isSubmitting || rating < 1}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "none",
                    backgroundColor: isSubmitting || rating < 1 ? t.bgSecondary : "#f59e0b",
                    color: isSubmitting || rating < 1 ? t.textMuted : "#1a1a1a",
                    fontSize: "14px",
                    fontWeight: 700,
                    fontFamily: "inherit",
                    cursor: isSubmitting || rating < 1 ? "default" : "pointer",
                  }}
                >
                  {isSubmitting ? "Sending…" : rating < 1 ? "Pick a star first" : "Send Rating"}
                </button>
              ) : (
                // Chat AND draft share this branch, so the chat box is the same
                // element on both sides of a draft landing — it stays put
                // instead of remounting, and a draft is something you can
                // still reply to (#360), not a form that replaced the chat.
                <>
                {/* Proof that a pasted image landed. ⌘V is handled by the
                    dialog underneath, which used to swallow the picture into a
                    strip hidden behind this sheet — indistinguishable from
                    paste being unsupported (#352). */}
                {(screenshots.length > 0 || files.length > 0 || onAddFiles) && (
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginBottom: "8px",
                    }}
                  >
                    {screenshots.map((shot, i) => {
                      // Only some are actually sent (count and size caps), so
                      // the rest are dimmed rather than hidden: "it is attached
                      // but the assistant is not looking at it" is the true
                      // statement.
                      const read = readShots.has(shot);
                      return (
                        <div
                          key={`${i}-${shot.slice(-16)}`}
                          style={{
                            position: "relative",
                            width: "40px",
                            height: "40px",
                            flexShrink: 0,
                          }}
                        >
                          <img
                            src={shot}
                            alt={read ? "Attached image the assistant reads" : "Attached image"}
                            data-gg-assist-thumb=""
                            style={{
                              display: "block",
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              borderRadius: "8px",
                              border: `1px solid ${read ? t.accent : t.inputBorder}`,
                              opacity: read ? 1 : 0.45,
                              boxSizing: "border-box",
                            }}
                          />
                          {/* #360: a wrong paste could not be taken back from
                              in here, so reporters described "the third
                              screenshot" in words instead. Same red × as the
                              dialog's own strip. */}
                          {onRemoveImage && (
                            <button
                              type="button"
                              data-gg-assist-remove=""
                              aria-label={`Remove image ${i + 1}`}
                              title="Remove this image"
                              onClick={() => {
                                stopAutoFile("changed attachments");
                                logEvent(
                                  "image_removed",
                                  pageShot && shot === pageShot ? "page capture" : "attached",
                                );
                                onRemoveImage(i);
                              }}
                              // 32px to tap, 20px to see: the dot stays small on a
                              // 40px thumbnail, the target does not.
                              style={{
                                position: "absolute",
                                top: "-13px",
                                right: "-13px",
                                width: "32px",
                                height: "32px",
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "50%",
                              }}
                            >
                              <span
                                aria-hidden="true"
                                style={{
                                  width: "20px",
                                  height: "20px",
                                  boxSizing: "border-box",
                                  borderRadius: "50%",
                                  border: `2px solid ${t.bg}`,
                                  background: "#ef4444",
                                  color: "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                  <path
                                    d="M1 1L9 9M9 1L1 9"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {/* #1851: a mockup attached on the form was invisible here,
                        and the assistant asked about a page it never saw. A
                        file it reads is outlined like a read image; one it
                        cannot read is dimmed, and says why on hover. */}
                    {files.map((file, i) => {
                      const read = readFiles.has(i);
                      const why = read
                        ? "the assistant reads this file"
                        : isAssistReadableFile(file.name)
                          ? "attached, but more than one message can carry, so the assistant is not reading it"
                          : "attached to the report — the assistant can't read this kind of file";
                      return (
                        <div
                          key={`file-${i}-${file.name}`}
                          data-gg-assist-file=""
                          data-gg-assist-file-read={read ? "" : undefined}
                          title={`${file.name} — ${why}`}
                          style={{
                            position: "relative",
                            height: "40px",
                            maxWidth: "170px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "0 10px",
                            borderRadius: "8px",
                            border: `1px solid ${read ? t.accent : t.inputBorder}`,
                            opacity: read ? 1 : 0.55,
                            boxSizing: "border-box",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                            <path
                              d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6"
                              stroke={t.textMuted}
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span
                            style={{
                              fontSize: "11.5px",
                              color: t.text,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {file.name}
                          </span>
                          {onRemoveFile && (
                            <button
                              type="button"
                              data-gg-assist-remove-file=""
                              aria-label={`Remove file ${file.name}`}
                              title="Remove this file"
                              onClick={() => {
                                stopAutoFile("changed attachments");
                                logEvent("file_removed", read ? "read" : "not read");
                                onRemoveFile(i);
                              }}
                              style={{
                                position: "absolute",
                                top: "-13px",
                                right: "-13px",
                                width: "32px",
                                height: "32px",
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "50%",
                              }}
                            >
                              <span
                                aria-hidden="true"
                                style={{
                                  width: "20px",
                                  height: "20px",
                                  boxSizing: "border-box",
                                  borderRadius: "50%",
                                  border: `2px solid ${t.bg}`,
                                  background: "#ef4444",
                                  color: "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                  <path
                                    d="M1 1L9 9M9 1L1 9"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {onAddFiles && (
                      <label
                        data-gg-assist-attach=""
                        title="Attach an image or a file (html, json, log…) — or paste one"
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "8px",
                          border: `1px dashed ${t.inputBorder}`,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: t.textMuted,
                          fontSize: "18px",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        +
                        <input
                          type="file"
                          accept={ASSIST_ATTACHMENT_ACCEPT}
                          multiple
                          onChange={(e) => {
                            const picked = Array.from(e.target.files ?? []);
                            if (picked.length) {
                              stopAutoFile("changed attachments");
                              const images = picked.filter((f) => f.type.startsWith("image/")).length;
                              if (images) logEvent("image_added", String(images));
                              if (picked.length > images) {
                                logEvent("file_added", String(picked.length - images));
                              }
                              onAddFiles(picked);
                            }
                            // Same file twice in a row fires no change event
                            // unless the input is cleared.
                            e.target.value = "";
                          }}
                          style={{ display: "none" }}
                        />
                      </label>
                    )}
                    {readShots.size < screenshots.length && (
                      <span style={{ color: t.textMuted, fontSize: "11px" }}>
                        {readShots.size} of {screenshots.length} read
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <textarea
                    value={input}
                    onChange={(e) => {
                      // Typing a change under the draft — it must not file mid-sentence.
                      stopAutoFile("typing a change");
                      setInput(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter breaks the line — the rule
                      // every chat surface uses, so nobody has to learn it.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendTyped(input);
                      }
                    }}
                    placeholder={
                      phase === "draft" ? "Anything to change? Tell me here…" : "Type your answer…"
                    }
                    rows={1}
                    disabled={busy}
                    autoFocus
                    style={{
                      flex: 1,
                      minHeight: "42px",
                      maxHeight: "120px",
                      padding: "11px 12px",
                      borderRadius: "10px",
                      border: `1px solid ${t.inputBorder}`,
                      backgroundColor: t.inputBg,
                      color: t.text,
                      fontSize: "13px",
                      lineHeight: 1.4,
                      fontFamily: "inherit",
                      resize: "none",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    data-gg-sheet-send=""
                    onClick={() => sendTyped(input)}
                    disabled={busy || !input.trim()}
                    aria-label="Send message"
                    data-gg-send-message=""
                    style={{
                      flexShrink: 0,
                      width: "42px",
                      height: "42px",
                      borderRadius: "10px",
                      border: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: busy || !input.trim() ? t.bgSecondary : t.accent,
                      color: busy || !input.trim() ? t.textMuted : t.accentText,
                      cursor: busy || !input.trim() ? "default" : "pointer",
                    }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      {/* Paper plane, nose to the RIGHT. Direction is the
                          entire meaning of this icon — get it backwards and it
                          reads as "back", which is the opposite action. */}
                      <path
                        d="M3 20.5L21.5 12 3 3.5V10l12 2-12 2v6.5z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
                {phase === "draft" && (
                  <>
                    {validationError && (
                      <p
                        style={{
                          margin: "8px 0 0",
                          color: "#ef4444",
                          fontSize: "12px",
                        }}
                      >
                        {validationError}
                      </p>
                    )}
                    {autoFileLeft !== null ? (
                      // #402: "Yes, that's it" was the confirmation. The draft
                      // files itself unless they stop it — the bar shows how
                      // long is left, the button sends now.
                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                        <button
                          type="button"
                          data-gg-sheet-send=""
                          data-gg-auto-file=""
                          onClick={() => sendDraft()}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            position: "relative",
                            overflow: "hidden",
                            padding: "12px",
                            borderRadius: "10px",
                            border: "none",
                            backgroundColor: t.accent,
                            color: t.accentText,
                            fontSize: "14px",
                            fontWeight: 700,
                            fontFamily: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              position: "absolute",
                              inset: 0,
                              backgroundColor: "rgba(255,255,255,0.22)",
                              transformOrigin: "left",
                              animation: `gg-autofile ${AUTO_FILE_SECONDS}s linear forwards`,
                            }}
                          />
                          <span style={{ position: "relative" }}>Filing in {autoFileLeft}s…</span>
                        </button>
                        <button
                          type="button"
                          data-gg-edit-first=""
                          onClick={() => {
                            stopAutoFile("edit first");
                            draftRef.current?.focus();
                          }}
                          style={{
                            flexShrink: 0,
                            padding: "12px 14px",
                            borderRadius: "10px",
                            border: `1px solid ${t.inputBorder}`,
                            background: "transparent",
                            color: t.text,
                            fontSize: "13px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          Edit first
                        </button>
                      </div>
                    ) : (
                    <button
                      type="button"
                      data-gg-sheet-send=""
                      onClick={() => sendDraft()}
                      disabled={isSubmitting || !description.trim()}
                      style={{
                        width: "100%",
                        marginTop: "8px",
                        padding: "12px",
                        borderRadius: "10px",
                        border: "none",
                        backgroundColor:
                          isSubmitting || !description.trim() ? t.bgSecondary : t.accent,
                        color: isSubmitting || !description.trim() ? t.textMuted : t.accentText,
                        fontSize: "14px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        cursor: isSubmitting || !description.trim() ? "default" : "pointer",
                      }}
                    >
                      {isSubmitting
                        ? "Sending…"
                        : duplicate
                          ? `Add to #${duplicate.number}`
                          : "Send Report"}
                    </button>
                    )}
                  </>
                )}
                </>
              )}

              {/* The moment people actually give up is two replies into a
                  conversation that is not landing — not while looking at the
                  header. Offer the form there, in as many words. */}
              {phase === "chat" && messages.length > 0 && (
                <button
                  type="button"
                  data-gg-write-myself=""
                  onClick={() => leave("write_myself", "footer")}
                  style={{
                    display: "block",
                    margin: "8px auto 0",
                    border: "none",
                    background: "transparent",
                    color: t.textMuted,
                    fontSize: "11.5px",
                    fontFamily: "inherit",
                    padding: "6px 8px",
                    cursor: "pointer",
                  }}
                >
                  Not getting it? Fill the form yourself →
                </button>
              )}

              {/* #366 — the assistant itself is what went wrong. That report
                  belongs to Glitchgrab, not to the project behind this sheet. */}
              {/* Hidden while the offer card is up — it says the same thing, bigger. */}
              {onReportGlitchgrabProblem && phase !== "solved" && !glitchgrabOffer && (
                <button
                  type="button"
                  data-gg-self-report=""
                  onClick={() => onReportGlitchgrabProblem()}
                  style={{
                    display: "block",
                    // ~32px tap target; the negative margins keep the composer
                    // from growing to make room for it.
                    margin: "-2px auto -8px",
                    border: "none",
                    background: "transparent",
                    color: t.textMuted,
                    fontSize: "11.5px",
                    fontFamily: "inherit",
                    padding: "10px 8px",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  Assistant misbehaving? Tell Glitchgrab
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
