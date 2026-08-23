// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
"use client";

import {
  useState,
  useRef,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnnotationCanvas } from "./annotation-canvas";
import { AssistSheet } from "./assist-sheet";
import { getShortcutLabel } from "./shortcut";
import { ATTACHMENT_ACCEPT } from "./attachments";
import { encodeScreenshot } from "./image-encode";
import type {
  ReportType,
  ReportSeverity,
  DialogTile,
  ReportFn,
  FeedbackFn,
  EnhanceTextFn,
  AssistFn,
  ReportReporter,
} from "./types";

/** Detect if the host page uses a dark or light theme */
function useIsDark(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Check body then html — most sites set background on html, not body
    for (const el of [document.body, document.documentElement]) {
      const bg = getComputedStyle(el).backgroundColor;
      const match = bg.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/,
      );
      if (match) {
        const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
        if (alpha < 0.05) continue; // transparent — skip to next element
        const [r, g, b] = [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
        ];
        return (r * 299 + g * 587 + b * 114) / 1000 < 128;
      }
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/** Convert HSL values to a hex color string */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Parse a CSS color value into [r, g, b] or null */
function parseColorToRgb(value: string): [number, number, number] | null {
  try {
    const trimmed = value.trim();

    // hex (#fff, #ffffff)
    const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3)
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }

    // rgb(r, g, b) or rgba(r, g, b, a)
    const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch)
      return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];

    // hsl(h, s%, l%) or hsla(h, s%, l%, a)
    const hslMatch = trimmed.match(
      /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/,
    );
    if (hslMatch) {
      const hex = hslToHex(
        Number(hslMatch[1]),
        Number(hslMatch[2]),
        Number(hslMatch[3]),
      );
      return parseColorToRgb(hex);
    }

    return null;
  } catch {
    return null;
  }
}

/** Compute relative luminance and return ideal contrast text color */
function getContrastText(r: number, g: number, b: number): string {
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 150 ? "#09090b" : "#ffffff";
}

/**
 * Auto-detect the host app's primary/accent color from CSS custom properties.
 * Checks common variable names used by shadcn/ui, Radix, Tailwind, MUI, etc.
 * Returns { accent, accentText } or null if no theme detected.
 */
