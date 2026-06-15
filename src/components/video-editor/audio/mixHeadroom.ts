// Preview mix headroom.
//
// The editor preview plays narration + source/companion + embedded video audio as
// independent HTMLAudioElements that sum at the DEVICE output. Each is individually
// clamped to ≤ 1.0, but two near-full-scale sources sum past ±1.0 and the device
// HARD-CLIPS → audible "speaker tearing." (Export avoids this with an offline soft
// limiter; preview can't post-sum limit because routing through Web Audio breaks
// pitch preservation, so we apply pre-sum headroom instead.)
//
// computeMixHeadroom returns a single multiplier to apply to EVERY active preview
// source so their summed peak can't exceed the ceiling — proportional, so the mix
// balance between sources is preserved (same as export, just clip-free).

// The device hard-clips when the SUMMED peak exceeds 1.0, so that's the target.
// A single full-scale source (e.g. narration alone) sits at the edge and is fine —
// only sums past 1.0 get pulled back, so a lone narration keeps its full volume.
export const PREVIEW_MIX_CEILING = 1.0;

/**
 * @param gains  the per-source preview gains active at the same moment (narration
 *               tracks, source/companion tracks, embedded video) — each already in [0,1].
 * @param ceiling the max allowed summed peak (default {@link PREVIEW_MIX_CEILING}).
 * @returns a multiplier in (0,1] s.t. `sum(gains) * multiplier <= ceiling`. Returns
 *          1 when the sources already fit (no needless attenuation).
 */
export function computeMixHeadroom(gains: number[], ceiling: number = PREVIEW_MIX_CEILING): number {
	const total = gains.reduce((sum, g) => sum + Math.max(0, g), 0);
	if (total <= ceiling || total === 0) return 1;
	return ceiling / total;
}
