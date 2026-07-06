// Regression evidence for "narration comes back muted after starting a new
// recording, happens again and again."
//
// Root cause: `narrationMuted` (VideoEditor.tsx) is a per-recording toggle —
// but resetSourceScopedEditorState(), which clears every OTHER per-recording
// piece of state (audioRegions, zoomRegions, avatarOverlay, ...) when a new
// source/recording is opened, never reset it. So muting narration in one
// project silently carried into the NEXT one: the old (muted) narration
// region was correctly cleared, but the mute FLAG survived and applied to
// whatever narration was added to the new project — with zero indication why.
//
// VideoEditor.tsx is a single giant stateful component with no test harness
// for mounting it — like avatarAudioRegionStability.test.ts and
// avatarRemoveButton.test.ts, this asserts the source-level invariant that the
// reset function actually clears the flag.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "VideoEditor.tsx"), "utf8");

describe("narration mute is reset per-recording (not carried across projects)", () => {
	it("resetSourceScopedEditorState clears narrationMuted alongside the other per-recording state", () => {
		const start = src.indexOf("const resetSourceScopedEditorState = useCallback(() => {");
		expect(start).toBeGreaterThan(-1);
		// Grab the function body up to its closing `}, [` (useCallback's deps array).
		const end = src.indexOf("\n\t}, [", start);
		expect(end).toBeGreaterThan(start);
		const body = src.slice(start, end);

		expect(body).toContain("setAudioRegions([]);"); // sanity: right function
		expect(body).toContain("setNarrationMuted(false);");
	});
});
