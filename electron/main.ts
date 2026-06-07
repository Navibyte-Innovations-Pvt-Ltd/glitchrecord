import fs from "node:fs/promises";
import fssync from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	clipboard,
	desktopCapturer,
	dialog,
	ipcMain,
	Menu,
	Notification,
	nativeImage,
	session,
	shell,
	systemPreferences,
	Tray,
} from "electron";
import { RECORDINGS_DIR } from "./appPaths";
import { showCursor } from "./cursorHider";
import { registerExtensionIpcHandlers } from "./extensions/extensionIpc";
import { getGpuSwitches } from "./gpuSwitches";
import {
	cleanupAllExportStreams,
	cleanupNativeVideoExportSessions,
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import { shouldUseSyntheticLinuxPortalSource } from "./ipc/register/sourceMapping";
import { ensureMediaServer } from "./mediaServer";
import { ensurePackagedRendererServer } from "./rendererServer";
import { startBridgeServer, stopBridgeServer, broadcastRecordingStart, broadcastRecordingStop, refreshCurrentUserFromStorage, getAuthStatus, fetchUserRepos, getCurrentSession, getCurrentUser, loadPersistedSession, appendDebugLog, resetBridgeSession } from "./glitchbridge/server";
import { saveAuth, clearAuth, setSelectedRepo } from "./glitchbridge/auth";
import { validateToken, uploadSession, generateScript, BASE as GLITCHGRAB_URL } from "./glitchbridge/api";
import type { UpdateToastPayload } from "./updater";
import {
	checkForAppUpdates,
	deferUpdateReminder,
	dismissUpdateToast,
	downloadAvailableUpdate,
	getCurrentUpdateToastPayload,
	getUpdaterLogPath,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	previewUpdateToast,
	setupAutoUpdates,
	skipAvailableUpdateVersion,
} from "./updater";
import {
	createEditorWindow,
	createHomeWindow,
	getHomeWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	getHudOverlayWindow,
	getUpdateToastWindow,
	hideUpdateToastWindow,
	isHudOverlayMousePassthroughSupported,
	reassertHudOverlayMousePassthrough as reassertHudOverlayMouseState,
	setHudOverlayRecordingActive,
	showUpdateToastWindow,
} from "./windows";

const electronMainDir = path.dirname(fileURLToPath(import.meta.url));
const IS_SMOKE_EXPORT = process.env.RECORDLY_SMOKE_EXPORT === "1";

function ignoreBrokenConsolePipe(stream: NodeJS.WritableStream | undefined) {
	stream?.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EPIPE") {
			return;
		}
		throw error;
	});
}

ignoreBrokenConsolePipe(process.stdout);
ignoreBrokenConsolePipe(process.stderr);

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-gpu-rasterization");

function configureGpuAccelerationSwitches() {
	const { useAngle, useGl, disableFeatures } = getGpuSwitches(process.platform, process.env);
	if (useAngle) {
		app.commandLine.appendSwitch("use-angle", useAngle);
	}
	if (useGl) {
		app.commandLine.appendSwitch("use-gl", useGl);
	}
	if (disableFeatures && disableFeatures.length > 0) {
		app.commandLine.appendSwitch("disable-features", disableFeatures.join(","));
	}
}

async function logSmokeExportGpuDiagnostics() {
	if (!IS_SMOKE_EXPORT) {
		return;
	}

	try {
		console.log("[smoke-export] GPU feature status", JSON.stringify(app.getGPUFeatureStatus()));
		console.log("[smoke-export] GPU info", JSON.stringify(await app.getGPUInfo("basic")));
	} catch (error) {
		console.warn("[smoke-export] Failed to read GPU diagnostics:", error);
	}
}

configureGpuAccelerationSwitches();

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(electronMainDir, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

// Global safety net: keep the main process alive on an unexpected throw so an
// in-progress recording isn't silently killed. Log to the unified debug file.
process.on("uncaughtException", (err) => {
	console.error("[main] Uncaught exception:", err);
	try { appendDebugLog("rec", `UNCAUGHT EXCEPTION: ${err?.stack ?? String(err)}`); } catch { /* ignore */ }
});
process.on("unhandledRejection", (reason) => {
	console.error("[main] Unhandled rejection:", reason);
	try { appendDebugLog("rec", `UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}`); } catch { /* ignore */ }
});

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayContextMenu: Menu | null = null;
let selectedSourceName = "";
let editorHasUnsavedChanges = false;
let isForceClosing = false;
let isCreatingMainWindow = false;
let isCreatingEditorWindow = false;
let activeUpdateNotification: Notification | null = null;
let activeUpdateNotificationKey: string | null = null;
// Always enforce single instance — the app binds port 7337 for the GlitchGrab
// bridge, so two instances can never coexist anyway. A second launch focuses the
// existing window (see "second-instance" handler) instead of spawning a new app.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
	app.quit();
}

