// Integration test for the GlitchGrab bridge — drives the REAL WebSocket server
// exactly as the Chrome extension does (recording:start → event:live →
// events:upload), so the lost/duplicate/stale-event bugs are caught repeatably
// without needing a live browser + Electron + recording.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

// Use a non-default port so the test never collides with a running GlitchRecord.
// Must run BEFORE the hoisted import of ./server (which reads PORT at load).
vi.hoisted(() => {
	process.env.GLITCHBRIDGE_PORT = "7345";
});

// ── Mocks ─────────────────────────────────────────────────────
// Electron's app.getPath → a temp dir so persistSession/appendDebugLog work.
vi.mock("electron", () => ({
	app: { getPath: () => path.join(os.tmpdir(), "gg-bridge-test") },
}));

// The web API layer + auth — defined via vi.hoisted so they exist when the
// hoisted vi.mock factories run. Record calls to assert no-duplicate-issue.
const mocks = vi.hoisted(() => ({
	createIssue: vi.fn(async () => ({ url: "https://github.com/x/y/issues/1", number: 1 })),
	generateScript: vi.fn(async () => "narration script"),
	uploadSession: vi.fn(async () => "db-session-id"),
	validateToken: vi.fn(async () => ({ id: "u1", name: "Tester", email: "t@x.com" })),
	getRepos: vi.fn(async () => []),
	loadAuth: vi.fn(() => null), // not logged in → capture/persist path, no AI/issue
}));
vi.mock("./api", () => ({
	createIssue: mocks.createIssue,
	generateScript: mocks.generateScript,
	uploadSession: mocks.uploadSession,
	validateToken: mocks.validateToken,
	getRepos: mocks.getRepos,
	BASE: "http://localhost:3000",
}));
vi.mock("./auth", () => ({ loadAuth: mocks.loadAuth }));

// Imported AFTER mocks are registered.
import {
	startBridgeServer,
	stopBridgeServer,
	broadcastRecordingStart,
	broadcastRecordingStop,
	getCurrentSession,
} from "./server";

const PORT = 7345;

// Collect callback fires from the renderer-facing side of the bridge.
const liveEvents: unknown[] = [];
const eventsReady: Array<{ sessionId: string; count: number }> = [];

// A chrome-side client that buffers EVERY message from creation, so a
// resync sent immediately on connection is never missed by a late listener.
interface Client {
	ws: WebSocket;
	messages: Record<string, unknown>[];
	waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
	close: () => void;
}

