// Real in-app test of "Trim to End": load the editor, move the playhead to ~40%,
// fire Trim to End (toolbar button), and screenshot before/after + measure the
// clip extent so we can SEE the tail get cut.
import { launchEditor } from "./helpers/electron.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = (n) => path.join(HERE, "..", `trimend-${n}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clipExtent = async (win) => {
	const clips = win.locator('text="Clip"');
	const n = await clips.count().catch(() => 0);
	let left = Infinity, right = -Infinity;
	for (let i = 0; i < n; i++) {
		const box = await clips.nth(i).boundingBox().catch(() => null);
		if (box) { left = Math.min(left, box.x); right = Math.max(right, box.x + box.width); }
	}
	return { n, left, right, width: right - left };
};

const editor = await launchEditor();
try {
	const win = editor.window;
	await win.waitForLoadState("domcontentloaded");
	await sleep(6000); // mount timeline + sample video

	const before = await clipExtent(win);
	console.log("BEFORE:", JSON.stringify(before));
	await win.screenshot({ path: OUT("1-before"), clip: { x: 0, y: 240, width: 1280, height: 460 } }).catch(() => win.screenshot({ path: OUT("1-before") }));

	// Move the playhead to ~40% across the clip span by clicking the ruler there.
	if (before.n > 0 && Number.isFinite(before.left)) {
		const firstBox = await win.locator('text="Clip"').first().boundingBox();
		const targetX = before.left + before.width * 0.4;
		const rulerY = Math.max(8, firstBox.y - 22); // ruler sits just above the clips
		await win.mouse.click(targetX, rulerY);
		await sleep(800);
		console.log(`clicked ruler at x=${Math.round(targetX)} y=${Math.round(rulerY)}`);
	}
	await win.screenshot({ path: OUT("2-playhead"), clip: { x: 0, y: 240, width: 1280, height: 460 } }).catch(() => {});

	// Click the Trim to End toolbar button (title set in the JSX).
	const trimBtn = win.locator('button[title*="Trim to End"]').first();
	const hasBtn = await trimBtn.count().catch(() => 0);
	console.log("trim button found:", hasBtn);
	if (hasBtn) {
		await trimBtn.click();
		await sleep(1200);
	}

	const after = await clipExtent(win);
	console.log("AFTER:", JSON.stringify(after));
	await win.screenshot({ path: OUT("3-after"), clip: { x: 0, y: 240, width: 1280, height: 460 } }).catch(() => win.screenshot({ path: OUT("3-after") }));

	const shrank = after.width < before.width - 5;
	console.log(`VERDICT: clip extent ${shrank ? "SHRANK" : "did NOT shrink"} (before ${Math.round(before.width)} → after ${Math.round(after.width)})`);
} finally {
	await editor.close();
}