function closeEditorWindowBypassingUnsavedPrompt(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (isEditorWindow(window)) {
		isForceClosing = true;
		editorHasUnsavedChanges = false;
	}
	window.close();
}

function restoreWindowSafely(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (!isEditorWindow(window) && process.platform === "win32") {
		showHudOverlayFromTray();
		return;
	}

	if (window.isMinimized()) {
		window.restore();
	}

	if (!window.isVisible()) {
		window.show();
	}

	window.moveTop();
	window.focus();
}

function getExistingEditorWindow(): BrowserWindow | null {
	return (
		BrowserWindow.getAllWindows().find(
			(window) => !window.isDestroyed() && isEditorWindow(window),
		) ?? null
	);
}

// Tray Icons (lazily created after app is ready to avoid accessing Electron APIs too early)
let defaultTrayIcon: ReturnType<typeof getTrayIcon> | null = null;
let recordingTrayIcon: ReturnType<typeof getTrayIcon> | null = null;

function getPlatformAppIconFilename(size: 32 | 128 | 512) {
	const baseName = process.platform === "darwin" ? "recordlymac" : "recordly";
	return `app-icons/${baseName}-${size}.png`;
}

function getDefaultTrayIcon() {
	if (!defaultTrayIcon) {
		defaultTrayIcon = getTrayIcon(getPlatformAppIconFilename(32));
	}
	return defaultTrayIcon;
}

function getRecordingTrayIcon() {
	if (!recordingTrayIcon) {
		recordingTrayIcon = getTrayIcon("rec-button.png");
	}
	return recordingTrayIcon;
}

function showHudOverlayFromTray() {
	const hud = getHudOverlayWindow();
	if (!hud) {
		return false;
	}

	if (hud.isMinimized()) {
		hud.restore();
	}

	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		hud.showInactive();
		hud.moveTop();
		reassertHudOverlayMouseState({ interactiveGraceMs: 1200 });
		return true;
	}

	hud.show();
	hud.moveTop();
	hud.focus();
	return true;
}

ipcMain.on("set-has-unsaved-changes", (_event, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function createWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			if (!mainWindow || mainWindow.isDestroyed()) {
				createWindow();
			}
		});
		return;
	}

	if (isCreatingMainWindow) {
		return;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		restoreWindowSafely(mainWindow);
		return;
	}

	const existingHudWindow = getHudOverlayWindow();
	if (existingHudWindow) {
		mainWindow = existingHudWindow;
		restoreWindowSafely(existingHudWindow);
		return;
	}

	isCreatingMainWindow = true;
	const createdHudWindow = createHudOverlayWindow();
	mainWindow = createdHudWindow;
	createdHudWindow.once("closed", () => {
		if (mainWindow === createdHudWindow) {
			mainWindow = null;
		}
	});
	isCreatingMainWindow = false;
}

function focusOrCreateMainWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			focusOrCreateMainWindow();
		});
		return;
	}

	if (!mainWindow || mainWindow.isDestroyed()) {
		const existingHud = getHudOverlayWindow();
		if (existingHud && !existingHud.isDestroyed()) {
			mainWindow = existingHud;
		} else {
			createWindow();
			return;
		}
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		// On Linux/Wayland, focus() often doesn't take effect (compositor ignores it). Apps like Telegram
		// work because they receive an XDG activation token via StatusNotifierItem.ProvideXdgActivationToken;
		// Electron's tray doesn't handle that yet. Workaround: destroy and recreate the HUD so the new
		// window gets focus (creation path works). Only for HUD, not editor.
		if (
			process.platform === "linux" &&
			!mainWindow.isFocused() &&
			!isEditorWindow(mainWindow)
		) {
			const win = mainWindow;
			mainWindow = null;
			win.once("closed", () => createWindow());
			win.destroy();
			return;
		}

		// On Win32 with mouse passthrough enabled (Win11+), calling
		// show/moveTop/focus on the transparent HUD overlay permanently corrupts
		// setIgnoreMouseEvents forwarding, making it click-through.  Only focus
		// the editor window; the HUD is alwaysOnTop so it doesn't need explicit
		// focus.  On Win10 (passthrough disabled), the HUD is always interactive
		// and can be safely shown/restored.
		if (
			process.platform === "win32" &&
			!isEditorWindow(mainWindow) &&
			isHudOverlayMousePassthroughSupported()
		) {
			showHudOverlayFromTray();
			return;
		}

		mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.moveTop();
		mainWindow.focus();
	}
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	if (!isMac) {
		Menu.setApplicationMenu(null);
		return;
	}

	const template: Electron.MenuItemConstructorOptions[] = [];
	template.push({
		label: app.name,
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		],
	});

	template.push(
		{
			label: "File",
			submenu: [
				{
					label: "Open Projects…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: isMac
				? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize" }, { role: "close" }],
		},
		{
			label: "Help",
			submenu: [
				{
					label: "Check for Updates…",
					click: () => {
						void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
					},
				},
			],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function isPrimaryTrayClick(event: unknown) {
	const button =
		event && typeof event === "object" && "button" in event
			? (event as { button?: number | string }).button
			: undefined;
	return button === undefined || button === 0 || button === "left";
}

function createTray() {
	tray = new Tray(getDefaultTrayIcon());
	tray.on("click", (event) => {
		if (process.platform === "win32" && !isPrimaryTrayClick(event)) {
			return;
		}

		focusOrCreateMainWindow();
	});

	if (process.platform === "win32") {
		tray.on("right-click", () => {
			if (!tray || !trayContextMenu) {
				return;
			}

			tray.popUpContextMenu(trayContextMenu);
		});
		return;
	}

	tray.on("double-click", () => focusOrCreateMainWindow());
}

function getPublicAssetPath(filename: string) {
	return path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename);
}

function getAppImage(filename: string) {
	return nativeImage.createFromPath(getPublicAssetPath(filename));
}

function getTrayIcon(filename: string) {
	return getAppImage(filename).resize({
		width: 24,
		height: 24,
		quality: "best",
	});
}

function syncDockIcon() {
	if (process.platform !== "darwin" || !app.dock) {
		return;
	}

	const dockIcon = getAppImage(getPlatformAppIconFilename(512));
	if (!dockIcon.isEmpty()) {
		app.dock.setIcon(dockIcon);
	}
}

function getUpdateNotificationTitle(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return `Recordly ${payload.version} is available`;
		case "downloading":
			return `Downloading Recordly ${payload.version}`;
		case "ready":
			return `Recordly ${payload.version} is ready`;
		case "error":
			return `Recordly ${payload.version} needs attention`;
	}
}

function getUpdateNotificationBody(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return "Click to install the update and restart Recordly.";
		case "downloading":
			return "Recordly is downloading the update and will restart when it is ready.";
		case "ready":
			return "Click to install the downloaded update and restart.";
		case "error":
			return payload.primaryAction === "install-and-restart"
				? "Click to try the install again."
				: "Click to retry checking for updates.";
	}
}

function clearActiveUpdateNotification() {
	if (activeUpdateNotification) {
		activeUpdateNotification.close();
		activeUpdateNotification = null;
	}
	activeUpdateNotificationKey = null;
}

function sendUpdateToastToWindows(channel: "update-toast-state", payload: unknown) {
	if (process.platform !== "darwin") {
		if (!payload) {
			clearActiveUpdateNotification();
			return true;
		}

		const updatePayload = payload as UpdateToastPayload;
		if (updatePayload.phase === "downloading") {
			return true;
		}

		if (!Notification.isSupported()) {
			return false;
		}

		const notificationKey = [
			updatePayload.phase,
			updatePayload.version,
			updatePayload.detail,
		].join(":");
		if (activeUpdateNotificationKey === notificationKey) {
			return true;
		}

		clearActiveUpdateNotification();
		const notification = new Notification({
			title: getUpdateNotificationTitle(updatePayload),
			body: getUpdateNotificationBody(updatePayload),
			icon: getAppImage(getPlatformAppIconFilename(128)),
			silent: false,
		});

		notification.on("click", () => {
			focusOrCreateMainWindow();
			switch (updatePayload.phase) {
				case "available":
					void downloadAvailableUpdate(sendUpdateToastToWindows, {
						installAfterDownload: true,
					});
					break;
				case "ready":
					installDownloadedUpdateNow(sendUpdateToastToWindows);
					break;
				case "error":
					if (updatePayload.primaryAction === "install-and-restart") {
						void downloadAvailableUpdate(sendUpdateToastToWindows, {
							installAfterDownload: true,
						});
					} else {
						void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
					}
					break;
				default:
					break;
			}
		});

		notification.on("close", () => {
			if (activeUpdateNotification === notification) {
				activeUpdateNotification = null;
				activeUpdateNotificationKey = null;
			}
		});

		notification.show();
		// On Win10, showing a native notification can break setIgnoreMouseEvents
		// forwarding on the transparent HUD overlay.  Re-assert it after a short
		// delay so the renderer's hover detection keeps working.
		reassertHudOverlayMouseState();
		activeUpdateNotification = notification;
		activeUpdateNotificationKey = notificationKey;
		return true;
	}

	if (!payload) {
		const existingWindow = getUpdateToastWindow();
		if (!existingWindow) {
			return false;
		}

		existingWindow.webContents.send(channel, null);
		hideUpdateToastWindow();
		return true;
	}

	const toastWindow = showUpdateToastWindow();
	const sendPayload = () => {
		toastWindow.webContents.send(channel, payload);
		showUpdateToastWindow();
	};

	if (toastWindow.webContents.isLoadingMainFrame()) {
		toastWindow.webContents.once("did-finish-load", sendPayload);
	} else {
		sendPayload();
	}

	return true;
}

function getUpdateDialogWindow() {
	const focusedWindow = BrowserWindow.getFocusedWindow();
	if (focusedWindow && !focusedWindow.isDestroyed()) {
		return focusedWindow;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		return mainWindow;
	}

	return getHudOverlayWindow();
}

ipcMain.handle("install-downloaded-update", () => {
	installDownloadedUpdateNow(sendUpdateToastToWindows);
	return { success: true };
});

ipcMain.handle("download-available-update", (_event, installAfterDownload?: boolean) => {
	return downloadAvailableUpdate(sendUpdateToastToWindows, {
		installAfterDownload: Boolean(installAfterDownload),
	});
});

ipcMain.handle("defer-downloaded-update", (_event, delayMs?: number) => {
	return deferUpdateReminder(getUpdateDialogWindow, sendUpdateToastToWindows, delayMs);
});

ipcMain.handle("dismiss-update-toast", () => {
	return dismissUpdateToast(getUpdateDialogWindow, sendUpdateToastToWindows);
});

ipcMain.handle("skip-update-version", () => {
	return skipAvailableUpdateVersion(sendUpdateToastToWindows);
});

ipcMain.handle("get-current-update-toast-payload", () => {
	return getCurrentUpdateToastPayload();
});

ipcMain.handle("get-update-status-summary", () => {
	return getUpdateStatusSummary();
});

ipcMain.handle("preview-update-toast", () => {
	return { success: previewUpdateToast(sendUpdateToastToWindows) };
});

ipcMain.handle("check-for-app-updates", async () => {
	await checkForAppUpdates(getUpdateDialogWindow, { manual: true });
	return { success: true, logPath: getUpdaterLogPath() };
});

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? getRecordingTrayIcon() : getDefaultTrayIcon();
	const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "Recordly";
	const menuTemplate = recording
		? [
				{
					label: "Show Controls",
					click: () => {
						if (!showHudOverlayFromTray()) {
							focusOrCreateMainWindow();
						}
					},
				},
				{
					label: "Stop Recording",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: "Open",
					click: () => {
						if (!showHudOverlayFromTray()) {
							focusOrCreateMainWindow();
						}
					},
				},
				{
					label: "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	const menu = Menu.buildFromTemplate(menuTemplate);
	trayContextMenu = menu;
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	if (process.platform !== "win32") {
		tray.setContextMenu(menu);
	}
}

function createEditorWindowWrapper() {
	const existingEditorWindow = getExistingEditorWindow();
	if (existingEditorWindow) {
		mainWindow = existingEditorWindow;
		restoreWindowSafely(existingEditorWindow);
		return existingEditorWindow;
	}

	if (isCreatingEditorWindow) {
		const currentWindow = mainWindow;
		if (currentWindow && !currentWindow.isDestroyed()) {
			return currentWindow;
		}

		const currentEditorWindow = getExistingEditorWindow();
		if (currentEditorWindow) {
			mainWindow = currentEditorWindow;
			return currentEditorWindow;
		}
	}

	isCreatingEditorWindow = true;
	const previousWindow = mainWindow;
	if (previousWindow && !previousWindow.isDestroyed()) {
		const closingEditorWindow = isEditorWindow(previousWindow);

		if (closingEditorWindow) {
			closeEditorWindowBypassingUnsavedPrompt(previousWindow);
		} else {
			// It's the HUD or another window. Hide it instead of closing so background
			// tasks (like webcam finalizing) can finish in its renderer process.
			previousWindow.hide();
		}

		if (!closingEditorWindow) {
			isForceClosing = false;
		}
		if (mainWindow === previousWindow) {
			mainWindow = null;
		}
	}
	const editorWindow = createEditorWindow();
	mainWindow = editorWindow;
	editorHasUnsavedChanges = false;

	editorWindow.on("closed", () => {
		if (mainWindow === editorWindow) {
			mainWindow = null;
		}
		isCreatingEditorWindow = false;
		isForceClosing = false;
		editorHasUnsavedChanges = false;
	});

	editorWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) {
			return;
		}

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(editorWindow, {
			type: "warning",
			buttons: ["Save & Close", "Discard & Close", "Cancel"],
			defaultId: 0,
			cancelId: 2,
			title: "Unsaved Changes",
			message: "You have unsaved changes.",
			detail: "Do you want to save your project before closing?",
		});

		if (choice === 0) {
			editorWindow.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_event, saved: boolean) => {
				if (saved) {
					closeEditorWindowBypassingUnsavedPrompt(editorWindow);
				}
			});
		} else if (choice === 1) {
			closeEditorWindowBypassingUnsavedPrompt(editorWindow);
		}
	});

	return editorWindow;
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
let isAppQuitting = false;
app.on("before-quit", () => {
	isAppQuitting = true;
	killWindowsCaptureProcess();
	showCursor();
	cleanupNativeVideoExportSessions();
	void cleanupAllExportStreams();
	stopBridgeServer();
});