function connectChrome(): Promise<Client> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${PORT}?role=chrome`);
		const messages: Record<string, unknown>[] = [];
		ws.on("message", (raw: Buffer) => messages.push(JSON.parse(raw.toString())));
		ws.on("error", reject);
		ws.on("open", () => {
			resolve({
				ws,
				messages,
				close: () => ws.close(),
				waitFor: (type, timeoutMs = 2000) =>
					new Promise((res, rej) => {
						const deadline = Date.now() + timeoutMs;
						const poll = () => {
							const hit = messages.find((m) => m.type === type);
							if (hit) return res(hit);
							if (Date.now() > deadline) return rej(new Error(`timeout waiting for ${type}`));
							setTimeout(poll, 20);
						};
						poll();
					}),
			});
		});
	});
}

const tick = () => new Promise((r) => setTimeout(r, 50));

const SAMPLE_EVENTS = [
	{ type: "click", t: 1000, label: "Get Early Access", tag: "button", url: "http://localhost:3000/", meta: { role: "button", icon: "svg", section: "form" } },
	{ type: "input", t: 2000, label: "Email", tag: "input", url: "http://localhost:3000/", preview: "test@example.com", meta: { role: "textbox", inputType: "email" } },
	{ type: "navigate", t: 3000, label: "Dashboard", url: "http://localhost:3000/dashboard" },
];

beforeAll(async () => {
	startBridgeServer({
		onScriptReady: () => {},
		onIssueCreated: () => {},
		onLiveEvent: (e) => liveEvents.push(e),
		onEventsReady: (sessionId, count) => eventsReady.push({ sessionId, count }),
	});
	await tick(); // let the WS server bind
});

afterAll(() => {
	stopBridgeServer();
});

describe("GlitchGrab bridge protocol", () => {
	it("captures, persists, and preserves rich metadata end-to-end", async () => {
		const chrome = await connectChrome();

		// 1. GlitchRecord presses Record → extension should receive recording:start
		const startPromise = chrome.waitFor("recording:start");
		const sessionId = broadcastRecordingStart("repo1", "My Repo");
		const startMsg = await startPromise;
		expect(startMsg.sessionId).toBe(sessionId);
		expect(startMsg.repoName).toBe("My Repo");

		// 2. Live event stream reaches the renderer feed
		chrome.ws.send(JSON.stringify({ type: "event:live", event: SAMPLE_EVENTS[0] }));
		await tick();
		expect(liveEvents.length).toBeGreaterThan(0);

		// 3. On stop, the extension uploads the full batch
		chrome.ws.send(JSON.stringify({ type: "events:upload", sessionId, events: SAMPLE_EVENTS }));
		await tick();

		const session = getCurrentSession();
		expect(session?.id).toBe(sessionId);
		expect(session?.events).toHaveLength(3);
		// Metadata survives the round-trip (this is what makes good scripts)
		const click = session?.events.find((e) => e.type === "click");
		expect(click?.meta?.role).toBe("button");
		expect(click?.meta?.icon).toBe("svg");
		const input = session?.events.find((e) => e.type === "input");
		expect(input?.preview).toBe("test@example.com");
		// Editor got the ready signal
		expect(eventsReady.at(-1)).toMatchObject({ sessionId, count: 3 });

		chrome.close();
		broadcastRecordingStop(sessionId, {} as never);
	});

	it("is idempotent — a duplicate upload does NOT double events", async () => {
		const chrome = await connectChrome();
		const startP = chrome.waitFor("recording:start");
		const sessionId = broadcastRecordingStart("repo2", "Repo Two");
		await startP;

		chrome.ws.send(JSON.stringify({ type: "events:upload", sessionId, events: SAMPLE_EVENTS }));
		await tick();
		// Double-stop / retry sends the SAME batch again
		chrome.ws.send(JSON.stringify({ type: "events:upload", sessionId, events: SAMPLE_EVENTS }));
		await tick();

		expect(getCurrentSession()?.events).toHaveLength(3); // not 6

		chrome.close();
		broadcastRecordingStop(sessionId, {} as never);
	});

	it("resyncs recording:start to an extension that connects AFTER record started", async () => {
		// Start recording with NO chrome client connected (start-before-connect race)
		const sessionId = broadcastRecordingStart("repo3", "Repo Three");
		await tick();

		// Extension connects late → bridge must replay recording:start
		const chrome = await connectChrome();
		const resync = await chrome.waitFor("recording:start");
		expect(resync.sessionId).toBe(sessionId);

		chrome.close();
		broadcastRecordingStop(sessionId, {} as never);
	});

	it("falls back to the current session when the upload sessionId is unknown", async () => {
		const chrome = await connectChrome();
		const startP = chrome.waitFor("recording:start");
		const sessionId = broadcastRecordingStart("repo4", "Repo Four");
		await startP;

		// Extension uploads with a STALE/wrong id (bridge restart, HTTP-signal start)
		chrome.ws.send(JSON.stringify({ type: "events:upload", sessionId: "wrong-id", events: SAMPLE_EVENTS }));
		await tick();

		// Events land on the current session instead of being dropped
		expect(getCurrentSession()?.id).toBe(sessionId);
		expect(getCurrentSession()?.events).toHaveLength(3);

		chrome.close();
		broadcastRecordingStop(sessionId, {} as never);
	});

	it("recording stop is idempotent (double-stop is a no-op)", async () => {
		const chrome = await connectChrome();
		const startP = chrome.waitFor("recording:start");
		const sessionId = broadcastRecordingStart("repo5", "Repo Five");
		await startP;

		let stopCount = 0;
		chrome.ws.on("message", (raw: Buffer) => {
			if (JSON.parse(raw.toString()).type === "recording:stop") stopCount++;
		});

		broadcastRecordingStop(sessionId, {} as never);
		broadcastRecordingStop(sessionId, {} as never); // second stop must be ignored
		await tick();

		expect(stopCount).toBe(1);
		chrome.close();
	});
});
