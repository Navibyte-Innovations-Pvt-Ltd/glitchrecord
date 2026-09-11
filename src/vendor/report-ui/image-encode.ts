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

/** When even q0.75 overshoots: redraw at this factor, then re-run the ladder. */
const DOWNSCALE_FACTOR = 0.7;

/**
 * Full resolution plus three downscales (0.7, 0.49, 0.34). One downscale used
 * to be the limit, and an image still over budget after it was returned over
 * budget — the cap was advisory for exactly the images it existed for.
 */
const MAX_ROUNDS = 4;

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
  let encoded = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (const quality of QUALITY_LADDER) {
      encoded = current.toDataURL("image/jpeg", quality);
      if (encoded.length <= maxLength) return encoded;
    }
    if (round === MAX_ROUNDS - 1) break;
    const smaller = downscale(current, DOWNSCALE_FACTOR);
    if (!smaller) break;
    current = smaller;
  }

  // Nothing fit. The smallest attempt beats no image; the sheet's total budget
  // decides whether it rides along.
  return encoded;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function reencodeImageFile(file: File, maxLength: number): Promise<string | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // JPEG has no alpha channel — transparent pixels would come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    return encodeScreenshot(canvas, maxLength);
  } finally {
    bitmap.close?.();
  }
}

/**
 * An image the reporter attached or pasted, as a data URL held to the same
 * budget as a captured screenshot.
 *
 * These used to ride along exactly as read off disk. A retina PNG from the
 * clipboard is routinely 5–10 MB — over the request-body limit on its own — so
 * Vercel refused the assistant turn at the edge with a 413 before the route
 * ran: no log, no degrade message from the server, the sheet just closed.
 *
 * A file already under budget passes through untouched, so a small PNG crop
 * stays a sharp PNG. Anything that cannot be decoded here (no
 * `createImageBitmap`, a format the browser can't draw) comes back raw; the
 * sheet's total budget is the backstop for those.
 */
export async function encodeImageFile(
  file: File,
  maxLength = MAX_SCREENSHOT_DATA_URL_LENGTH,
): Promise<string> {
  // A data URL is base64 (4 chars per 3 bytes) behind a short `data:…;base64,`
  // prefix, so the size is known before reading a byte.
  const rawLength = Math.ceil(file.size / 3) * 4 + 64;
  if (rawLength > maxLength) {
    try {
      const shrunk = await reencodeImageFile(file, maxLength);
      if (shrunk && shrunk.length < rawLength) return shrunk;
    } catch {
      // Fall through to the raw file — an unreadable image is still evidence.
    }
  }
  return readAsDataUrl(file);
}
