import { describe, expect, it } from "vitest";
import { normalizeAnimationSpec, normalizeCardDesign } from "./cardAnimations";

const DESIGN = `{
  "background": { "type": "gradient", "color1": "#0a1226", "color2": "#1e3a8a", "angle": 135, "glow": 0.3, "vignette": 0.4 },
  "text": { "brandName": "Acme", "tagline": "Ship it", "color": "#ffffff" },
  "layout": "logo-top",
  "logoContainer": "panel",
  "size": 0.3,
  "position": "center",
  "animation": { "label": "Custom", "tracks": [ { "property": "scale", "keyframes": [ { "t": 0, "value": 0.8 }, { "t": 0.5, "value": 1, "easing": "easeOutBack" } ] } ] }
}`;

describe("normalizeCardDesign — tolerant parse", () => {
	it("parses clean JSON", () => {
		const patch = normalizeCardDesign(DESIGN);
		expect(patch).not.toBeNull();
		expect(patch?.background?.color1).toBe("#0a1226");
		expect(patch?.layout).toBe("logo-top");
		expect(patch?.logoContainer).toBe("panel");
		expect(patch?.customAnimation?.tracks.length).toBe(1);
	});

	it("tolerates ```json code fences", () => {
		const patch = normalizeCardDesign("```json\n" + DESIGN + "\n```");
		expect(patch?.background?.color2).toBe("#1e3a8a");
	});

	it("tolerates surrounding prose", () => {
		const patch = normalizeCardDesign(`Here's your design:\n${DESIGN}\nEnjoy!`);
		expect(patch?.text?.brandName).toBe("Acme");
	});

	it("clamps + drops invalid fields, keeps valid ones", () => {
		const patch = normalizeCardDesign(
			`{ "size": 9, "position": "diagonal", "background": { "glow": 5 } }`,
		);
		expect(patch?.size).toBe(0.8); // clamped to max
		expect(patch?.position).toBeUndefined(); // invalid dropped
		expect(patch?.background?.glow).toBe(1); // clamped
	});

	it("repairs a raw newline inside a string value (wrapped paste)", () => {
		const broken =
			'{ "text": { "brandName": "Acme", "tagline": "discover, compare, and book study\n  rooms & libraries", "color": "#ffffff" }, "layout": "logo-top" }';
		const patch = normalizeCardDesign(broken);
		expect(patch).not.toBeNull();
		expect(patch?.layout).toBe("logo-top");
		expect(patch?.text?.tagline).toContain("rooms & libraries");
	});

	it("returns null for non-JSON", () => {
		expect(normalizeCardDesign("not json at all")).toBeNull();
		expect(normalizeCardDesign("")).toBeNull();
	});
});

describe("normalizeAnimationSpec — tolerant parse", () => {
	it("tolerates fences + drops bad keyframes", () => {
		const spec = normalizeAnimationSpec(
			'```\n{ "tracks": [ { "property": "opacity", "keyframes": [ { "t": 0, "value": 0 }, { "t": "bad", "value": 1 }, { "t": 1, "value": 1 } ] } ] }\n```',
		);
		expect(spec).not.toBeNull();
		// the "bad" t keyframe is dropped, two valid remain
		expect(spec?.tracks[0].keyframes.length).toBe(2);
	});

	it("rejects specs with no usable tracks", () => {
		expect(normalizeAnimationSpec('{ "tracks": [] }')).toBeNull();
		expect(
			normalizeAnimationSpec('{ "tracks": [ { "property": "nope", "keyframes": [] } ] }'),
		).toBeNull();
	});
});
