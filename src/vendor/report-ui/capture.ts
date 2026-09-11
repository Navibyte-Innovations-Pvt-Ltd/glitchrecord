// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
/**
 * Default screenshot capture for hosts that embed the dialog in the page being
 * reported (the SDK). Standalone hosts inject their own — see
 * `ReportDialogProps.captureScreenshot`.
 *
 * html2canvas does not photograph the page, it re-draws it from computed CSS,
 * and that re-draw drifts from what the reporter actually sees: in one
 * production report every border fell back to Tailwind's preflight
 * `border: 0 solid` (solid, currentColor), so a dark dashboard came out ringed
 * in white and a dashed box came out solid. A screenshot that disagrees with
 * the screen is worse than none — the developer ends up debugging the capture.
 *
 * So where the browser can hand over the tab's real pixels, take those, and
 * keep html2canvas as the fallback for everywhere it can't.
 */

import { encodeScreenshot } from "./image-encode";

/** Capture at the display's own density, capped — beyond 2× the payload grows faster than the legibility. */
const MAX_SCALE = 2;

/** A frame that never arrives must not hold the dialog closed. */
const FRAME_TIMEOUT_MS = 3000;

/**
 * Chromium-only members of the `getDisplayMedia` options. Not in lib.dom yet;
 * other engines ignore unknown keys, so passing them is harmless.
 */
type TabCaptureOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
};

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

/**
 * Only Chromium offers "this tab" as a one-click Allow. Safari and Firefox
 * would open a full screen/window picker instead — a worse experience than the
 * re-draw, and one that invites sharing the whole desktop — so they go straight
 * to html2canvas. `CaptureController` ships only in Chromium, which makes it a
 * stand-in for "honours preferCurrentTab" without sniffing the user agent.
 */
export function canCaptureTabPixels(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
      typeof (globalThis as { CaptureController?: unknown }).CaptureController !== "undefined"
    );
  } catch {
    return false;
  }
}

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — a frame is decoded and drawable. */
const HAVE_CURRENT_DATA = 2;

/** Resolves true once a frame is decoded, false if none arrived in time. */
function waitForFrame(video: FrameCallbackVideo): Promise<boolean> {
  // play() usually resolves with the first frame already decoded — use it.
  // Waiting for the *next* one stalls: tab capture only emits a frame when the
  // page repaints, so on a page that isn't moving it may never come (measured:
  // a static page sat out the full timeout at 1× and fell back every time).
  if (video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), FRAME_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(done);
    } else if (video.readyState >= 2) {
      done();
    } else {
      video.addEventListener("loadeddata", done, { once: true });
    }
  });
}

async function grabFrame(stream: MediaStream): Promise<HTMLCanvasElement | null> {
  const video = document.createElement("video") as FrameCallbackVideo;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    if (!(await waitForFrame(video))) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    const maxWidth = Math.max(1, window.innerWidth) * MAX_SCALE;
    const factor = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * factor);
    canvas.height = Math.round(video.videoHeight * factor);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    video.srcObject = null;
  }
}

/**
 * The tab's real pixels via `getDisplayMedia({ preferCurrentTab })`.
 *
 * Chrome asks "Allow this site to see this tab?" on every call — that prompt is
 * the price of an exact image. Must be called inside the click (or keypress)
 * that opened the dialog: the browser refuses without a user gesture, which is
 * why the dialog captures before its first await.
 *
 * Returns null — never throws — on a refusal, an unsupported browser, a
 * missing `display-capture` permission policy, or anything other than a tab.
 */
export async function captureViaTabPixels(): Promise<string | null> {
  if (!canCaptureTabPixels()) return null;

  let stream: MediaStream | null = null;
  try {
    const options: TabCaptureOptions = {
      video: { displaySurface: "browser" } as MediaTrackConstraints,
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "exclude",
    };
    stream = await navigator.mediaDevices.getDisplayMedia(options);

    // The picker can still offer a window or a whole screen. This image goes to
    // the host app's issue tracker, so anything beyond the host's own tab —
    // another app, a password manager, a chat — must never be encoded.
    const surface = (
      stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined
    )?.displaySurface;
    if (surface && surface !== "browser") return null;

    const canvas = await grabFrame(stream);
    return canvas ? encodeScreenshot(canvas) : null;
  } catch {
    return null;
  } finally {
    // Stop at once — the "sharing this tab" indicator should last as long as
    // one frame takes, not as long as the dialog stays open.
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/** Re-draw the viewport from the DOM. Needs no permission; not always faithful. */
export async function captureViaHtml2Canvas(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import("html2canvas-pro");
    const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_SCALE);
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
 * Real pixels first, the re-draw when those aren't available. A refused prompt
 * still yields a screenshot — the reporter said no to screen sharing, not to
 * filing the report.
 */
export async function captureDefaultScreenshot(): Promise<string | null> {
  return (await captureViaTabPixels()) ?? (await captureViaHtml2Canvas());
}
