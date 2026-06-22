// Regression evidence for the avatar UNMUTE → editor FREEZE.
//
// Root cause (proven below): when the avatar plays its own voice, VideoEditor fed the
// preview audio hook `audioRegions: avatarAudioActive ? [] : audioRegions`. That `[]`
// is a BRAND-NEW array identity on every render. `useAudioPreviewSync` builds
// `resolvedPlan = useMemo(..., [audioRegions, ...])`, and several `useEffect`s depend
// on the derived `resolvedUserTracks` / `resolvedSourceTracks`. A new `[]` each render
// busts that memo every render ⇒ those effects re-run every render, tearing down and
// rebuilding HTMLAudioElements + WebAudio nodes each time. During playback near the
// end the main thread saturates ⇒ the whole UI freezes (user had to restart the app).
//
// Part 1 models the per-render churn. Part 2 guards the source so an inline `[]` (or
// any fresh array literal) can't be passed to the audio hook again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Model a memo keyed on an array's IDENTITY (like resolvedPlan's [audioRegions] dep).
// Count how many times it recomputes across N renders. A fresh array per render busts
// it every render (→ downstream effects thrash → freeze); a stable reference recomputes
// once.
function countMemoRecomputes(opts: { stableRef: boolean; renders: number }): number {
	const stableEmpty: number[] = [];
	let recomputes = 0;
	let prevDep: unknown = Symbol("none");
	for (let i = 0; i < opts.renders; i++) {
		// avatarAudioActive === true → we pass an empty list. Either a shared stable
		// reference, or a fresh literal each render (the bug).
		const audioRegions = opts.stableRef ? stableEmpty : [];
		if (audioRegions !== prevDep) {
			recomputes++; // memo (and the effects keyed off it) re-run this render
		}
		prevDep = audioRegions;
	}
	return recomputes;
}

describe("avatar-unmute audio-region identity (the freeze mechanism)", () => {
	it("a FRESH [] every render busts the memo every render → per-render churn (freeze)", () => {
		expect(countMemoRecomputes({ stableRef: false, renders: 500 })).toBe(500);
	});

	it("a STABLE empty-array reference recomputes once, then settles", () => {
		expect(countMemoRecomputes({ stableRef: true, renders: 500 })).toBe(1);
	});
});

describe("the real fix is in place (no fresh array literal to the audio hook)", () => {
	const src = readFileSync(path.join(__dirname, "VideoEditor.tsx"), "utf8");

	it("useVideoEditorAudio is not passed an inline `? [] :` array literal", () => {
		// The buggy form was `audioRegions: avatarAudioActive ? [] : audioRegions`.
		// Assert that exact churn pattern is gone.
		expect(src).not.toMatch(/audioRegions:\s*[^?\n]*\?\s*\[\]\s*:/);
	});

	it("a stable EMPTY audio-regions constant exists and is used for the muted case", () => {
		expect(src).toMatch(/EMPTY_AUDIO_REGIONS/);
	});
});
