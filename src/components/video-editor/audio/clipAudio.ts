import { getClipSourceSpans } from "../types";
import type { ClipRegion } from "../types";

export function getActiveClipIdAtSourceTime(
  sourceTimeSeconds: number,
  clipRegions: ClipRegion[],
): string | null {
  const sourceMs = Math.round(sourceTimeSeconds * 1000);
  const activeSpan = getClipSourceSpans(clipRegions).find(
    (span) => sourceMs >= span.sourceStartMs && sourceMs < span.sourceEndMs,
  );
  return activeSpan?.clip.id ?? null;
}

export function isClipMutedById(clipId: string | null, clipRegions: ClipRegion[]): boolean {
  if (!clipId) return false;
  return clipRegions.find((clip) => clip.id === clipId)?.muted ?? false;
}