app.on("window-all-closed", () => {
	if (IS_SMOKE_EXPORT || process.platform !== "darwin") {
		app.quit();
		return;
	}
	// DEV self-heal: a vite main-process restart (from editing electron/*.ts) or a
	// closed window can leave the app alive with ZERO windows and no visible dock
	// entry — the user sees "the app vanished." In dev, immediately recreate the
	// HOME window so there's always a findable surface. Prod keeps macOS's
	// stay-alive behavior.
	if (!app.isPackaged && !isAppQuitting) {
		createHomeWindow();
	}
});

app.on("activate", () => {
	// Dock-icon click: if nothing is open, bring up the Home window (a normal,
	// findable window — not the easy-to-lose HUD overlay).
	if (BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length === 0) {
		createHomeWindow();
	}
});

// ── Glitchgrab deep-link token handler ───────────────────────
async function handleGlitchgrabDeepLink(url: string) {
	if (!url.startsWith("glitchrecord://")) return;
	try {
		const parsed = new URL(url);
		const token = parsed.searchParams.get("token");
		const userId = parsed.searchParams.get("userId");
		if (!token || !userId) return;

		// Validate token to get the display name
		const user = await validateToken(token);
		saveAuth({ token, userId, name: user?.name ?? "Glitchgrab User" });
		refreshCurrentUserFromStorage();

		const win = BrowserWindow.getAllWindows()[0];
		win?.webContents.send("glitchgrab:auth-changed", getAuthStatus());
		win?.focus();
		console.log("[GlitchBridge] Logged in:", user?.name ?? userId);
	} catch (err) {
		console.error("[GlitchBridge] Deep link parse failed:", err);
	}
}

