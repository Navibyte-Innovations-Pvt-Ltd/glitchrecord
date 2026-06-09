import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowsCaptureOutputBuffer, setWindowsCaptureTargetPath } from "../state";
import { waitForWindowsCaptureStop } from "./windows";

vi.mock("electron", () => ({
	app: {
<<<<<<< HEAD
		getPath: () => "C:\\GlitchRecordTest",
=======
		getPath: () => "C:\\GlitchGrabTest",
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;

	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

describe("waitForWindowsCaptureStop", () => {
	beforeEach(() => {
		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureTargetPath(null);
	});

	it("resolves the helper output path when the process closes cleanly", async () => {
		const proc = new FakeCaptureProcess();
<<<<<<< HEAD
		setWindowsCaptureOutputBuffer("Recording stopped. Output path: C:\\GlitchRecord\\capture.mp4");
=======
		setWindowsCaptureOutputBuffer("Recording stopped. Output path: C:\\GlitchGrab\\capture.mp4");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

<<<<<<< HEAD
		await expect(stopped).resolves.toBe("C:\\GlitchRecord\\capture.mp4");
=======
		await expect(stopped).resolves.toBe("C:\\GlitchGrab\\capture.mp4");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("resolves the fallback target path when the helper closes cleanly without output path", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped without output path");
<<<<<<< HEAD
		setWindowsCaptureTargetPath("C:\\GlitchRecord\\fallback.mp4");
=======
		setWindowsCaptureTargetPath("C:\\GlitchGrab\\fallback.mp4");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

<<<<<<< HEAD
		await expect(stopped).resolves.toBe("C:\\GlitchRecord\\fallback.mp4");
=======
		await expect(stopped).resolves.toBe("C:\\GlitchGrab\\fallback.mp4");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects with helper output when the helper exits with a non-zero code", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Encoder error: insufficient memory");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 1);

		await expect(stopped).rejects.toThrow("Encoder error: insufficient memory");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects when the helper emits an error", async () => {
		const proc = new FakeCaptureProcess();
		const error = new Error("spawn failed");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("error", error);

		await expect(stopped).rejects.toBe(error);
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("kills the helper and rejects when stop never completes", async () => {
		const proc = new FakeCaptureProcess();

		await expect(
			waitForWindowsCaptureStop(
				proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
				5,
			),
		).rejects.toThrow("Timed out waiting for native Windows capture to stop");
		expect(proc.kill).toHaveBeenCalledTimes(1);
	});
});
