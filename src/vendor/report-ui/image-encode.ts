// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
/**
 * Screenshot encoding shared by the capture path and the annotation editor.
 *
 * Screenshots travel to `/api/v1/sdk/report` as base64 inside a JSON body, so
 * every extra pixel is billed against the serverless request-body limit
 * (~4.5 MB on Vercel). We want the sharpest image that still leaves room for a
 * second screenshot plus the rest of the payload, so encode at high quality
 * first and only step down when the result overshoots the budget.
 */

/** Max length of a single screenshot data URL. Two of these still fit in one request. */
export const MAX_SCREENSHOT_DATA_URL_LENGTH = 1_800_000;

/** Tried in order — the first one under budget wins. */
const QUALITY_LADDER = [0.92, 0.85, 0.75] as const;

/** Last resort when even q0.75 overshoots: redraw at this factor, then re-run the ladder. */
const DOWNSCALE_FACTOR = 0.7;

function downscale(
  canvas: HTMLCanvasElement,
  factor: number,
): HTMLCanvasElement | null {
  const next = document.createElement("canvas");
  next.width = Math.max(1, Math.round(canvas.width * factor));
  next.height = Math.max(1, Math.round(canvas.height * factor));
  const ctx = next.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, next.width, next.height);
  return next;
}

/**
 * JPEG-encode a canvas at the highest quality that fits the payload budget.
 * Resolution is preserved unless every quality step overshoots — losing pixels
 * is what made screenshots unreadable, so it is the last thing we give up.
 */
export function encodeScreenshot(
  canvas: HTMLCanvasElement,
  maxLength = MAX_SCREENSHOT_DATA_URL_LENGTH,
): string {
  let current = canvas;

  // Two rounds: full resolution, then one downscale if nothing fit.
  for (let round = 0; round < 2; round++) {
    let encoded = "";
    for (const quality of QUALITY_LADDER) {
      encoded = current.toDataURL("image/jpeg", quality);
      if (encoded.length <= maxLength) return encoded;
    }
    if (round === 1) return encoded;
    const smaller = downscale(current, DOWNSCALE_FACTOR);
    if (!smaller) return encoded;
    current = smaller;
  }

  return current.toDataURL("image/jpeg", QUALITY_LADDER[0]);
}
