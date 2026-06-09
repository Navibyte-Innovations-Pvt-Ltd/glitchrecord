import { describe, expect, it } from "vitest";

import { getFinalMacCompanionAudioPath } from "./macCompanionAudio";

describe("mac companion audio paths", () => {
	it("preserves the helper's AAC container extension", () => {
		expect(
			getFinalMacCompanionAudioPath(
<<<<<<< HEAD
				"/Users/egg/GlitchRecord/recording-1.mp4",
				"/Users/egg/GlitchRecord/recording-1.mic.m4a",
				"mic",
			),
		).toBe("/Users/egg/GlitchRecord/recording-1.mic.m4a");
=======
				"/Users/egg/GlitchGrab/recording-1.mp4",
				"/Users/egg/GlitchGrab/recording-1.mic.m4a",
				"mic",
			),
		).toBe("/Users/egg/GlitchGrab/recording-1.mic.m4a");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
	});

	it("preserves legacy sidecar extensions instead of renaming bytes", () => {
		expect(
			getFinalMacCompanionAudioPath(
<<<<<<< HEAD
				"/Users/egg/GlitchRecord/recording-1.mp4",
				"/tmp/recordly-native.system.webm",
				"system",
			),
		).toBe("/Users/egg/GlitchRecord/recording-1.system.webm");
=======
				"/Users/egg/GlitchGrab/recording-1.mp4",
				"/tmp/recordly-native.system.webm",
				"system",
			),
		).toBe("/Users/egg/GlitchGrab/recording-1.system.webm");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
	});

	it("keeps dotted directories when the video path has no extension", () => {
		expect(
			getFinalMacCompanionAudioPath(
<<<<<<< HEAD
				"/Users/egg/GlitchRecord.videos/recording-1",
				"/tmp/recordly-native.mic.m4a",
				"mic",
			),
		).toBe("/Users/egg/GlitchRecord.videos/recording-1.mic.m4a");
=======
				"/Users/egg/GlitchGrab.videos/recording-1",
				"/tmp/recordly-native.mic.m4a",
				"mic",
			),
		).toBe("/Users/egg/GlitchGrab.videos/recording-1.mic.m4a");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
	});
});
