// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AssistFn, AssistTurnResult, ReportSeverity } from "./types";

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
  /** The host's "Reporting to <project>" line, reused verbatim. */
  projectSlot?: ReactNode;
  reporterName?: string | null;

  /** The dialog's description state. The draft box edits it in place. */
  description: string;
  onDescriptionChange: (value: string) => void;
  severity: ReportSeverity;
  onSeverityChange: (value: ReportSeverity) => void;
  showSeverity: boolean;

  isSubmitting: boolean;
  submitted: boolean;
  onSend: () => void;

  onDegrade: (message: string) => void;
  onClose: () => void;
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
  projectSlot,
  reporterName,
  description,
  onDescriptionChange,
  severity,
  onSeverityChange,
  showSeverity,
  isSubmitting,
  submitted,
  onSend,
  onDegrade,
  onClose,
}: AssistSheetProps) {
  const narrow = useIsNarrow();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  /** "chat" until the model writes a report; then the draft, then Send. */
  const [phase, setPhase] = useState<"chat" | "draft">("chat");
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
    if (result.conversationId) setConversationId(result.conversationId);

    if (result.report) {
      onDescriptionChange(result.report);
      setMessages([...history, { role: "assistant", content: "Here's your report — have a read." }]);
      setPhase("draft");
      return;
    }
    if (result.question) {
      setMessages([...history, { role: "assistant", content: result.question }]);
      return;
    }
    onDegrade("The assistant had nothing to add — write your report below and send it as normal.");
  }

  // Whatever was already typed IS the first message. Making someone retype it
  // to "start the chat" would be the most annoying thing this feature could do.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
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
    const history: ChatMessage[] = [...messages, { role: "user", content: value }];
    setMessages(history);
    setInput("");
    void runTurn(history);
  }

  const empty = messages.length === 0 && !busy;

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
                {reportTypeLabel}
                {projectSlot ? <span style={{ marginLeft: "6px" }}>{projectSlot}</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close and write it myself"
              style={{
                flexShrink: 0,
                border: "none",
                background: "transparent",
                color: t.textMuted,
                cursor: "pointer",
                fontSize: narrow ? "18px" : "12px",
                lineHeight: 1,
                fontFamily: "inherit",
                padding: narrow ? "4px 6px" : "6px 4px",
              }}
            >
              {/* A phone header has no room for a sentence. */}
              {narrow ? "×" : "Write it myself"}
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
                    padding: 0,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Not quite — keep chatting
                </button>
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
          {!submitted && (
            <div
              style={{
                flexShrink: 0,
                borderTop: `1px solid ${t.border}`,
                padding: "12px 16px",
                paddingBottom: narrow ? "max(12px, env(safe-area-inset-bottom))" : "12px",
                backgroundColor: t.bg,
              }}
            >
              {phase === "draft" ? (
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
                  {isSubmitting ? "Sending…" : "Send Report"}
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
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
