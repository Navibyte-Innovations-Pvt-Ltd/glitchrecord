// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssistTheme } from "./assist-sheet";
import { encodeImageFile } from "./image-encode";
import type { GlitchgrabProblemFn } from "./types";

/**
 * "Problem with Glitchgrab?" (#366).
 *
 * Someone reporting a bug in a customer's app hits a problem with the reporter
 * itself — the assistant loops, a button does nothing. That report belongs to
 * Glitchgrab, not to the project behind the dialog, so it gets its own small
 * layer on top of everything with its own send, instead of hijacking the
 * dialog's one submit path. The report underneath is never touched: closing
 * this panel lands them exactly where they were.
 */

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const FAILED = "Couldn't send it. Try again in a moment.";

/** The server keeps the first 5 (`lib/glitchgrab-self-report.ts`); past that the button hides. */
export const MAX_SELF_REPORT_IMAGES = 5;

interface GlitchgrabProblemPanelProps {
  send: GlitchgrabProblemFn;
  theme: AssistTheme;
  surface: "form" | "assist";
  conversationId: string | null;
  reportType: string;
  /**
   * The report's images — what the panel starts with. Adding or removing one in
   * the panel changes only what goes to Glitchgrab, never the report underneath.
   */
  screenshots: string[];
  /** Opening text — the reporter's own chat words when the assistant offered this. */
  initialText?: string;
  onClose: () => void;
}

/**
 * "your AI chat, what you did on this page and 2 screenshots".
 *
 * Said before Send because none of it is the reporter's to give away silently:
 * it is their session on someone else's product, leaving that product.
 */
