/**
 * Extension IPC Handlers — Main Process
 *
 * Registers IPC handlers for extension management (discover, install,
 * uninstall, enable/disable) and exposes them to the renderer via preload.
 * Extensions are local only — there is no remote marketplace.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
	discoverExtensions,
	getExtension,
	getExtensionsDirectory,
	getRegisteredExtensions,
	installExtensionFromPath,
	setExtensionStatus,
	uninstallExtension,
} from "./extensionLoader";
import type { ExtensionInfo } from "./extensionTypes";

/**
 * Serialize extension info for IPC transfer (strip non-serializable fields).
 */
function serializeExtensionInfo(info: ExtensionInfo) {
	return {
		manifest: info.manifest,
		status: info.status,
		path: info.path,
		error: info.error,
		builtin: info.builtin ?? false,
	};
}

/**
 * Register all extension-related IPC handlers.
 * Call this once during app initialization (in main.ts).
 */
export function registerExtensionIpcHandlers(): void {
	// Discover all extensions (builtin + user-installed)
	ipcMain.handle("extensions:discover", async () => {
		const extensions = await discoverExtensions();
		return extensions.map(serializeExtensionInfo);
	});

	// List currently registered extensions
	ipcMain.handle("extensions:list", () => {
		return getRegisteredExtensions().map(serializeExtensionInfo);
	});

	// Get a specific extension by ID
	ipcMain.handle("extensions:get", (_event, id: string) => {
		const ext = getExtension(id);
		return ext ? serializeExtensionInfo(ext) : null;
	});

	// Enable an extension
	ipcMain.handle("extensions:enable", async (_event, id: string) => {
		return setExtensionStatus(id, "active");
	});

	// Disable an extension
	ipcMain.handle("extensions:disable", async (_event, id: string) => {
		return setExtensionStatus(id, "disabled");
	});

	// Install an extension from a folder picker
	ipcMain.handle("extensions:install-from-folder", async (event) => {
		const window = BrowserWindow.fromWebContents(event.sender);
		const result = await dialog.showOpenDialog(window!, {
			title: "Select Extension Folder",
			properties: ["openDirectory"],
			message: "Select a folder containing a glitchrecord-extension.json manifest",
		});

		if (result.canceled || result.filePaths.length === 0) {
			return { success: false, reason: "cancelled" };
		}

		const info = await installExtensionFromPath(result.filePaths[0]);
		if (!info) {
			return {
				success: false,
				reason: "Invalid extension: missing or invalid glitchrecord-extension.json",
			};
		}

		return { success: true, extension: serializeExtensionInfo(info) };
	});

	// Uninstall an extension
	ipcMain.handle("extensions:uninstall", async (_event, id: string) => {
		const success = await uninstallExtension(id);
		return { success };
	});

	// Get extensions directory path
	ipcMain.handle("extensions:get-directory", () => {
		return getExtensionsDirectory();
	});

	// Open extensions directory in file manager
	ipcMain.handle("extensions:open-directory", async () => {
		const dir = getExtensionsDirectory();
		await shell.openPath(dir);
		return { success: true };
	});
}
