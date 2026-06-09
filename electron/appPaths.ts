import path from "node:path";
import { app } from "electron";

if (process.env["VITE_DEV_SERVER_URL"]) {
<<<<<<< HEAD
	const devUserDataPath = path.join(app.getPath("appData"), "GlitchRecord-dev");
=======
	const devUserDataPath = path.join(app.getPath("appData"), "GlitchGrab-dev");
>>>>>>> 6fc7bbcbdb19e82c384b1fc0ff8de872093c645c
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

export const USER_DATA_PATH = app.getPath("userData");
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");