// macOS delivers deep links via open-url
app.on("open-url", (event, url) => {
	event.preventDefault();
	void handleGlitchgrabDeepLink(url);
});

app.on("second-instance", (_event, argv) => {
	// A 2nd launch focuses whatever's open, or brings up Home if nothing is.
	const open = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
	if (open.length === 0) {
		createHomeWindow();
	} else {
		const existing = getHomeWindow() ?? open[0];
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
	}
	// Windows/Linux deliver deep link as a CLI arg
	const link = argv.find((a) => a.startsWith("glitchrecord://"));
	if (link) void handleGlitchgrabDeepLink(link);
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	if (process.platform === "win32") {
		app.setAppUserModelId("dev.glitchrecord.app");
	}


	// Start GlitchBridge WebSocket server — Chrome extension connects here
	startBridgeServer({
		onScriptReady: (sessionId, script) => {
			BrowserWindow.getAllWindows()[0]?.webContents.send("glitchbridge:script-ready", { sessionId, script });
		},
		onIssueCreated: (sessionId, issueUrl) => {
			BrowserWindow.getAllWindows()[0]?.webContents.send("glitchbridge:issue-created", { sessionId, issueUrl });
		},
		onLiveEvent: (event) => {
			for (const w of BrowserWindow.getAllWindows()) {
				w.webContents.send("glitchbridge:live-event", event);
			}
		},
		onEventsReady: (sessionId, count) => {
			for (const w of BrowserWindow.getAllWindows()) {
				w.webContents.send("glitchbridge:events-ready", { sessionId, count });
			}
		},
	});

	ipcMain.handle("glitchbridge:recording-start", () => {
		// Capture events regardless of login state — auth only needed for issue creation
		const auth = getAuthStatus();
		return broadcastRecordingStart(
			auth.selectedRepoId ?? "",
			auth.selectedRepoName ?? "",
		);
	});
	ipcMain.handle("glitchbridge:recording-stop", (_e, sessionId: string, meta: unknown) => {
		broadcastRecordingStop(sessionId, meta as Parameters<typeof broadcastRecordingStop>[1]);
	});

	// On-demand: generate a DeepSeek narration script from the CURRENT captured
	// events (no recording stop needed). Used by the Narration tab's "Generate
	// script from events" button. Requires login (web endpoint is token-gated).
	ipcMain.handle("glitchbridge:generate-script", async (_e, opts?: { lang?: string; gender?: string }) => {
		const user = getCurrentUser();
		if (!user) return { ok: false, error: "Log in to Glitchgrab first." };
		const session = getCurrentSession();
		const events = session?.events ?? loadPersistedSession().events;
		if (!events?.length) return { ok: false, error: "No captured events yet." };

		appendDebugLog("rec", `generate-script: uploading ${events.length} events (lang=${opts?.lang ?? "hi"})`);
		const dbSessionId = await uploadSession({ events, meta: session?.meta ?? null });
		if (!dbSessionId) return { ok: false, error: "Failed to save capture session." };

		appendDebugLog("rec", `generate-script: calling DeepSeek (session ${dbSessionId})`);
		const result = await generateScript({
			token: user.token,
			sessionId: dbSessionId,
			lang: opts?.lang,
			gender: opts?.gender,
		});
		if ("error" in result) {
			appendDebugLog("rec", `generate-script: failed — ${result.error}`);
			return { ok: false, error: result.error };
		}
		appendDebugLog("rec", `generate-script: got ${result.script.length} chars`);
		return { ok: true, script: result.script };
	});

	// Standalone Narration Tester — paste a script → generate audio, no recording.
	let narrationTesterWindow: BrowserWindow | null = null;
	ipcMain.handle("open-narration-tester", () => {
		if (narrationTesterWindow && !narrationTesterWindow.isDestroyed()) {
			narrationTesterWindow.show();
			narrationTesterWindow.focus();
			return { ok: true };
		}
		const win = new BrowserWindow({
			width: 460,
			height: 580,
			title: "Narration Tester",
			backgroundColor: "#0f0f12",
			webPreferences: {
				preload: path.join(MAIN_DIST, "preload.mjs"),
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		void win.loadFile(path.join(process.env.APP_ROOT ?? process.cwd(), "tts", "narration-tester.html"));
		narrationTesterWindow = win;
		win.on("closed", () => {
			if (narrationTesterWindow === win) narrationTesterWindow = null;
		});
		return { ok: true };
	});

	// Bring back the recorder HUD from the editor ("New Recording" button).
	ipcMain.handle("open-recorder", () => {
		// After the editor opens, `mainWindow` points at the EDITOR, so
		// focusOrCreateMainWindow would just re-focus the editor. Detach it so the
		// call targets (and shows) the HUD recorder instead.
		const editor = getExistingEditorWindow();
		if (mainWindow && isEditorWindow(mainWindow)) mainWindow = null;
		// Close the Home window while recording so it isn't captured in the recording
		// and so window-all-closed bookkeeping stays correct (it reopens afterward via
		// the dev self-heal / dock-click → createHomeWindow).
		getHomeWindow()?.close();
		focusOrCreateMainWindow();
		// Clear the previous recording's captured events so the new session starts clean.
		resetBridgeSession();
		for (const w of BrowserWindow.getAllWindows()) {
			if (!w.isDestroyed()) w.webContents.send("glitchbridge:session-reset");
		}
		// Close the editor so its layout disappears — "New Recording" = fresh start.
		// The captured recording stays on disk; only the in-editor edits are dropped.
		if (editor && !editor.isDestroyed()) closeEditorWindowBypassingUnsavedPrompt(editor);
		return { ok: true };
	});
	// Native clipboard write — reliable in Electron where navigator.clipboard can fail
	ipcMain.handle("clipboard-write-text", (_e, text: string) => {
		clipboard.writeText(typeof text === "string" ? text : String(text));
		return { ok: true };
	});

	// Whether a Sarvam key is already saved in tts/.env (so the UI need not ask for it).
	ipcMain.handle("narration-key-status", async () => {
		try {
			const envPath = path.join(process.env.APP_ROOT ?? process.cwd(), "tts", ".env");
			if (!fssync.existsSync(envPath)) return { hasSarvamKey: false };
			const body = await fs.readFile(envPath, "utf8");
			const hasSarvamKey = body
				.split("\n")
				.some((line) => /^\s*SARVAM_API_KEY\s*=\s*\S+/.test(line));
			return { hasSarvamKey };
		} catch {
			return { hasSarvamKey: false };
		}
	});

	// Generate narration audio from a script via the local TTS (apps/glitchrecord/tts).
	ipcMain.handle(
		"generate-narration",
		async (_e, text: string, opts?: { engine?: string; lang?: string; speaker?: string; voice?: string; apiKey?: string; pace?: number }) => {
			try {
				if (!text || !text.trim()) return { ok: false, error: "Empty script" };
				const ttsDir = path.join(process.env.APP_ROOT ?? process.cwd(), "tts");
				const script = path.join(ttsDir, "narrate.py");
				const venvPy = path.join(ttsDir, ".venv", "bin", "python");
				if (!fssync.existsSync(script)) {
					return { ok: false, error: "narrate.py not found — run the tts/ setup first" };
				}
				const py = fssync.existsSync(venvPy) ? venvPy : "python3";
				const outDir = path.join(app.getPath("userData"), "narrations");
				await fs.mkdir(outDir, { recursive: true });
				const stamp = Date.now();
				const tmpTxt = path.join(outDir, `script-${stamp}.txt`);
				const outWav = path.join(outDir, `narration-${stamp}.wav`);
				await fs.writeFile(tmpTxt, text, "utf8");
				// One "voice" value from the UI; narrate.py reads --voice (supertonic)
				// or --speaker (xtts), so pass it to both — each engine uses its own.
				const voice = opts?.voice ?? opts?.speaker ?? "ritu";
				const args = [
					script,
					"--engine", opts?.engine ?? "sarvam",
					"--lang", opts?.lang ?? "hi",
					"--voice", voice,
					"--speaker", voice,
					"--pace", String(opts?.pace ?? 1.0),
					"--text-file", tmpTxt,
					"--out", outWav,
				];
				appendDebugLog("rec", `narration: spawning ${py} (${text.length} chars)`);
				const sendProgress = (stage: string) => {
					if (!_e.sender.isDestroyed()) _e.sender.send("narration-progress", stage);
				};
				sendProgress("Starting…");
				const childEnv: NodeJS.ProcessEnv = { ...process.env, COQUI_TOS_AGREED: "1" };
				if (opts?.apiKey) childEnv.SARVAM_API_KEY = opts.apiKey;
				const result = await new Promise<{ ok: boolean; path?: string; error?: string }>((resolve) => {
					const child = spawn(py, args, { env: childEnv });
					let out = "";
					let err = "";
					child.stdout.on("data", (d) => { out += d.toString(); });
					child.stderr.on("data", (d) => {
						const s = d.toString();
						err += s;
						// Surface meaningful stages to the UI.
						for (const line of s.split("\n")) {
							const chunk = line.match(/\[narrate\] chunk (\d+)\/(\d+)/);
							if (chunk) {
								const [, i, n] = chunk;
								sendProgress(`Synthesizing ${i}/${n}`);
							} else if (line.includes("loading") || line.includes("downloads")) {
								sendProgress("Loading model…");
							}
						}
					});
					child.on("error", (e) => resolve({ ok: false, error: String(e) }));
					child.on("close", (code) => {
						if (code === 0 && fssync.existsSync(outWav)) {
							resolve({ ok: true, path: out.trim().split("\n").pop() || outWav });
						} else {
							resolve({ ok: false, error: err.slice(-600) || `narrate.py exited ${code}` });
						}
					});
				});
				appendDebugLog("rec", `narration: ${result.ok ? "ok " + result.path : "FAIL " + result.error}`);
				return result;
			} catch (e) {
				return { ok: false, error: String(e) };
			}
		},
	);
	ipcMain.handle("glitchbridge:get-events", () => {
		const session = getCurrentSession();
		// If a session exists for THIS run, always show its events — even if empty.
		// Returning the old persisted session here would display stale events from a
		// completely different recording (e.g. a previous YouTube test).
		if (session) {
			return { events: session.events, sessionId: session.id };
		}
		// No session this run (fresh app start) → fall back to last persisted.
		return loadPersistedSession();
	});

	// ── Glitchgrab auth IPC ──────────────────────────────────
	ipcMain.handle("glitchgrab:login", () => {
		// Open browser to auth flow; deep link returns token to glitchrecord://auth
		const redirect = encodeURIComponent("glitchrecord://auth");
		shell.openExternal(`${GLITCHGRAB_URL}/api/auth/glitchrecord?redirect=${redirect}`);
		return { ok: true };
	});

	ipcMain.handle("glitchgrab:status", () => getAuthStatus());

	ipcMain.handle("glitchgrab:get-repos", () => fetchUserRepos());

	ipcMain.handle("glitchgrab:set-repo", (_e, repoId: string, repoName: string) => {
		setSelectedRepo(repoId, repoName);
		return { ok: true };
	});

	ipcMain.handle("glitchgrab:logout", () => {
		clearAuth();
		refreshCurrentUserFromStorage();
		BrowserWindow.getAllWindows()[0]?.webContents.send("glitchgrab:auth-changed", getAuthStatus());
		return { ok: true };
	});

	// Register deep-link protocol so glitchrecord://auth?token=... reaches us
	if (!app.isDefaultProtocolClient("glitchrecord")) {
		app.setAsDefaultProtocolClient("glitchrecord");
	}

	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		callback(allowed.includes(permission));
	});

	session.defaultSession.setDevicePermissionHandler((_details) => true);

	if (process.platform === "darwin") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		if (cameraStatus !== "granted") {
			await systemPreferences.askForMediaAccess("camera");
		}

		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	} else if (process.platform === "win32") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (cameraStatus !== "granted") {
			console.warn(
				`[permissions] Camera access is "${cameraStatus}" — webcam may not work. Check Windows Settings > Privacy > Camera.`,
			);
		}
		if (micStatus !== "granted") {
			console.warn(
				`[permissions] Microphone access is "${micStatus}" — mic recording may not work. Check Windows Settings > Privacy > Microphone.`,
			);
		}
	}

	ipcMain.on("hud-overlay-close", () => {
		const hud = getHudOverlayWindow();
		if (hud) {
			console.log("[main] Closing HUD window via hud-overlay-close");
			hud.close();
		}

		// If this was the last window (or we are in a state where we should quit), do it.
		// We use a small delay to allow window.close() to propagate.
		setTimeout(() => {
			const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
			if (windows.length === 0) {
				console.log("[main] No windows left, quitting app");
				app.quit();
			}
		}, 100);
	});
	syncDockIcon();
	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	if (!VITE_DEV_SERVER_URL) {
		try {
			await ensurePackagedRendererServer(RENDERER_DIST);
		} catch (error) {
			console.warn("[renderer-server] Failed to start packaged renderer server:", error);
		}
	}

	try {
		await ensureMediaServer();
	} catch (error) {
		console.warn("[media-server] Failed to start media server:", error);
	}

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			setHudOverlayRecordingActive(recording);
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (recording) {
				reassertHudOverlayMouseState();
			}
			if (!recording) {
				restoreWindowSafely(mainWindow);
				// Universal stop hook: tell the GlitchGrab extension to stop capturing,
				// no matter HOW recording ended (HUD button, tray, shortcut, auto-stop).
				const ggSession = getCurrentSession();
				if (ggSession) {
					broadcastRecordingStop(ggSession.id, ggSession.meta ?? ({} as never));
				}
			}
		},
	);

	registerExtensionIpcHandlers();

	if (IS_SMOKE_EXPORT || process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT) {
		await logSmokeExportGpuDiagnostics();
		if (IS_SMOKE_EXPORT) {
			const smokeSource =
				process.env.RECORDLY_SMOKE_EXPORT_PROJECT ??
				process.env.RECORDLY_SMOKE_EXPORT_INPUT ??
				"<missing input>";
			console.log(`[smoke-export] Starting editor smoke export for ${smokeSource}`);
		} else {
			console.log(
				`[dev-open-recording] Starting editor for ${process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT}`,
			);
		}
		createEditorWindowWrapper();
		return;
	}

	// Launch opens the HOME window — a normal, findable window listing the user's
	// recordings/projects with a New Recording button. The HUD recorder bar only
	// appears when recording starts (via open-recorder). We never force the editor
	// open with the last recording.
	createHomeWindow();
	setupAutoUpdates(getUpdateDialogWindow, sendUpdateToastToWindows);

	// Register the display media handler so that renderer's getDisplayMedia()
	// calls land on the pre-selected source without showing a system picker.
	//
	// IMPORTANT: The callback must receive a plain { id, name } Video object.
	// Passing the full DesktopCapturerSource (with thumbnail, appIcon, etc.)
	// via an unsafe cast breaks Electron's internal cursor-constraint
	// propagation and causes cursor: 'never' from the renderer to be silently
	// ignored by the native capture pipeline.
	session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
		try {
			const sourceId = getSelectedSourceId();
			// On Linux/Wayland, calling desktopCapturer.getSources() itself
			// invokes the xdg-desktop-portal picker. If we then return one of
			// those sources, Chromium triggers a SECOND portal because the
			// pre-enumerated source IDs are stale on Wayland. To collapse this
			// into a single portal invocation, when the Linux portal sentinel
			// is set we skip getSources entirely and hand back a synthetic
			// source id; Chromium then opens the portal once to actually
			// resolve the capture.
			// Default to the sentinel on Linux/Wayland when no source has been
			// pre-selected (e.g. fresh session where the renderer skipped the
			// source picker entirely). This avoids calling getSources() which
			// would itself trigger an extra portal dialog.
			// X11 does not need this synthetic path; use Electron's documented
			// desktopCapturer source flow there so getDisplayMedia receives a
			// real source id instead of a Wayland-only portal sentinel.
			const isLinuxPortalSentinel = shouldUseSyntheticLinuxPortalSource({
				env: process.env,
				platform: process.platform,
				sourceId,
			});
			if (isLinuxPortalSentinel) {
				callback({ video: { id: "screen:0:0", name: "Entire screen" } });
				return;
			}
			const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
			const source = sourceId
				? (sources.find((s) => s.id === sourceId) ?? sources[0])
				: sources[0];
			if (source) {
				callback({
					video: { id: source.id, name: source.name },
				});
			} else {
				callback({});
			}
		} catch (error) {
			console.error("setDisplayMediaRequestHandler error:", error);
			callback({});
		}
	});

	const currentToastPayload = getCurrentUpdateToastPayload();
	if (currentToastPayload) {
		sendUpdateToastToWindows("update-toast-state", currentToastPayload);
	}
});
