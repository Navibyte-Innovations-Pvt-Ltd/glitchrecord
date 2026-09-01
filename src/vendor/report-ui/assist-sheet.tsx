// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AssistFn, AssistTurnResult, DialogTile, ReportSeverity } from "./types";
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
}

interface AssistSheetProps {
  assist: AssistFn;
  theme: AssistTheme;
  /** Screenshot already attached to the report — the model reads it. */
  screenshot: string | null;
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
  severity: ReportSeverity;
  onSeverityChange: (value: ReportSeverity) => void;
  showSeverity: boolean;

  /**
   * Tells the dialog which issue to attach to, so its ONE submit path carries
   * the number into report metadata. Null clears it — the reporter kept typing
   * and it stopped looking like a duplicate.
   */
  onDuplicateChange?: (issueNumber: number | null) => void;

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

  onDegrade: (message: string) => void;
  onClose: () => void;
  /**
   * Close the whole dialog, not just the sheet. Used when the brief answered
   * the question: dropping them back onto an empty report form after telling
   * them they are done would read as "now file it anyway".
   */
  onFinish?: () => void;
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
  screenshot,
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
  onDuplicateChange,
  onConversationChange,
  isSubmitting,
  submitted,
  onSend,
  onDegrade,
  onClose,
  onFinish,
}: AssistSheetProps) {
  const narrow = useIsNarrow();
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
    { number: number; title: string; url: string } | null
  >(null);
  /**
   * The brief answered it. Nothing is filed and the dialog closes — the whole
   * point of giving the assistant the project's guides is that some people
   * should never have to write a report at all.
   */
  const [solved, setSolved] = useState<string | null>(null);
  /**
   * "type" → the picker chips, "rating" → stars, "chat" → the conversation,
   * "draft" → the model's report, ready to send. A sheet opened from the
   * dialog's own "Describe it with AI" button already knows its type and
   * starts at "chat"; ⌘⇧G starts at "type".
   */
  const [phase, setPhase] = useState<"type" | "rating" | "chat" | "draft" | "solved">(
    !typePicked ? "type" : currentTile === "RATING" ? "rating" : "chat",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  /** Guards the seed below against React 18's double-invoked effects. */
  const seededRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, phase]);

  useEffect(() => {
    if (phase === "draft") draftRef.current?.focus();
  }, [phase]);

  async function runTurn(history: ChatMessage[]) {
    setBusy(true);
    let result: AssistTurnResult;
    try {
      result = await assist({ messages: history, conversationId, screenshot, context });
    } catch {
      // AssistFn is documented as never-throwing, but a host is a host.
      onDegrade("The assistant is unavailable — write your report below and send it as normal.");
      return;
    } finally {
      setBusy(false);
    }

    if (result.degraded) {
      onDegrade(result.degraded);
      return;
    }
    if (result.conversationId) {
      setConversationId(result.conversationId);
      onConversationChange?.(result.conversationId);
    }

    setDuplicate(result.duplicate ?? null);
    onDuplicateChange?.(result.duplicate?.number ?? null);

    if (result.solved) {
      setSolved(result.solved);
      setOptions([]);
      setPhase("solved");
      return;
    }

    if (result.report) {
      onDescriptionChange(result.report);
      setMessages([...history, { role: "assistant", content: "Here's your report — have a read." }]);
      setOptions([]);
      setPhase("draft");
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
    const seed = description.trim();
    if (!seed) return;
    const history: ChatMessage[] = [{ role: "user", content: seed }];
    setMessages(history);
    void runTurn(history);
    // Intentionally once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setOptions([]);
    const history: ChatMessage[] = [...messages, { role: "user", content: value }];
    setMessages(history);
    setInput("");
    void runTurn(history);
  }

  /**
   * One tap answers "what do you want to do?". RATING branches away from the
   * model entirely; every other tile drops into the conversation the sheet
   * already had.
   */
  function pickType(tile: DialogTile) {
    onPickType(tile);
    setPhase(tile === "RATING" ? "rating" : "chat");
  }

  const empty = phase === "chat" && messages.length === 0 && !busy;

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
        @keyframes gg-dot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-3px);opacity:1}}
        [data-gg-sheet-send]:focus-visible,[data-gg-chip]:focus-visible{outline:2px solid currentColor;outline-offset:2px}
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
        onClick={onClose}
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
            <div style={{ minWidth: 0, overflow: "hidden" }}>
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
              onClick={onClose}
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
                      onClick={() => send(s)}
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
            {options.length > 0 && !busy && phase === "chat" && (
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
                    onClick={() => send(option)}
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
                  Your report · edit anything
                </span>

                {/* Someone already reported this. Said before Send, not after,
                    because "we know, we're on it" is the answer they came for —
                    and it is why this goes onto that issue instead of becoming
                    the fifth copy of it. */}
                {duplicate && (
                  <div
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
                    }}
                  >
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                      Our team is already on this
                    </span>
                    <span style={{ color: t.textMuted, wordBreak: "break-word" }}>
                      #{duplicate.number} {duplicate.title}
                    </span>
                    <span style={{ color: t.textMuted }}>
                      Your details will be added to it instead of opening a new issue.
                    </span>
                  </div>
                )}
                <textarea
                  ref={draftRef}
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
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

                {showSeverity && (
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
                    </span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {(["low", "medium", "high"] as ReportSeverity[]).map((s) => {
                        const on = severity === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onSeverityChange(s)}
                            aria-pressed={on}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: "8px 0",
                              borderRadius: "8px",
                              border: `1px solid ${on ? t.accent : t.inputBorder}`,
                              backgroundColor: on ? t.accent : "transparent",
                              color: on ? t.accentText : t.textMuted,
                              fontSize: "12px",
                              fontWeight: 600,
                              fontFamily: "inherit",
                              textTransform: "capitalize",
                              cursor: "pointer",
                            }}
                          >
                            {s}
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

                <button
                  type="button"
                  onClick={() => setPhase("chat")}
                  style={{
                    alignSelf: "flex-start",
                    border: "none",
                    background: "transparent",
                    color: t.textMuted,
                    fontSize: "12px",
                    fontFamily: "inherit",
                    padding: "9px 0",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Not quite — keep chatting
                </button>
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
          {!submitted && phase !== "type" && (
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
              ) : phase === "draft" ? (
                <button
                  type="button"
                  data-gg-sheet-send=""
                  onClick={onSend}
                  disabled={isSubmitting || !description.trim()}
                  style={{
                    width: "100%",
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
              ) : (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter breaks the line — the rule
                      // every chat surface uses, so nobody has to learn it.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    placeholder="Type your answer…"
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
                    onClick={() => send(input)}
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
              )}

              {/* The moment people actually give up is two replies into a
                  conversation that is not landing — not while looking at the
                  header. Offer the form there, in as many words. */}
              {phase === "chat" && messages.length > 0 && (
                <button
                  type="button"
                  data-gg-write-myself=""
                  onClick={onClose}
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
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