export function describeSentAlong(hasChat: boolean, screenshotCount: number): string {
  const parts = [
    ...(hasChat ? ["your AI chat"] : []),
    "what you did on this page",
    ...(screenshotCount > 0
      ? [`${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"}`]
      : []),
  ];
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function GlitchgrabProblemPanel({
  send,
  theme: t,
  surface,
  conversationId,
  reportType,
  screenshots,
  initialText = "",
  onClose,
}: GlitchgrabProblemPanelProps) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The panel's own copy. #375: a reporter showing us the problem had no way to
  // add the screenshot of it — the report's images went along unseen.
  const [images, setImages] = useState<string[]>(() =>
    screenshots.slice(0, MAX_SELF_REPORT_IMAGES),
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Same budget as the dialog's own attachments: a retina paste alone can be
  // over the request-body limit.
  const addImages = useCallback((files: File[]) => {
    const picked = files.filter((file) => file.type.startsWith("image/"));
    if (!picked.length) return;
    void Promise.all(picked.map((file) => encodeImageFile(file).catch(() => null))).then(
      (encoded) => {
        const added = encoded.filter((url): url is string => !!url);
        if (added.length) {
          setImages((prev) => [...prev, ...added].slice(0, MAX_SELF_REPORT_IMAGES));
        }
      },
    );
  }, []);

  // A pasted image belongs to this panel. Window + capture runs before the
  // dialog's own paste handler on window; without stopping it there the image
  // lands on the report underneath, where the reporter never sees it arrive.
  // Immediate, not plain stopPropagation: an event targeted at window itself
  // still runs every other window listener after a plain stop.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind !== "file") continue;
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
        if (!files.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        addImages(files);
      } catch {
        // An unreadable clipboard is just a paste that did nothing.
      }
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [addImages]);

  // Escape closes this layer and nothing else. Window + capture runs before the
  // dialog's own Escape handler on document; stopping it here keeps the report
  // underneath open — closing that would throw away the very draft this panel
  // promises to leave alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = async () => {
    const description = text.trim();
    if (!description || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await send({
        description,
        surface,
        conversationId,
        reportType,
        screenshots: images,
      });
      if (result?.success) setSent(true);
      else setError(result?.message || FAILED);
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!text.trim() && !busy;

  const secondaryButton = {
    padding: "10px 14px",
    borderRadius: "8px",
    border: `1px solid ${t.inputBorder}`,
    background: "transparent",
    color: t.text,
    fontSize: "13px",
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
  } as const;

  const primaryButton = (enabled: boolean) =>
    ({
      padding: "10px 14px",
      borderRadius: "8px",
      border: "none",
      backgroundColor: enabled ? t.accent : t.bgSecondary,
      color: enabled ? t.accentText : t.textMuted,
      fontSize: "13px",
      fontWeight: 700,
      fontFamily: "inherit",
      cursor: enabled ? "pointer" : "default",
    }) as const;

  return createPortal(
    // No close on backdrop click: a stray click would throw away what they typed.
    // `data-glitchgrab-layer` exempts this from the dialog's anti-focus-trap
    // sweep, which sets `inert` on every other role="dialog" on the page —
    // without it the panel renders but cannot be typed into.
    <div
      data-glitchgrab-layer=""
      data-gg-self-report-panel=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="gg-self-report-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          boxSizing: "border-box",
          backgroundColor: t.bg,
          color: t.text,
          border: `1px solid ${t.border}`,
          borderRadius: "12px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          padding: "18px",
        }}
      >
        {sent ? (
          <>
            <div id="gg-self-report-title" style={{ fontSize: "15px", fontWeight: 600 }}>
              Sent to the Glitchgrab team
            </div>
            <p style={{ margin: "6px 0 16px", fontSize: "13px", lineHeight: 1.5, color: t.textMuted }}>
              Thanks — we&apos;ll look into it. Your report is still open behind this, exactly as
              you left it.
            </p>
            <button
              type="button"
              data-gg-self-report-done=""
              onClick={onClose}
              style={{ ...primaryButton(true), width: "100%" }}
            >
              Back to your report
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div id="gg-self-report-title" style={{ fontSize: "15px", fontWeight: 600 }}>
                Problem with Glitchgrab?
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  border: "none",
                  background: "transparent",
                  color: t.textMuted,
                  fontSize: "18px",
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: "4px 6px",
                  margin: "-4px -6px 0 0",
                }}
              >
                ×
              </button>
            </div>
            <p style={{ margin: "6px 0 12px", fontSize: "13px", lineHeight: 1.5, color: t.textMuted }}>
              This goes to the people who build this reporter — not to this project&apos;s team.
              Tell us what went wrong: the AI chat, a button, anything.
            </p>

            <textarea
              ref={inputRef}
              data-gg-self-report-input=""
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={4}
              placeholder="e.g. The assistant kept asking the same question and never wrote a draft"
              style={{
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
                padding: "10px 12px",
                borderRadius: "8px",
                border: `1px solid ${t.inputBorder}`,
                backgroundColor: t.inputBg,
                color: t.text,
                fontSize: "14px",
                lineHeight: 1.45,
                fontFamily: "inherit",
                outline: "none",
              }}
            />

            <div
              data-gg-self-report-images=""
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px",
                marginTop: "10px",
              }}
            >
              {images.map((src, i) => (
                <div key={i} style={{ position: "relative", width: "48px", height: "48px" }}>
                  <img
                    src={src}
                    alt={`Screenshot ${i + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      boxSizing: "border-box",
                      borderRadius: "8px",
                      border: `1px solid ${t.inputBorder}`,
                    }}
                  />
                  <button
                    type="button"
                    data-gg-self-report-remove-image=""
                    aria-label={`Remove screenshot ${i + 1}`}
                    title="Don't send this one"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
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
                </div>
              ))}
              {images.length < MAX_SELF_REPORT_IMAGES && (
                <button
                  type="button"
                  data-gg-self-report-attach=""
                  aria-label="Add screenshot"
                  title="Add a screenshot — or paste one"
                  onClick={() => fileRef.current?.click()}
                  style={{
                    height: "48px",
                    padding: "0 12px",
                    boxSizing: "border-box",
                    borderRadius: "8px",
                    border: `1px dashed ${t.inputBorder}`,
                    background: "transparent",
                    color: t.textMuted,
                    fontSize: "12.5px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {/* Short once thumbnails fill the row, or on a phone it wraps
                      onto a line of its own. */}
                  {images.length >= 3 ? "+ Add" : "+ Add screenshot"}
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                data-gg-self-report-file=""
                onChange={(e) => {
                  addImages(Array.from(e.target.files ?? []));
                  // The same file twice in a row fires no change unless cleared.
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </div>

            <p
              data-gg-self-report-includes=""
              style={{ margin: "8px 0 0", fontSize: "11.5px", lineHeight: 1.45, color: t.textMuted }}
            >
              Also sent, so we can see what happened:{" "}
              {describeSentAlong(conversationId !== null, images.length)}.
            </p>
            {error && (
              <p role="alert" style={{ margin: "8px 0 0", fontSize: "12px", color: "#ef4444" }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
              <button type="button" onClick={onClose} style={secondaryButton}>
                Cancel
              </button>
              <button
                type="button"
                data-gg-self-report-send=""
                onClick={() => void submit()}
                disabled={!canSend}
                style={primaryButton(canSend)}
              >
                {busy ? "Sending…" : "Send to Glitchgrab"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
