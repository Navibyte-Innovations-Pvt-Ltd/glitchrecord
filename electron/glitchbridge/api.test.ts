// The Report Bug window keeps the AI assistant after an hourly rate limit only
// when this client passes the server's `retryable` through (#375). A monthly
// cap must still retire it, so the flag cannot default to true.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { assistReportTurn } from "./api";

function respond(status: number, body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: status < 400, status, json: async () => body })),
	);
}

const turn = () =>
	assistReportTurn({
		sessionId: "s1",
		repoId: "r1",
		messages: [{ role: "user", content: "it broke" }],
		conversationId: null,
	});

describe("assistReportTurn", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("passes an hourly rate limit through as retryable", async () => {
		respond(429, { success: false, error: "The assistant is busy", degrade: true, retryable: true });
		expect(await turn()).toMatchObject({ degraded: "The assistant is busy", retryable: true });
	});

	it("does not mark a monthly cap retryable", async () => {
		respond(429, { success: false, error: "Monthly limit hit", degrade: true });
		expect(await turn()).toMatchObject({ degraded: "Monthly limit hit", retryable: false });
	});
});
