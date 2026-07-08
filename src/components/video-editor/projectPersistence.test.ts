import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";

// Regression: normalizeProjectEditor rebuilds clipRegions/audioRegions field-by-
// field from the saved JSON (not via spread), so any field added to the shape
// AFTER this function was written gets silently dropped on reload unless it's
// explicitly picked here. Two fields have hit this so far:
//  - ClipRegion.sourceStartMs — the ripple-delete/playback-mapping fix; losing
//    it on reload reintroduces the "delete shows gone, plays wrong footage" bug.
//  - AudioRegion.isNarration — losing it hides the narration mute toggle
//    (SettingsPanel gates it on this flag) after a project is saved + reopened.
describe("normalizeProjectEditor — round-trips fields added after initial shape", () => {
	it("preserves ClipRegion.sourceStartMs through save/reload", () => {
		const normalized = normalizeProjectEditor({
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 6_000, speed: 1 },
				{ id: "b", startMs: 6_000, endMs: 12_000, speed: 1, sourceStartMs: 14_014 },
			],
		});
		expect(normalized.clipRegions.find((c) => c.id === "b")?.sourceStartMs).toBe(14_014);
		// A clip that never had the field stays without it (falls back to startMs
		// wherever it's read) — normalizeProjectEditor must not invent a value.
		expect(normalized.clipRegions.find((c) => c.id === "a")?.sourceStartMs).toBeUndefined();
	});

	it("preserves AudioRegion.isNarration through save/reload", () => {
		const normalized = normalizeProjectEditor({
			audioRegions: [
				{
					id: "n1",
					startMs: 0,
					endMs: 5_000,
					audioPath: "narration.wav",
					volume: 1,
					isNarration: true,
				},
				{ id: "music", startMs: 0, endMs: 5_000, audioPath: "bg.mp3", volume: 0.5 },
			],
		});
		expect(normalized.audioRegions.find((r) => r.id === "n1")?.isNarration).toBe(true);
		expect(normalized.audioRegions.find((r) => r.id === "music")?.isNarration).toBeUndefined();
	});
});
