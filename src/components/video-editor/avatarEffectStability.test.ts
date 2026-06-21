// Regression evidence for the avatar-panel FREEZE.
//
// Root cause (proven below): the editor passed an *inline* callback to the Avatar
// panel, e.g. `onAvatarSettings={(patch) => setAvatarOverlay(...)}`. React makes a
// NEW function identity on every render, and the panel used it as a `useEffect`
// dependency that itself calls the callback (→ setState). New identity every render
// ⇒ effect re-runs every render ⇒ setState every render ⇒ infinite re-render ⇒ the
// main thread saturates and the whole editor freezes.
//
// Part 1 models that loop in plain JS (node-only test env — we can't render React).
// Part 2 guards the real source so the inline-callback pattern can't come back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A tiny model of "an effect whose deps include a callback, and whose body calls
// that callback to set state". Each render: if any dep changed *by reference* since
// the last render, the effect runs (and schedules another render). Returns how many
// renders happened before things settled (capped so a real loop is detectable).
function simulateEffectRenders(opts: { stableCallback: boolean; maxRenders: number }): number {
	const stable = () => undefined;
	let renders = 0;
	let prevDeps: unknown[] | null = null;
	let pendingRerender = true;
	while (pendingRerender && renders < opts.maxRenders) {
		renders++;
		pendingRerender = false;
		// The dependency array for this render. The callback is either reused
		// (stable) or freshly created (unstable — new identity each render).
		const callback = opts.stableCallback ? stable : () => undefined;
		const deps = [callback];
		const changed = !prevDeps || prevDeps.some((d, i) => d !== deps[i]);
		if (changed) {
			// Effect body calls the callback → setState → schedule another render.
			pendingRerender = true;
		}
		prevDeps = deps;
	}
	return renders;
}

describe("the freeze mechanism (unstable callback in effect deps)", () => {
	it("UNSTABLE callback re-runs the effect every render → runaway loop", () => {
		const renders = simulateEffectRenders({ stableCallback: false, maxRenders: 1000 });
		// Hits the cap: in real React this is 'Maximum update depth exceeded' / freeze.
		expect(renders).toBe(1000);
	});

	it("STABLE (memoized) callback settles after the first render — no loop", () => {
		const renders = simulateEffectRenders({ stableCallback: true, maxRenders: 1000 });
		expect(renders).toBeLessThanOrEqual(2);
	});
});

// Models the avatar-selection RESTORE bug: the persistence effect runs first on
// mount and clears storage when the live selection is still null — wiping the
// saved value before the restore effect can read it. Reading a snapshot captured
// at first render (before any effect) survives the clear.
describe("avatar selection restore survives the mount-time clear", () => {
	function runMount(readVia: "live-storage" | "snapshot"): string | null {
		const store: Record<string, string | null> = { "gg.avatar.lookId": "look-123" };
		// Snapshot captured during render, BEFORE effects (like a useState lazy init).
		const snapshot = store["gg.avatar.lookId"];
		// Effect order on mount: persistence first (selection still null → clears)…
		const liveSelection: string | null = null;
		if (liveSelection) store["gg.avatar.lookId"] = liveSelection;
		else store["gg.avatar.lookId"] = null;
		// …then restore reads.
		return readVia === "snapshot" ? snapshot : store["gg.avatar.lookId"];
	}

	it("reading live storage in the restore effect loses the selection (the bug)", () => {
		expect(runMount("live-storage")).toBeNull();
	});

	it("reading the first-render snapshot restores it (the fix)", () => {
		expect(runMount("snapshot")).toBe("look-123");
	});
});

describe("the real fix is in place (no inline avatar callbacks to the panel)", () => {
	const src = readFileSync(path.join(__dirname, "VideoEditor.tsx"), "utf8");

	for (const prop of ["onAvatarSettings", "onAvatarPreview", "onAvatarReady", "onAvatarMove"]) {
		it(`${prop} is passed a stable handler, not an inline arrow`, () => {
			// The buggy form was e.g. `onAvatarSettings={(patch) =>` — assert it's gone
			// and the prop instead references a memoized handle* identifier.
			expect(src).not.toMatch(new RegExp(`${prop}=\\{\\(`));
			expect(src).toMatch(new RegExp(`${prop}=\\{handle`));
		});
	}
});