function detectHostAccent(): { accent: string; accentText: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const root = getComputedStyle(document.documentElement);

    // Common CSS variable names for primary/accent color
    const varNames = [
      "--primary",
      "--accent",
      "--brand",
      "--color-primary",
      "--theme-primary",
      "--chakra-colors-primary-500",
      "--mui-palette-primary-main",
    ];

    for (const name of varNames) {
      const raw = root.getPropertyValue(name).trim();
      if (!raw) continue;

      // shadcn/ui style: space-separated HSL values like "243 75% 59%"
      const hslSpaceMatch = raw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
      if (hslSpaceMatch) {
        const hex = hslToHex(
          Number(hslSpaceMatch[1]),
          Number(hslSpaceMatch[2]),
          Number(hslSpaceMatch[3]),
        );
        const rgb = parseColorToRgb(hex);
        return {
          accent: hex,
          accentText: rgb ? getContrastText(...rgb) : "#ffffff",
        };
      }

      // Standard color values (hex, rgb, hsl)
      const rgb = parseColorToRgb(raw);
      if (rgb) {
        const hex = `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
        return { accent: hex, accentText: getContrastText(...rgb) };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** First letters of the first two words — "Naresh Bhosale" → "NB". */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Who this report will be filed as. Anonymous is shown, never hidden — a
 * reporter who assumes they're signed in and isn't would otherwise file
 * something nobody can follow up on, and find out only when no one replies.
 */
function ReporterChip({
  reporter,
  t,
}: {
  reporter: ReportReporter | null | undefined;
  t: ReturnType<typeof getTheme>;
}) {
  // An avatar URL that 404s, or one a host's CSP blocks, must not leave an empty
  // circle — fall back to the same initials/glyph as if none had been given.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUrl = reporter?.avatarUrl || "";
  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  const name = reporter?.name?.trim() || "";
  const isAnonymous = !name;
  const initials = isAnonymous ? "" : initialsOf(name);
  // "Anonymous", not "Not signed in": `session` is optional in the SDK and many
  // report surfaces are public, so an unauthenticated reporter is a normal state,
  // not an error to flag on every single report.
  const label = isAnonymous ? "Anonymous" : name;
  const title = isAnonymous
    ? "No reporter identity was passed to Glitchgrab — this report won't be attributed to anyone"
    : [name, reporter?.email, reporter?.role].filter(Boolean).join(" · ");
  const showAvatarImage = !!avatarUrl && !avatarFailed;

  return (
    <span
      title={title}
      style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "18px",
          height: "18px",
          flexShrink: 0,
          borderRadius: "50%",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "8px",
          fontWeight: 700,
          letterSpacing: "0.02em",
          background: isAnonymous ? t.inputBg : t.accent,
          color: isAnonymous ? t.textMuted : t.accentText,
          border: `1px solid ${isAnonymous ? t.inputBorder : "transparent"}`,
        }}
      >
        {showAvatarImage ? (
          <img
            src={avatarUrl}
            alt=""
            width={18}
            height={18}
            onError={() => setAvatarFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : initials ? (
          initials
        ) : (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="5.5" r="2.75" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M2.75 13.5c0-2.35 2.35-3.75 5.25-3.75s5.25 1.4 5.25 3.75"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span
        style={{
          fontSize: "11px",
          color: t.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {reporter?.role ? ` · ${reporter.role}` : ""}
      </span>
    </span>
  );
}

function getTheme(dark: boolean) {
  const hostAccent = detectHostAccent();
  const defaults = dark
    ? {
        bg: "#1c1c1e",
        bgSecondary: "#27272a",
        border: "#2c2c2e",
        text: "#fafafa",
        textMuted: "#a1a1aa",
        accent: "#22d3ee",
        accentText: "#09090b",
        inputBg: "#27272a",
        inputBorder: "#3f3f46",
      }
    : {
        bg: "#ffffff",
        bgSecondary: "#f4f4f5",
        border: "#e4e4e7",
        text: "#18181b",
        textMuted: "#71717a",
        accent: "#0891b2",
        accentText: "#ffffff",
        inputBg: "#fafafa",
        inputBorder: "#d4d4d8",
      };

  if (hostAccent) {
    defaults.accent = hostAccent.accent;
    defaults.accentText = hostAccent.accentText;
  }

  return defaults;
}

/** Validate that report text is meaningful — rejects gibberish, throwaway words, random chars */
function isLowQualityText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Exact throwaway words
  const throwaway =
    /^(done|ok|yes|no|hi|hello|hey|test|testing|asdf|qwerty|abc|xyz|foo|bar|baz|lol|lmao|idk|bruh|nice|cool|wow|sup|yo|nah|yep|nope|thanks|thx|ty|k|kk|hmm|hm|na|mm|mhm|aight|bet|gg|wp|rip|omg|pls|plz)$/i;
  if (throwaway.test(trimmed)) {
    return "Please describe the actual issue you're experiencing";
  }

  // Repeated characters (aaaaaaa, !!!!!!!)
  if (/(.)\1{4,}/.test(trimmed)) {
    return "Please provide a meaningful description";
  }

  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 4) {
    // Very low vowel ratio (bkdfghjklmn...)
    const vowels = letters.replace(/[^aeiouAEIOU]/g, "").length;
    const vowelRatio = vowels / letters.length;
    if (vowelRatio < 0.08) {
      return "That doesn't look like a valid description";
    }

    // Keyboard mashing: single word with no real English pattern
    // Detects strings like "asdfasfsdad", "jkljklfsdf", "qwertyuio"
    // Real words have max 3-4 consecutive consonants; gibberish has long runs
    if (/[^aeiou\s]{5,}/i.test(letters)) {
      const words = trimmed.split(/\s+/);
      // Only flag if it's a single "word" — multi-word text is likely real
      if (words.length <= 2) {
        return "That doesn't look like a valid description";
      }
    }

    // Check if it looks like a random permutation of a few chars (asdfasfsdad)
    if (letters.length >= 6) {
      const uniqueChars = new Set(letters.toLowerCase()).size;
      const uniqueRatio = uniqueChars / letters.length;
      // Real English has ~0.6-0.9 unique ratio for short text; gibberish reuses few chars
      if (uniqueRatio < 0.4 && trimmed.split(/\s+/).length <= 2) {
        return "That doesn't look like a valid description";
      }
    }
  }

  // Single short word that isn't a known tech term
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1 && trimmed.length < 10) {
    const techTerms =
      /^(crash|error|bug|fail|broken|slow|freeze|lag|404|500|null|undefined|nan|timeout|overflow|leak|cors|oom)$/i;
    if (!techTerms.test(trimmed)) {
      return "Please provide more detail about the issue";
    }
  }

  return null;
}

interface ReportDialogProps {
  report: ReportFn;
  /**
   * Saves a star rating. Passing it adds the `RATING` tile to step 1 — a
   * testimonial lives in the same dialog as a bug report because from the
   * user's side it's the same question ("what's on your mind?"), even though it
   * takes a completely different path server-side (feedback row, never a GitHub
   * issue). Omit it and the tile never appears.
   */
  sendFeedback?: FeedbackFn;
  enhanceText?: EnhanceTextFn;
  /**
   * Runs one turn of the AI report assistant (#330). Supplying it adds a
   * "Describe it with AI" affordance above the description box; omitting it
   * leaves the dialog exactly as it was. The assistant is an EXTRA mode, never
   * a replacement — the plain form stays present and usable throughout, and
   * the assistant closes itself the moment it cannot help.
   *
   * Hosts pass this only when the project has it switched on: the SDK reads
   * `aiAssist` off /api/v1/sdk/project. The server re-checks the same column on
   * every call, so this prop is a UI hint and not a permission.
   */
  assist?: AssistFn;
  /**
   * Session facts handed to the assistant — page URL, pages visited, recent
   * clicks and API calls. The host owns this because only the host has it: the
   * SDK keeps breadcrumbs, the extension has the tab, GlitchRecord has neither.
   */
  assistContext?: Record<string, unknown> | null;
  transcribeAudio?: (blob: Blob) => Promise<string>;
  types?: ReportType[];
  showSeverity?: boolean;
  /**
   * Overrides how the initial/retake screenshot is captured. Defaults to
   * html2canvas-pro over `document.body` (correct for the SDK, embedded in
   * the host page). Standalone hosts must inject their own — `document.body`
   * there is the host's OWN tiny window, not the thing being reported:
   *   - Chrome extension → `chrome.tabs.captureVisibleTab`
   *   - GlitchRecord desktop → Electron `desktopCapturer` (whole screen, so it
   *     works for any browser or native app, not just Chrome)
   * Return `null` to open without a screenshot.
   */
  captureScreenshot?: () => Promise<string | null>;
  /**
   * Who the report will be attributed to. Omit or pass `null` and the footer
   * says "Not signed in" rather than showing nothing — silence there reads as
   * "you're signed in", which is the failure worth preventing.
   */
  reporter?: ReportReporter | null;
  /**
   * Called when the dialog closes itself (the × or Escape).
   *
   * Hosts that mount this inside something of their own — the extension puts it
   * in a full-page iframe — otherwise have no way to know it is gone, and are
   * left with an invisible overlay still swallowing every click on the page.
   */
  onClose?: () => void;
  /**
   * Rendered at the top of step 1, inside the dialog.
   *
   * For hosts that must ask something the dialog itself knows nothing about —
   * the Chrome extension has to pick WHICH project a bug belongs to, because
   * unlike an SDK embedded in one app it could be reporting on anything. Left
   * outside, that question needed its own panel wrapped around this one, and
   * two stacked cards read as a bug in the bug reporter.
   */
  headerSlot?: ReactNode;
}

async function captureViaHtml2Canvas(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import("html2canvas-pro");
    // Capture at the display's own pixel density so UI text stays readable.
    // Capped at 2 — beyond that the payload grows faster than the legibility.
    const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const canvas = await html2canvas(document.body, {
      scale,
      logging: false,
      useCORS: true,
      allowTaint: true,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });
    return encodeScreenshot(canvas);
  } catch {
    return null;
  }
}

/**
 * The report dialog — rendered inside GlitchgrabProvider automatically.
 * Opens via the `glitchgrab:open-report` custom event (triggered by `openReportDialog()`).
 */
export function ReportDialog({
  report,
  sendFeedback,
  enhanceText,
  assist,
  assistContext = null,
  transcribeAudio,
  types,
  showSeverity = true,
  captureScreenshot = captureViaHtml2Canvas,
  reporter,
  onClose,
  headerSlot,
}: ReportDialogProps) {
  const [isEnhancing, setIsEnhancing] = useState(false);

  /**
   * AI assistant (#330). Closed until asked for, and one-way: once it degrades
   * or hands over a description it does not reopen itself. `assistNotice` is
   * why it went away, shown once under the box so the reporter is never left
   * wondering where the button went.
   */
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  const [assistUsed, setAssistUsed] = useState(false);
  const [isEnhanced, setIsEnhanced] = useState(false);
  const [originalDescription, setOriginalDescription] = useState<string | null>(
    null,
  );
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [screenshotDragOver, setScreenshotDragOver] = useState(false);
  // Prevent hydration mismatch — render nothing until after hydration
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<
    { name: string; size: number; dataUrl: string }[]
  >([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [annotatingIndex, setAnnotatingIndex] = useState<number | null>(null);
  // Lightbox zoom: false = fit to screen, true = 100% natural size with pan.
  const [previewZoomed, setPreviewZoomed] = useState(false);
  const [previewNatural, setPreviewNatural] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewImgElRef = useRef<HTMLImageElement>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  // Fraction of the image the user clicked, so zooming in keeps that spot centred.
  const zoomAnchorRef = useRef<{ fx: number; fy: number } | null>(null);

  // Every preview opens fit-to-screen, so zoom state is reset alongside the
  // index rather than by an effect chasing it.
  const resetPreviewZoom = () => {
    setPreviewZoomed(false);
    setPreviewNatural(null);
    zoomAnchorRef.current = null;
  };
  const openPreview = (i: number) => {
    resetPreviewZoom();
    setPreviewIndex(i);
  };
  const closePreview = () => {
    resetPreviewZoom();
    setPreviewIndex(null);
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previewImgRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const voiceBaseRef = useRef("");
  const usingWebSpeechRef = useRef(false);
  const textBeforeVoiceRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sarvamChunksRef = useRef<Blob[]>([]);
  const spaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPushToTalkRef = useRef(false);

  // A host focus trap — Radix `FocusScope` inside a Dialog, DropdownMenu, Select,
  // or any other library doing the same — keeps document-level `focusin`/`focusout`
  // listeners that yank focus straight back into its own container. While one is
  // live, GlitchGrab's textarea is unusable: clicks land, but typing and
  // drag-select do nothing, because focus never stays where the user put it.
  //
  // `inert` is the counter: focusing *into* an inert subtree is a no-op, so the
  // trap's grab fails silently instead of fighting us for the caret. Re-applied
  // by a MutationObserver rather than snapshotted once at open — a host layer
  // that mounts after GlitchGrab (a prompt fired by a late query, a menu still
  // mounted through its close animation) would otherwise keep its trap.
  useEffect(() => {
    if (!isOpen) return;

    const HOST_LAYERS =
      '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';
    // Only the ones *we* set inert get it removed again on cleanup — a host that
    // was already inert must stay that way.
    const inerted = new Set<HTMLElement>();

    const applyInert = () => {
      document.querySelectorAll<HTMLElement>(HOST_LAYERS).forEach((el) => {
        // Our own layers, and anything wrapping them, must stay interactive.
        if (el.closest("[data-glitchgrab-layer]")) return;
        if (el.querySelector("[data-glitchgrab-layer]")) return;
        if (inerted.has(el) || el.hasAttribute("inert")) return;
        el.setAttribute("inert", "");
        inerted.add(el);
      });
    };

    applyInert();

    const observer = new MutationObserver((mutations) => {
      // Attribute-only churn (a `data-state` flip, a class swap) can't introduce a
      // layer we haven't seen, so skip the query unless nodes actually moved.
      const structural = mutations.some(
        (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0,
      );
      if (structural) applyInert();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      inerted.forEach((el) => el.removeAttribute("inert"));
    };
  }, [isOpen]);

  // Stepper state
  const [step, setStep] = useState<1 | 2>(1);
  const [reportType, setReportType] = useState<DialogTile>("BUG");
  const [severity, setSeverity] = useState<ReportSeverity>("medium");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  /** 0 = nothing picked yet. Only meaningful while the RATING tile is selected. */
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);

  const isRating = reportType === "RATING";

  // A rating is gated on the stars, not the words — the message is optional.
  const submitDisabled = isSubmitting || (isRating ? rating < 1 : !description.trim());

  // RATING is deliberately NOT a tile: it gets the hero row above the grid, so
  // the stars are one click away instead of three, and its icon can't be
  // confused with Feature Request's star.
  // OTHER is gone from the default set: the rating hero is now the home for
  // "general feedback", and the two side by side asked the same question twice.
  // Hosts that still want it can pass it explicitly via `types`.
  const availableTypes: DialogTile[] = types ?? [
    "BUG",
    "FEATURE_REQUEST",
    "UI_IMPROVEMENT",
    "PERFORMANCE",
    "SECURITY",
    "QUESTION",
  ];

  const tileGridRef = useRef<HTMLDivElement>(null);

  /**
   * Step-1 shortcuts. Digits 1–5 set the rating and go straight to the message
   * box; letters jump to the tile they start with (b=bug, f=feature, u=ui,
   * p=performance, s=security, q=question).
   *
   * Digits are the rating rather than the tiles because the two would collide,
   * and the hero is the primary action — tiles are still one keystroke away by
   * letter, plus arrows and Tab.
   */
  useEffect(() => {
    if (!isOpen || step !== 1) return;
    const onKey = (e: KeyboardEvent) => {
      // Never hijack a key someone is typing into a field.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (sendFeedback && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        setRating(Number(e.key));
        setReportType("RATING");
        setStep(2);
        return;
      }

      const letter = e.key.toLowerCase();
      if (!/^[a-z]$/.test(letter)) return;
      const match = availableTypes.find(
        (type) => getTypeLabel(type).toLowerCase().startsWith(letter)
      );
      if (match) {
        e.preventDefault();
        setReportType(match);
        setStep(2);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `availableTypes` is rebuilt each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step, sendFeedback, availableTypes.join(",")]);

  /**
   * Arrow keys walk the tile grid, so the whole picker works without a mouse.
   * Two columns, so up/down is ±2 and left/right is ±1; Enter and Space are
   * left to the buttons themselves.
   */
  const handleTileGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    const tiles = Array.from(
      tileGridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-gg-type]") ?? []
    );
    if (tiles.length === 0) return;
    e.preventDefault();
    const current = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const delta =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 2 : -2;
    // From "nothing focused", the first arrow press should land on the first
    // tile rather than jumping into the middle of the grid.
    const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), tiles.length - 1);
    tiles[next]?.focus();
  };

  const isDark = useIsDark();
  const t = getTheme(isDark);

  // Zooming only earns its place when the screenshot holds more pixels than the
  // fit-to-screen view can show.
  const canZoomPreview =
    previewNatural !== null &&
    typeof window !== "undefined" &&
    (previewNatural.w > window.innerWidth - 32 ||
      previewNatural.h > window.innerHeight - 80);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
    e.target.value = "";
  };

  const addFiles = (files: File[]) => {
    files.forEach((file) => {
      const reader = new FileReader();
      if (file.type.startsWith("image/")) {
        reader.onload = () => {
          setScreenshots((prev) => [...prev, reader.result as string]);
        };
      } else {
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            { name: file.name, size: file.size, dataUrl: reader.result as string },
          ]);
        };
      }
      reader.readAsDataURL(file);
    });
  };

  const handleOpen = async () => {
    setSubmitted(false);
    // Belt to `handleClose`'s braces: every open starts on the form, never on a
    // preview or annotator left over from last time. Asserted here rather than
    // only on close so it holds however the dialog was dismissed.
    closePreview();
    setAnnotatingIndex(null);
    if (availableTypes.length === 1) {
      setReportType(availableTypes[0]);
      setStep(2);
    }
    const shot = await captureScreenshot();
    if (shot) setScreenshots([shot]);
    setIsOpen(true);
  };

  // Listen for programmatic open via openReportDialog()
  useEffect(() => {
    const handler = (e: Event) => {
      if (isOpen) return;
      const detail = (e as CustomEvent).detail;
      if (detail?.description) setDescription(detail.description);
      if (detail?.type) {
        setReportType(detail.type);
        setStep(2);
      }
      handleOpen();
    };
    window.addEventListener("glitchgrab:open-report", handler);
    return () => window.removeEventListener("glitchgrab:open-report", handler);
  }, [isOpen, handleOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape unwinds one layer at a time, topmost first:
        // annotate → zoom → preview → dialog. Annotate has to lead — it renders
        // above the preview, so skipping it would close the layer *underneath*
        // the one the user is looking at and strand the canvas on screen.
        if (annotatingIndex !== null) setAnnotatingIndex(null);
        else if (previewZoomed) setPreviewZoomed(false);
        else if (previewIndex !== null) closePreview();
        else handleClose();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, previewIndex, previewZoomed, annotatingIndex]);

  // Close screenshot preview on outside click. Registered in the CAPTURE phase
  // so it fires before the host page's own outside-click handlers (e.g. Radix
  // DismissableLayer) can stop the event from ever bubbling to our onClick.
  useEffect(() => {
    if (previewIndex === null || annotatingIndex !== null) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!previewImgRef.current?.contains(e.target as Node)) {
        closePreview();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [previewIndex, annotatingIndex]);

  // After zooming in, scroll so the point the user clicked is centred.
  useEffect(() => {
    const el = previewScrollRef.current;
    if (!previewZoomed || !el) return;
    const anchor = zoomAnchorRef.current ?? { fx: 0.5, fy: 0.5 };
    el.scrollLeft = anchor.fx * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = anchor.fy * el.scrollHeight - el.clientHeight / 2;
  }, [previewZoomed]);

  // Lives on the scroll container, not the <img>: while panning we hold pointer
  // capture on the container, and Chrome retargets the resulting click there
  // too — a handler on the image would never fire in the zoomed state.
  const togglePreviewZoom = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // A drag that panned the image must not also flip the zoom state.
    if (panRef.current?.moved) return;
    if (!previewZoomed && !canZoomPreview) return;
    const img = previewImgElRef.current;
    if (!previewZoomed && img) {
      const rect = img.getBoundingClientRect();
      zoomAnchorRef.current = {
        fx: (e.clientX - rect.left) / rect.width,
        fy: (e.clientY - rect.top) / rect.height,
      };
    }
    setPreviewZoomed((z) => !z);
  };

  const handlePanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = previewScrollRef.current;
    if (!previewZoomed || !el) return;
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
  };

  const handlePanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = previewScrollRef.current;
    const start = panRef.current;
    if (!el || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) start.moved = true;
    el.scrollLeft = start.left - dx;
    el.scrollTop = start.top - dy;
  };

  const handlePanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = previewScrollRef.current;
    const moved = panRef.current?.moved ?? false;
    try {
      el?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    // Keep `moved` readable through the click that follows this pointerup.
    if (moved) {
      panRef.current = { x: 0, y: 0, left: 0, top: 0, moved: true };
      setTimeout(() => {
        panRef.current = null;
      }, 0);
    } else {
      panRef.current = null;
    }
  };

  // Paste files from clipboard (Cmd+V / Ctrl+V) when dialog is open. Images land
  // in the screenshot strip, any other pasted file becomes an attachment. Plain
  // text is untouched so typing into the textarea still pastes normally.
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pasted: File[] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind !== "file") continue;
          const file = items[i].getAsFile();
          if (file) pasted.push(file);
        }
        if (pasted.length > 0) {
          e.preventDefault();
          addFiles(pasted);
        }
      } catch {
        // silently fail
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !transcribeAudio) return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % 2);
    }, 3000);
    return () => clearInterval(id);
  }, [isOpen, transcribeAudio]);

  const stopVoice = () => {
    usingWebSpeechRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    sarvamChunksRef.current = [];
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ }
    mediaRecorderRef.current = null;
    setIsListening(false);
    setIsTranscribing(false);
  };

  const stopListeningAndTranscribe = () => {
    usingWebSpeechRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ }
  };

  /**
   * Is the AI sheet the surface in charge right now?
   *
   * When it is, the dialog is hidden outright rather than dimmed behind it. The
   * two share `description` and `severity`, so leaving it on screen showed the
   * same report text, the same severity buttons and a second Send Report behind
   * a translucent overlay — one report wearing two faces. Nothing is lost by
   * hiding it: the state is shared, so "Write it myself" brings it straight
   * back with everything intact.
   */
  const sheetUp = !!assist && assistOpen && !isRating;

  /**
   * `display:none` already takes the dialog out of the tab order, but it is set
   * by React on the overlay while `inert`/`aria-hidden` go on the card itself —
   * so this also covers the frame where the sheet is mounting and the dialog
   * has not yet been hidden.
   */
  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    if (sheetUp) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  }, [sheetUp, isOpen]);

  const handleClose = () => {
    stopVoice();
    setIsOpen(false);
    onClose?.();
    // The preview and annotation overlays are full-viewport portals at the top of
    // the stacking order. Leaving their indices set on close leaves one of them
    // mounted over a dialog that is no longer there — the page stops accepting
    // typing or selection entirely, and the next open renders *underneath* it.
    closePreview();
    setAnnotatingIndex(null);
    setStep(1);
    setRating(0);
    setHoveredStar(0);
    setReportType("BUG");
    setSeverity("medium");
    setValidationError(null);
    setVoiceError(null);
    setIsEnhanced(false);
    setOriginalDescription(null);
    // A new report is a new conversation. Leaving `assistUsed` set would hide
    // the assistant for the rest of the page's life after one use.
    setAssistOpen(false);
    setAssistUsed(false);
    setAssistNotice(null);
  };

  const toggleVoice = async () => {
    if (isListening) {
      stopListeningAndTranscribe();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec: (new () => any) | undefined = (typeof window !== "undefined")
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : undefined;

    // Get mic stream for MediaRecorder (Sarvam final accurate result)
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const isDenied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      if (!SpeechRec || isDenied) { setVoiceError("Microphone access denied"); return; }
    }

    if (stream && transcribeAudio) {
      streamRef.current = stream;
      sarvamChunksRef.current = [];
      textBeforeVoiceRef.current = description;

      const rec = new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) sarvamChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream!.getTracks().forEach((t) => t.stop());
        if (streamRef.current === stream) streamRef.current = null;
        mediaRecorderRef.current = null;
        const chunks = sarvamChunksRef.current;
        sarvamChunksRef.current = [];
        if (!chunks.length || !transcribeAudio) return;
        setIsTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          const text = await transcribeAudio(blob);
          if (text.trim()) {
            const sep = textBeforeVoiceRef.current.trim() ? " " : "";
            // Replace live Web Speech preview with accurate Sarvam result
            setDescription(textBeforeVoiceRef.current + sep + text.trim());
            setValidationError(null);
            setIsEnhanced(false);
            setOriginalDescription(null);
          }
        } catch { /* keep Web Speech result on failure */ }
        setIsTranscribing(false);
      };
      rec.start();
    }

    if (SpeechRec) {
      setVoiceError(null);
      usingWebSpeechRef.current = true;
      voiceBaseRef.current = description;
      textBeforeVoiceRef.current = description;
      const recognition = new SpeechRec();
      recognition.lang = "en-IN";
      recognition.interimResults = true;
      recognition.continuous = true;
      recognitionRef.current = recognition;

      recognition.onstart = () => setIsListening(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += text;
          else interimText += text;
        }
        if (finalText) {
          const sep = voiceBaseRef.current.trim() ? " " : "";
          voiceBaseRef.current += sep + finalText.trim();
        }
        const liveText = interimText
          ? voiceBaseRef.current + (voiceBaseRef.current.trim() ? " " : "") + interimText
          : voiceBaseRef.current;
        setDescription(liveText);
        setValidationError(null);
      };

      recognition.onend = () => {
        if (usingWebSpeechRef.current && recognitionRef.current === recognition) {
          try { recognition.start(); } catch { /* ignore */ }
        } else {
          setIsListening(false);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        const isDenied = event.error === "not-allowed" || event.error === "audio-capture";
        setVoiceError(isDenied ? "Microphone access denied" : "Speech recognition not available — try Chrome");
        usingWebSpeechRef.current = false;
        recognitionRef.current = null;
        setIsListening(false);
      };

      recognition.start();
    } else if (stream) {
      // Firefox: Sarvam-only, no live preview
      setVoiceError(null);
      setIsListening(true);
    }
  };

  const handleSpaceDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.code !== "Space") return;
    // Recording or already-committed to push-to-talk — swallow the space
    if (isListening || isPushToTalkRef.current) {
      e.preventDefault();
      return;
    }
    // Auto-repeat from a held key, or a timer already pending — let the browser
    // type normally; we only care about the first keydown of a hold.
    if (e.repeat || !transcribeAudio || isTranscribing || spaceTimerRef.current)
      return;

    // Don't preventDefault: let the browser insert the space natively so the
    // cursor stays exactly where the user typed it. If the hold matures into
    // push-to-talk, strip that space back out below.
    const pos = e.currentTarget.selectionStart ?? description.length;
    spaceTimerRef.current = setTimeout(() => {
      spaceTimerRef.current = null;
      isPushToTalkRef.current = true;
      setDescription((prev) =>
        prev[pos] === " " ? prev.slice(0, pos) + prev.slice(pos + 1) : prev,
      );
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = pos;
          textareaRef.current.selectionEnd = pos;
        }
      });
      void toggleVoice();
    }, 400);
  };

  const handleSpaceUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.code !== "Space") return;
    if (spaceTimerRef.current) {
      // Quick tap — space was already typed natively, nothing to do.
      clearTimeout(spaceTimerRef.current);
      spaceTimerRef.current = null;
    }
    if (isPushToTalkRef.current) {
      isPushToTalkRef.current = false;
      stopListeningAndTranscribe();
    }
  };

  const handleSubmit = async () => {
    try {
      if (isSubmitting) return;

      // A rating takes the feedback path: the stars are the payload, the words
      // are optional, and nothing here reaches GitHub. The low-quality-text
      // guard is deliberately skipped — "love it" is a fine testimonial and a
      // useless bug report, and this branch is the former.
      if (isRating) {
        if (rating < 1) {
          setValidationError("Pick a star rating first.");
          return;
        }
        if (!sendFeedback) return;

        setIsSubmitting(true);
        const result = await sendFeedback(rating, description.trim() || undefined);
        if (result?.success) {
          setSubmitted(true);
          setDescription("");
          setRating(0);
          setTimeout(() => {
            setSubmitted(false);
            handleClose();
          }, 2000);
        } else {
          setValidationError("Could not send — please try again.");
        }
        setIsSubmitting(false);
        return;
      }

      if (!description.trim()) return;

      const qualityError = isLowQualityText(description);
      if (qualityError) {
        setValidationError(qualityError);
        setStep(2);
        return;
      }

      setIsSubmitting(true);
      const metadata: Record<string, string> = {};
      if (screenshots.length > 0) metadata.screenshots = JSON.stringify(screenshots);
      if (attachments.length > 0) metadata.attachments = JSON.stringify(attachments);
      if (showSeverity && reportType === "BUG") {
        metadata.severity = severity;
      }

      const result = await report(
        // The RATING branch returned above, so anything reaching here is a real
        // ReportType — the widened tile union can't leak into the report API.
        reportType as ReportType,
        description.trim(),
        Object.keys(metadata).length > 0 ? metadata : undefined,
      );

      if (result) {
        setSubmitted(true);
        setDescription("");
        setScreenshots([]);
        setAttachments([]);

        setTimeout(() => {
          setSubmitted(false);
          handleClose();
        }, 2000);
      }
      setIsSubmitting(false);
    } catch {
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  return (
    <>
      {/* Keyframes for REC pulse — injected once when open */}
      {isOpen &&
        createPortal(
          <style>{`
          @keyframes gg-pulse{0%,100%{opacity:1}50%{opacity:0.35}}
          @keyframes gg-b1{0%,100%{height:3px}40%{height:13px}}
          @keyframes gg-b2{0%,100%{height:8px}50%{height:3px}}
          @keyframes gg-b3{0%,100%{height:4px}30%{height:14px}70%{height:5px}}
          @keyframes gg-b4{0%,100%{height:6px}60%{height:13px}}
          @keyframes gg-bug-crawl{0%,100%{transform:translateX(0) rotate(0deg)}20%{transform:translateX(-1.5px) rotate(-6deg)}40%{transform:translateX(1.5px) rotate(5deg)}60%{transform:translateX(-1px) rotate(-4deg)}80%{transform:translateX(1px) rotate(3deg)}}
          @keyframes gg-star-spin{0%,100%{transform:scale(1) rotate(0deg)}50%{transform:scale(1.15) rotate(15deg)}}
          @keyframes gg-ui-grow{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.12)}}
          @keyframes gg-perf-sweep{0%,100%{transform:rotate(0deg)}30%{transform:rotate(-12deg)}70%{transform:rotate(10deg)}}
          @keyframes gg-shield-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.08);opacity:.75}}
          @keyframes gg-question-shake{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}
          @keyframes gg-chat-tilt{0%,100%{transform:rotate(0deg) translateY(0)}50%{transform:rotate(-6deg) translateY(-2px)}}
          button[data-gg-type] > svg{transform-origin:center}
          button[data-gg-type="BUG"] > svg{animation:gg-bug-crawl 2.2s ease-in-out infinite}
          button[data-gg-type="FEATURE_REQUEST"] > svg{animation:gg-star-spin 2.6s ease-in-out infinite}
          button[data-gg-type="UI_IMPROVEMENT"] > svg{animation:gg-ui-grow 1.8s ease-in-out infinite;transform-origin:bottom}
          button[data-gg-type="PERFORMANCE"] > svg{animation:gg-perf-sweep 2.4s ease-in-out infinite}
          button[data-gg-type="SECURITY"] > svg{animation:gg-shield-pulse 2.2s ease-in-out infinite;transform-origin:top}
          button[data-gg-type="QUESTION"] > svg{animation:gg-question-shake 2s ease-in-out infinite}
          button[data-gg-type="OTHER"] > svg{animation:gg-chat-tilt 2.2s ease-in-out infinite}
          /* Lift on hover, settle on press. Cheaper and steadier than doing it
             through React state, and :focus-visible keeps the ring off mouse users
             while leaving it for the arrow-key path. */
          button[data-gg-type]{transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
          button[data-gg-type]:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.18)}
          button[data-gg-type]:active{transform:translateY(0) scale(.985);box-shadow:none}
          button[data-gg-type]:focus-visible{outline:2px solid ${t.accent};outline-offset:2px}
          @keyframes gg-star-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
          button[data-gg-star]{transition:transform .12s ease}
          button[data-gg-star]:hover{transform:scale(1.18)}
          button[data-gg-star]:active{transform:scale(.94)}
          button[data-gg-star]:focus-visible{outline:2px solid #f59e0b;outline-offset:3px;border-radius:4px}
        `}</style>,
          document.body,
        )}
      {/* Report modal */}
      {isOpen &&
        createPortal(
          <div
            data-glitchgrab-layer=""
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2147483647,
              pointerEvents: "auto",
              // Hidden, not unmounted, while the AI sheet is in charge — the
              // dialog's state IS the report, and unmounting would drop the
              // screenshots, attachments and step the reporter is on.
              display: sheetUp ? "none" : "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.5)",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}
            onClick={() => {
              if (previewIndex === null) handleClose();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
          >
            <div
              ref={modalRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                zIndex: 2147483647,
                width: "420px",
                maxWidth: "calc(100% - 32px)",
                maxHeight: "calc(100dvh - 32px)",
                display: "flex",
                flexDirection: "column",
                backgroundColor: t.bg,
                borderRadius: "12px",
                boxShadow:
                  "0 20px 60px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1)",
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                overflow: "hidden",
                color: t.text,
                isolation: "isolate",
              }}
            >
              {/* Header */}
              <div
                style={{
                  flexShrink: 0,
                  padding: "16px 16px 12px",
                  borderBottom: `1px solid ${t.border}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    {step > 1 && (
                      <button
                        type="button"
                        onClick={() => setStep((s) => (s - 1) as 1 | 2)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "2px",
                          display: "flex",
                          alignItems: "center",
                        }}
                        aria-label="Back"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M10 3L5 8L10 13"
                            stroke={t.textMuted}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: 600,
                        color: t.text,
                      }}
                    >
                      {step === 1 ? "What's on your mind?" : "Tell us more"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    {step === 1 && (
                      <span
                        title="Press this anywhere to open Glitchgrab"
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          lineHeight: 1,
                          padding: "3px 6px",
                          borderRadius: "4px",
                          border: `1px solid ${t.inputBorder}`,
                          background: t.inputBg,
                          color: t.textMuted,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {getShortcutLabel()}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleClose}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      aria-label="Close"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        style={{ display: "block" }}
                      >
                        <path
                          d="M4 4L12 12M12 4L4 12"
                          stroke={t.textMuted}
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0",
                    marginTop: "12px",
                  }}
                >
                  {[1, 2].map((s, i) => (
                    <div
                      key={s}
                      style={{ display: "flex", alignItems: "center" }}
                    >
                      <div
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: s <= step ? t.accent : t.inputBorder,
                          transition: "background-color 0.2s ease",
                        }}
                      />
                      {i < 1 && (
                        <div
                          style={{
                            width: "40px",
                            height: "2px",
                            backgroundColor:
                              s < step ? t.accent : t.inputBorder,
                            transition: "background-color 0.2s ease",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div
                style={{
                  padding: "18px",
                  overflowY: "auto",
                  flex: "1 1 auto",
                  minHeight: 0,
                }}
              >
                {submitted ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "20px 0",
                      color: t.accent,
                      fontSize: "14px",
                      fontWeight: 500,
                    }}
                  >
                    {getTypeLabel(reportType)} sent. Thank you!
                  </div>
                ) : (
                  <>
                    {/* Step 1: Category */}
                    {/* Rating hero — a compliment is a different act from filing
                        a bug, so it gets its own row instead of hiding as the
                        8th identical tile. Clicking a star both sets it and
                        advances, turning a 3-click flow into 1. */}
                    {step === 1 && headerSlot ? (
                      <div style={{ marginBottom: "14px" }}>{headerSlot}</div>
                    ) : null}

                    {step === 1 && sendFeedback && (
                      <div
                        style={{
                          border: "1px solid rgba(245,158,11,0.35)",
                          background: "rgba(245,158,11,0.07)",
                          borderRadius: "10px",
                          padding: "14px 16px",
                          marginBottom: "16px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          flexWrap: "wrap",
                        }}
                        onMouseLeave={() => setHoveredStar(0)}
                      >
                        <span
                          style={{ fontSize: "13px", fontWeight: 600, color: t.text }}
                        >
                          How are we doing?
                        </span>
                        <span style={{ display: "flex", gap: "4px" }}>
                          {[1, 2, 3, 4, 5].map((star) => {
                            // `rating` is normally 0 here; it only shows through
                            // when someone rated, hit Back, and returned.
                            const filled = star <= (hoveredStar || rating);
                            return (
                              <button
                                key={star}
                                type="button"
                                data-gg-star={star}
                                aria-label={`${star} star${star > 1 ? "s" : ""}`}
                                onMouseEnter={() => setHoveredStar(star)}
                                onFocus={() => setHoveredStar(star)}
                                onClick={() => {
                                  setRating(star);
                                  setReportType("RATING");
                                  setStep(2);
                                }}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  cursor: "pointer",
                                  lineHeight: 0,
                                }}
                              >
                                <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3z"
                                    fill={filled ? "#f59e0b" : "transparent"}
                                    stroke="#f59e0b"
                                    strokeWidth="1.5"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            );
                          })}
                        </span>
                      </div>
                    )}

                    {step === 1 && sendFeedback && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          marginBottom: "16px",
                        }}
                      >
                        <span style={{ flex: 1, height: "1px", background: t.border }} />
                        <span style={{ fontSize: "11px", color: t.textMuted }}>
                          or report something
                        </span>
                        <span style={{ flex: 1, height: "1px", background: t.border }} />
                      </div>
                    )}

                    {/* The dialog screenshots the screen the moment it opens.
                        Saying so here — with a way out — is the honest place to
                        do it; step 2 was one screen too late to be a choice. */}
                    {step === 1 && screenshots.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          marginBottom: "14px",
                          padding: "8px 10px",
                          border: `1px solid ${t.inputBorder}`,
                          borderRadius: "8px",
                          background: t.inputBg,
                        }}
                      >
                        <img
                          src={screenshots[0]}
                          alt=""
                          style={{
                            width: "34px",
                            height: "24px",
                            objectFit: "cover",
                            borderRadius: "4px",
                            border: `1px solid ${t.border}`,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: "11px", color: t.textMuted, flex: 1 }}>
                          Screenshot attached
                        </span>
                        <button
                          type="button"
                          onClick={() => setScreenshots([])}
                          aria-label="Remove screenshot"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: t.textMuted,
                            cursor: "pointer",
                            fontSize: "15px",
                            lineHeight: 1,
                            padding: "2px 4px",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}

                    {step === 1 && (
                      <div
                        ref={tileGridRef}
                        onKeyDown={handleTileGridKeyDown}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: "10px",
                        }}
                      >
                        {availableTypes.map((type) => (
                          <button
                            key={type}
                            type="button"
                            data-gg-type={type}
                            onClick={() => {
                              setReportType(type);
                              setStep(2);
                            }}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: "9px",
                              padding: "18px 10px",
                              borderRadius: "8px",
                              border: `1px solid ${t.inputBorder}`,
                              background: t.inputBg,
                              cursor: "pointer",
                              color: t.text,
                              fontFamily: "inherit",
                            }}
                            onMouseEnter={(e) => {
                              (
                                e.currentTarget as HTMLElement
                              ).style.borderColor = t.accent;
                            }}
                            onMouseLeave={(e) => {
                              (
                                e.currentTarget as HTMLElement
                              ).style.borderColor = t.inputBorder;
                            }}
                          >
                            {getTypeIcon(type, t.accent, 22)}
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                textAlign: "center",
                                lineHeight: "1.2",
                              }}
                            >
                              {getTypeLabel(type)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Step 2: Details */}
                    {step === 2 && (
                      <>
                        {/* What you picked, still on screen and still changeable.
                            Previously step 2 said only "Tell us more", so the
                            only way to check or switch type was the Back arrow. */}
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            marginBottom: "10px",
                            padding: "4px 10px 4px 8px",
                            borderRadius: "999px",
                            border: `1px solid ${isRating ? "rgba(245,158,11,0.4)" : t.inputBorder}`,
                            background: isRating ? "rgba(245,158,11,0.1)" : t.inputBg,
                            color: t.text,
                            fontSize: "11px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          {getTypeIcon(reportType, isRating ? "#f59e0b" : t.accent, 13)}
                          {getTypeLabel(reportType)}
                          <span style={{ color: t.textMuted, fontWeight: 400 }}>· change</span>
                        </button>

                        {/* Stars carry the payload for a rating; the words below
                            them are optional, so this sits above the textarea. */}
                        {isRating && (
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              marginBottom: "12px",
                            }}
                            onMouseLeave={() => setHoveredStar(0)}
                          >
                            {[1, 2, 3, 4, 5].map((star) => {
                              const filled = star <= (hoveredStar || rating);
                              return (
                                <button
                                  key={star}
                                  type="button"
                                  aria-label={`${star} star${star > 1 ? "s" : ""}`}
                                  onClick={() => {
                                    setRating(star);
                                    if (validationError) setValidationError(null);
                                  }}
                                  onMouseEnter={() => setHoveredStar(star)}
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
                        )}
                        {/* Entry point to the AI sheet (#330). The sheet itself
                            renders in its own portal at the bottom of this
                            component, not inline: a conversation crammed into a
                            420px card read like a form field, not a chat.
                            Hidden for RATING — a star needs no help. */}
                        {assist && !isRating && !assistUsed && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssistNotice(null);
                              setAssistOpen(true);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              marginBottom: "10px",
                              // 8px vertical keeps the tap target at ~32px.
                              padding: "8px 10px",
                              borderRadius: "6px",
                              border: `1px solid ${t.accent}`,
                              background: "transparent",
                              color: t.accent,
                              fontSize: "12px",
                              fontWeight: 600,
                              fontFamily: "inherit",
                              cursor: "pointer",
                            }}
                            title="Answer a question or two and the assistant writes the report for you"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z"
                                stroke={t.accent}
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Describe it with AI
                          </button>
                        )}
                        <div style={{ position: "relative" }}>
                          <textarea
                            ref={textareaRef}
                            value={description}
                            onChange={(e) => {
                              setDescription(e.target.value);
                              if (validationError) setValidationError(null);
                              if (isEnhanced) {
                                setIsEnhanced(false);
                                setOriginalDescription(null);
                              }
                            }}
                            placeholder={
                              isTranscribing
                                ? "Transcribing your speech…"
                                : isListening
                                  ? "Listening… speak now"
                                  : getPlaceholder(reportType, placeholderIdx, !!transcribeAudio)
                            }
                            style={{
                              width: "100%",
                              minHeight: "100px",
                              padding: enhanceText
                                ? "28px 12px 36px"
                                : transcribeAudio
                                  ? "10px 12px 36px"
                                  : "10px 12px",
                              borderRadius: "8px",
                              border: `1px solid ${isTranscribing ? "#f59e0b" : isListening ? t.accent : t.inputBorder}`,
                              fontSize: "14px",
                              fontFamily: "inherit",
                              resize: "none",
                              outline: "none",
                              boxSizing: "border-box",
                              color: t.text,
                              backgroundColor: t.inputBg,
                              transition: "border-color 0.2s ease",
                            }}
                            onKeyDown={handleSpaceDown}
                            onKeyUp={handleSpaceUp}
                            onFocus={(e) => {
                              (
                                e.target as HTMLTextAreaElement
                              ).style.borderColor = t.accent;
                            }}
                            onBlur={(e) => {
                              if (!isListening && !isTranscribing)
                                (
                                  e.target as HTMLTextAreaElement
                                ).style.borderColor = t.inputBorder;
                            }}
                            autoFocus
                          />
                          {/* Bottom-left: REC / Transcribing badge (same row as mic button) */}
                          {(isListening || isTranscribing) && (
                            <span
                              style={{
                                position: "absolute",
                                bottom: "10px",
                                left: "10px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "10px",
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                color: isTranscribing ? "#f59e0b" : "#ef4444",
                                pointerEvents: "none",
                                zIndex: 1,
                              }}
                            >
                              <span
                                style={{
                                  width: "6px",
                                  height: "6px",
                                  borderRadius: "50%",
                                  backgroundColor: "currentColor",
                                  animation:
                                    "gg-pulse 1.2s ease-in-out infinite",
                                  display: "inline-block",
                                  flexShrink: 0,
                                }}
                              />
                              {isTranscribing ? "Transcribing…" : "REC"}
                              {isListening && !isTranscribing && (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "flex-end",
                                    gap: "2px",
                                    height: "14px",
                                    marginLeft: "3px",
                                  }}
                                >
                                  {[
                                    { anim: "gg-b1", dur: "0.6s", delay: "0s" },
                                    {
                                      anim: "gg-b2",
                                      dur: "0.5s",
                                      delay: "0.1s",
                                    },
                                    {
                                      anim: "gg-b3",
                                      dur: "0.7s",
                                      delay: "0.05s",
                                    },
                                    {
                                      anim: "gg-b4",
                                      dur: "0.55s",
                                      delay: "0.15s",
                                    },
                                  ].map((b, i) => (
                                    <span
                                      key={i}
                                      style={{
                                        width: "2.5px",
                                        height: "4px",
                                        borderRadius: "1px",
                                        backgroundColor: "#ef4444",
                                        animation: `${b.anim} ${b.dur} ease-in-out ${b.delay} infinite`,
                                        display: "inline-block",
                                        alignSelf: "center",
                                      }}
                                    />
                                  ))}
                                </span>
                              )}
                            </span>
                          )}
                          {/* Top-right: AI enhance */}
                          {enhanceText && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!description.trim() || isEnhancing) return;
                                setIsEnhancing(true);
                                try {
                                  const polished = await enhanceText(
                                    description,
                                    screenshots[0] ?? null,
                                  );
                                  if (polished && polished !== description) {
                                    setOriginalDescription(description);
                                    setDescription(polished);
                                    setIsEnhanced(true);
                                    if (validationError)
                                      setValidationError(null);
                                  }
                                } finally {
                                  setIsEnhancing(false);
                                }
                              }}
                              disabled={
                                !description.trim() || isEnhancing || isEnhanced
                              }
                              style={{
                                position: "absolute",
                                top: "6px",
                                right: "6px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                background: t.inputBg,
                                border: "none",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontFamily: "inherit",
                                fontSize: "11px",
                                color: t.textMuted,
                                cursor:
                                  !description.trim() || isEnhancing
                                    ? "default"
                                    : "pointer",
                                opacity: !description.trim() ? 0.5 : 1,
                                zIndex: 1,
                              }}
                              title="Polish grammar — preserves your meaning"
                            >
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden="true"
                              >
                                <path
                                  d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z"
                                  stroke={t.textMuted}
                                  strokeWidth="1.5"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              {isEnhancing ? "Enhancing..." : "AI enhance"}
                            </button>
                          )}
                          {/* Bottom-right: mic icon only, outlined */}
                          {transcribeAudio && (
                            <button
                              type="button"
                              onClick={() => {
                                void toggleVoice();
                              }}
                              title={
                                isListening
                                  ? "Stop recording"
                                  : "Speak your report"
                              }
                              style={{
                                position: "absolute",
                                bottom: "14px",
                                right: "7px",
                                width: "26px",
                                height: "26px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "transparent",
                                border: `1.5px solid ${isListening ? "#ef4444" : t.inputBorder}`,
                                borderRadius: "6px",
                                color: isListening ? "#ef4444" : t.textMuted,
                                cursor: "pointer",
                                zIndex: 1,
                                padding: 0,
                                transition:
                                  "border-color 0.2s ease, color 0.2s ease",
                              }}
                            >
                              {isListening ? (
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <rect
                                    x="6"
                                    y="6"
                                    width="12"
                                    height="12"
                                    rx="2"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <rect
                                    x="9"
                                    y="2"
                                    width="6"
                                    height="12"
                                    rx="3"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                  />
                                  <path
                                    d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                        {transcribeAudio && !isListening && !isTranscribing && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "5px",
                              marginTop: "5px",
                              fontSize: "11px",
                              color: t.text,
                              opacity: 0.55,
                              userSelect: "none",
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                              <line x1="12" x2="12" y1="19" y2="22"/>
                            </svg>
                            Hold Space to speak — we&apos;ll transcribe it
                          </div>
                        )}
                        {isEnhanced && originalDescription !== null && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              marginTop: "6px",
                              padding: "6px 8px",
                              borderRadius: "6px",
                              background: isDark
                                ? "rgba(34,211,238,0.06)"
                                : "rgba(8,145,178,0.05)",
                              border: `1px solid ${t.accent}40`,
                            }}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              style={{ flexShrink: 0 }}
                            >
                              <path
                                d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"
                                stroke={t.accent}
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span
                              style={{
                                fontSize: "11px",
                                color: t.textMuted,
                                flex: 1,
                              }}
                            >
                              AI enhanced
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setIsEnhanced(false);
                                setOriginalDescription(null);
                              }}
                              style={{
                                padding: "2px 8px",
                                borderRadius: "4px",
                                border: `1px solid ${t.accent}`,
                                background: t.accent,
                                color: t.accentText,
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDescription(originalDescription);
                                setIsEnhanced(false);
                                setOriginalDescription(null);
                              }}
                              style={{
                                padding: "2px 8px",
                                borderRadius: "4px",
                                border: `1px solid ${t.inputBorder}`,
                                background: "transparent",
                                color: t.textMuted,
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              Restore
                            </button>
                          </div>
                        )}
                        {voiceError && (
                          <p
                            style={{
                              color: "#ef4444",
                              fontSize: "11px",
                              marginTop: "4px",
                              marginBottom: 0,
                            }}
                          >
                            {voiceError}
                          </p>
                        )}

                        {/* Why the assistant went away — a draft it wrote, a
                            cap it hit, or a model that was down. Sits directly
                            under the box it is talking about: a notice about
                            the description that renders below Severity reads as
                            being about Severity. */}
                        {assistNotice && (
                          <p
                            style={{
                              color: t.textMuted,
                              fontSize: "12px",
                              marginTop: "6px",
                              marginBottom: 0,
                              lineHeight: 1.5,
                            }}
                          >
                            {assistNotice}
                          </p>
                        )}

                        {/* Screenshot section — hidden for a rating. The dialog
                            auto-captures the screen on open, and a testimonial
                            has no reason to ship one (it may even be published
                            publicly later). handleSubmit's rating branch never
                            reads `screenshots`, so nothing leaks either way. */}
                        {!isRating && (
                        <div style={{ marginTop: "10px" }}>
                          <span
                            style={{
                              fontSize: "12px",
                              color: t.textMuted,
                              marginBottom: "6px",
                              display: "block",
                              fontWeight: 500,
                            }}
                          >
                            Attachments
                            {screenshots.length + attachments.length > 0
                              ? ` (${screenshots.length + attachments.length})`
                              : ""}
                          </span>
                          {screenshots.length > 0 && (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "8px",
                                marginBottom: "8px",
                              }}
                            >
                              {screenshots.map((src, i) => (
                                <div
                                  key={i}
                                  style={{
                                    position: "relative",
                                    width: "56px",
                                    height: "56px",
                                  }}
                                >
                                  <img
                                    src={src}
                                    alt={`Screenshot ${i + 1}`}
                                    onClick={() => openPreview(i)}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      borderRadius: "6px",
                                      border: `1px solid ${t.border}`,
                                      objectFit: "cover",
                                      objectPosition: "top",
                                      cursor: "zoom-in",
                                      display: "block",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setScreenshots((prev) =>
                                        prev.filter((_, idx) => idx !== i),
                                      )
                                    }
                                    aria-label={`Remove screenshot ${i + 1}`}
                                    style={{
                                      position: "absolute",
                                      top: "-6px",
                                      right: "-6px",
                                      width: "17px",
                                      height: "17px",
                                      borderRadius: "50%",
                                      border: "none",
                                      background: "#ef4444",
                                      color: "#fff",
                                      fontSize: "11px",
                                      lineHeight: 1,
                                      padding: 0,
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    <svg
                                      width="8"
                                      height="8"
                                      viewBox="0 0 10 10"
                                      fill="none"
                                    >
                                      <path
                                        d="M1 1L9 9M9 1L1 9"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAnnotatingIndex(i)}
                                    aria-label={`Annotate screenshot ${i + 1}`}
                                    title="Annotate"
                                    style={{
                                      position: "absolute",
                                      top: "50%",
                                      left: "50%",
                                      transform: "translate(-50%, -50%)",
                                      width: "24px",
                                      height: "24px",
                                      borderRadius: "50%",
                                      border: "none",
                                      background: t.accent,
                                      color: t.accentText,
                                      padding: 0,
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                                    }}
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                    >
                                      <path
                                        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {attachments.length > 0 && (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                marginBottom: "8px",
                              }}
                            >
                              {attachments.map((a, i) => (
                                <div
                                  key={i}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "6px 8px",
                                    borderRadius: "6px",
                                    border: `1px solid ${t.border}`,
                                  }}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    style={{ flexShrink: 0, opacity: 0.6 }}
                                  >
                                    <path
                                      d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                                      stroke={t.textMuted}
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M14 2v6h6"
                                      stroke={t.textMuted}
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      color: t.text,
                                      flex: 1,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {a.name}
                                  </span>
                                  <span
                                    style={{ fontSize: "10px", color: t.textMuted }}
                                  >
                                    {(a.size / 1024).toFixed(0)}KB
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAttachments((prev) =>
                                        prev.filter((_, idx) => idx !== i),
                                      )
                                    }
                                    aria-label={`Remove ${a.name}`}
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      borderRadius: "50%",
                                      border: "none",
                                      background: "#ef4444",
                                      color: "#fff",
                                      fontSize: "10px",
                                      lineHeight: 1,
                                      padding: 0,
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <svg
                                      width="8"
                                      height="8"
                                      viewBox="0 0 10 10"
                                      fill="none"
                                    >
                                      <path
                                        d="M1 1L9 9M9 1L1 9"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Drop zone — always available to add more */}
                          <div
                            onClick={() => fileInputRef.current?.click()}
                            onDrop={(e) => {
                              e.preventDefault();
                              setScreenshotDragOver(false);
                              addFiles(Array.from(e.dataTransfer.files));
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setScreenshotDragOver(true);
                            }}
                            onDragLeave={() => setScreenshotDragOver(false)}
                            style={{
                              border: `1.5px dashed ${screenshotDragOver ? t.accent : t.inputBorder}`,
                              borderRadius: "8px",
                              padding:
                                screenshots.length + attachments.length > 0
                                  ? "8px 12px"
                                  : "18px 12px",
                              textAlign: "center",
                              cursor: "pointer",
                              background: screenshotDragOver
                                ? isDark
                                  ? "rgba(34,211,238,0.06)"
                                  : "rgba(8,145,178,0.04)"
                                : "transparent",
                              transition:
                                "border-color 0.15s ease, background 0.15s ease",
                            }}
                          >
                            {screenshots.length + attachments.length > 0 ? (
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: "11px",
                                  fontWeight: 500,
                                  color: t.textMuted,
                                }}
                              >
                                {screenshotDragOver
                                  ? "Drop to attach"
                                  : "+ Add more · Drag & drop · Paste"}
                              </p>
                            ) : (
                              <>
                                <svg
                                  width="22"
                                  height="22"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  style={{
                                    margin: "0 auto 6px",
                                    display: "block",
                                    opacity: 0.45,
                                  }}
                                >
                                  <rect
                                    x="3"
                                    y="3"
                                    width="18"
                                    height="18"
                                    rx="2"
                                    stroke={t.textMuted}
                                    strokeWidth="1.5"
                                  />
                                  <circle
                                    cx="8.5"
                                    cy="8.5"
                                    r="1.5"
                                    stroke={t.textMuted}
                                    strokeWidth="1.5"
                                  />
                                  <path
                                    d="M21 15l-5-5L5 21"
                                    stroke={t.textMuted}
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    color: t.text,
                                  }}
                                >
                                  {screenshotDragOver
                                    ? "Drop to attach"
                                    : "Add screenshots or files"}
                                </p>
                                <p
                                  style={{
                                    margin: "3px 0 0",
                                    fontSize: "11px",
                                    color: t.textMuted,
                                  }}
                                >
                                  Images, PDF, DOC, XLS · Drag & drop · Paste
                                  ⌘V / Ctrl+V · Click to browse
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                        )}

                        {showSeverity && reportType === "BUG" && (
                          <div style={{ marginTop: "10px" }}>
                            <span
                              style={{
                                fontSize: "12px",
                                color: t.textMuted,
                                marginBottom: "6px",
                                display: "block",
                              }}
                            >
                              Severity
                            </span>
                            <div style={{ display: "flex", gap: "6px" }}>
                              {(
                                ["low", "medium", "high"] as ReportSeverity[]
                              ).map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => setSeverity(s)}
                                  style={{
                                    flex: 1,
                                    padding: "6px 0",
                                    borderRadius: "6px",
                                    border: `1px solid ${severity === s ? t.accent : t.inputBorder}`,
                                    background:
                                      severity === s ? t.accent : "transparent",
                                    color:
                                      severity === s ? t.accentText : t.text,
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    textTransform: "capitalize",
                                    transition: "all 0.15s ease",
                                  }}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {validationError && (
                          <p
                            style={{
                              color: "#ef4444",
                              fontSize: "12px",
                              marginTop: "6px",
                            }}
                          >
                            {validationError}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={handleSubmit}
                          disabled={submitDisabled}
                          style={{
                            marginTop: "12px",
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: "none",
                            backgroundColor: submitDisabled
                              ? t.bgSecondary
                              : t.accent,
                            color: submitDisabled ? t.textMuted : t.accentText,
                            fontSize: "14px",
                            fontWeight: 600,
                            cursor: submitDisabled ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            transition: "background-color 0.15s ease",
                          }}
                        >
                          {isSubmitting
                            ? "Sending..."
                            : isRating
                              ? "Send Rating"
                              : "Send Report"}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Footer — who's reporting, and the attribution */}
              <div
                style={{
                  padding: "8px 16px 10px",
                  borderTop: `1px solid ${t.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <ReporterChip reporter={reporter} t={t} />
                <span
                  style={{
                    fontSize: "11px",
                    color: t.textMuted,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Powered by Glitchgrab
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        onChange={handleFileUpload}
        style={{ display: "none" }}
      />

      {/* Full-screen screenshot preview */}
      {isOpen &&
        previewIndex !== null &&
        screenshots[previewIndex] &&
        createPortal(
          <div
            data-glitchgrab-layer=""
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2147483647,
              backgroundColor: "rgba(0,0,0,0.85)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              cursor: "pointer",
            }}
            onClick={(e) => {
              e.stopPropagation();
              closePreview();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              ref={previewImgRef}
              style={{
                position: "relative",
                display: "flex",
                maxWidth: "100%",
                maxHeight: "calc(100vh - 80px)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                ref={previewScrollRef}
                onPointerDown={handlePanStart}
                onPointerMove={handlePanMove}
                onPointerUp={handlePanEnd}
                onPointerCancel={handlePanEnd}
                onClick={togglePreviewZoom}
                style={
                  previewZoomed
                    ? {
                        // Fill the overlay so there is room to pan around a
                        // full-resolution screenshot.
                        width: "calc(100vw - 32px)",
                        height: "calc(100vh - 80px)",
                        overflow: "auto",
                        borderRadius: "8px",
                        touchAction: "none",
                        cursor: "grab",
                      }
                    : { maxWidth: "100%", lineHeight: 0 }
                }
              >
                <img
                  ref={previewImgElRef}
                  src={screenshots[previewIndex]}
                  alt="Screenshot preview"
                  onLoad={(e) =>
                    setPreviewNatural({
                      w: e.currentTarget.naturalWidth,
                      h: e.currentTarget.naturalHeight,
                    })
                  }
                  style={
                    previewZoomed
                      ? {
                          // Natural size — one image pixel per CSS pixel.
                          maxWidth: "none",
                          maxHeight: "none",
                          display: "block",
                          cursor: "zoom-out",
                        }
                      : {
                          maxWidth: "100%",
                          maxHeight: "calc(100vh - 80px)",
                          borderRadius: "8px",
                          objectFit: "contain",
                          cursor: canZoomPreview ? "zoom-in" : "default",
                          display: "block",
                        }
                  }
                />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAnnotatingIndex(previewIndex);
                }}
                style={{
                  position: "absolute",
                  top: "12px",
                  right: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "999px",
                  border: "none",
                  background: t.accent,
                  color: t.accentText,
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
                  animation: "gg-pulse 2s ease-in-out infinite",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Annotate
              </button>
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <span
                style={{
                  color: t.textMuted,
                  fontSize: "12px",
                }}
              >
                {[
                  screenshots.length > 1
                    ? `${previewIndex + 1} / ${screenshots.length}`
                    : null,
                  canZoomPreview
                    ? previewZoomed
                      ? "Drag to pan · click image to fit"
                      : "Click image to zoom to full size"
                    : null,
                  previewZoomed ? "Esc to fit" : "Click outside to close",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>,
          document.body,
        )}

      {/* Annotation overlay */}
      {isOpen &&
        annotatingIndex !== null &&
        screenshots[annotatingIndex] &&
        createPortal(
          <AnnotationCanvas
            imageSrc={screenshots[annotatingIndex]}
            onCancel={() => setAnnotatingIndex(null)}
            onSave={(dataUrl) => {
              setScreenshots((prev) =>
                prev.map((s, i) => (i === annotatingIndex ? dataUrl : s)),
              );
              setAnnotatingIndex(null);
            }}
          />,
          document.body,
        )}

      {/* The AI sheet (#330) — its own layer, above the dialog. It owns the
          whole flow (chat → draft → Send) but NOT submission: `description`,
          `severity` and `handleSubmit` are this component's own, so there is
          exactly one submit path and the sheet cannot drift from it. */}
      {isOpen && sheetUp && (
        <AssistSheet
          assist={assist}
          theme={{
            bg: t.bg,
            bgSecondary: t.bgSecondary,
            border: t.border,
            text: t.text,
            textMuted: t.textMuted,
            inputBg: t.inputBg,
            inputBorder: t.inputBorder,
            accent: t.accent,
            accentText: t.accentText,
          }}
          screenshot={screenshots[0] ?? null}
          attachmentCount={screenshots.length + attachments.length}
          context={{ ...(assistContext ?? {}), reportType }}
          reportTypeLabel={getTypeLabel(reportType)}
          projectSlot={headerSlot}
          reporterName={reporter?.name ?? null}
          description={description}
          onDescriptionChange={(value) => {
            setDescription(value);
            if (validationError) setValidationError(null);
          }}
          severity={severity}
          onSeverityChange={setSeverity}
          showSeverity={showSeverity}
          isSubmitting={isSubmitting}
          submitted={submitted}
          onSend={() => void handleSubmit()}
          onDegrade={(message) => {
            setAssistOpen(false);
            setAssistUsed(true);
            setAssistNotice(message);
          }}
          onClose={() => {
            setAssistOpen(false);
            // Closing by hand is not "used up" — someone who peeked and backed
            // out should still find the button where they left it. Only a
            // degrade (cap, outage) retires the assistant for this report.
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
      )}
    </>
  );
}

/* ─── Helpers ─── */

function getTypeLabel(type: DialogTile): string {
  switch (type) {
    case "RATING":
      return "Rating";
    case "BUG":
      return "Bug Report";
    case "FEATURE_REQUEST":
      return "Feature Request";
    case "UI_IMPROVEMENT":
      return "UI Improvement";
    case "PERFORMANCE":
      return "Performance";
    case "SECURITY":
      return "Security";
    case "QUESTION":
      return "Question";
    case "OTHER":
      return "Other";
  }
}

function getPlaceholder(type: DialogTile, idx = 0, hasVoice = false): string {
  if (type === "RATING") return "What made it good — or what let you down? (optional)";
  if (hasVoice && idx === 1) return "Hold Space to speak — we'll transcribe it";
  switch (type) {
    case "BUG":
      return "What went wrong? Describe it or paste an error...";
    case "FEATURE_REQUEST":
      return "Describe the feature you'd like...";
    case "UI_IMPROVEMENT":
      return "What looks off? Describe the visual issue...";
    case "PERFORMANCE":
      return "What's slow? Describe when it happens...";
    case "SECURITY":
      return "Describe the security concern...";
    case "QUESTION":
      return "What would you like to know?";
    case "OTHER":
      return "Tell us what's on your mind...";
  }
}

function getTypeIcon(type: DialogTile, color: string, size = 24): ReactNode {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    style: { flexShrink: 0 } as CSSProperties,
  };
  switch (type) {
    case "RATING":
      return (
        <svg {...props}>
          <path
            d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3z"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "BUG":
      return (
        <svg {...props}>
          <path
            d="M8 2L6.5 3.5M16 2L17.5 3.5M3 9H7M17 9H21M12 2a5 5 0 015 5v4a5 5 0 01-10 0V7a5 5 0 015-5zM7 16l-2 3M17 16l2 3"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "FEATURE_REQUEST":
      return (
        <svg {...props}>
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "UI_IMPROVEMENT":
      return (
        <svg {...props}>
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="2"
            stroke={color}
            strokeWidth="1.5"
          />
          <path
            d="M3 9h18M9 21V9"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "PERFORMANCE":
      return (
        <svg {...props}>
          <path
            d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 12l4-4M12 7v.01"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "SECURITY":
      return (
        <svg {...props}>
          <path
            d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "QUESTION":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
          <path
            d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "OTHER":
      return (
        <svg {...props}>
          <path
            d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
