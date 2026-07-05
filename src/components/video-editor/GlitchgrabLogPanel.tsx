import {
	ArrowClockwise,
	ArrowRight,
	ArrowsDownUp,
	Check,
	Clipboard,
	ClipboardText,
	Clock,
	Copy,
	CursorClick,
	Keyboard,
	NoteBlank,
	Sparkle,
	Stack,
	TextT,
	UserCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { changedRange } from "../../lib/scriptDiff";

interface CaptureEvent {
	type:
		| "click"
		| "navigate"
		| "idle"
		| "input"
		| "select"
		| "keydown"
		| "scroll"
		| "copy"
		| "paste"
		| "note"
		| "mutate";
	t: number;
	label?: string;
	tag?: string;
	url?: string;
	durationMs?: number;
	preview?: string;
	meta?: Record<string, string | number | boolean>;
	note?: string;
	client?: string; // which Chrome profile produced this event (multi-profile capture)
}

interface GlitchgrabAuthStatus {
	loggedIn: boolean;
	name?: string;
	selectedRepoId?: string;
	selectedRepoName?: string;
}

interface GlitchgrabAPI {
	login?: () => Promise<{ ok: boolean }>;
	status?: () => Promise<GlitchgrabAuthStatus>;
	onAuthChanged?: (cb: (status: GlitchgrabAuthStatus) => void) => () => void;
	getEvents?: () => Promise<{ events: CaptureEvent[]; sessionId: string | null }>;
	onLiveEvent: (cb: (event: CaptureEvent) => void) => () => void;
	onEventsReady?: (cb: (data: { sessionId: string; count: number }) => void) => () => void;
	onSessionReset?: (cb: () => void) => () => void;
	onScriptReady?: (cb: (data: { sessionId: string; script: string }) => void) => () => void;
	noteQuestions?: (frames?: Array<{ id: string; dataUrl: string }>) => Promise<{
		ok: boolean;
		questions?: Array<{
			id: string;
			tMs: number;
			label: string;
			question: string;
			options: string[];
		}>;
		error?: string;
	}>;
	generateScript?: (opts?: {
		lang?: string;
		gender?: string;
		durationSec?: number;
		zooms?: Array<{ startMs: number; endMs: number; depth?: number; cx?: number; cy?: number }>;
		noteAnswers?: Array<{ label: string; answer: string }>;
		visualContext?: Array<{ tMs: number; kind: "lead-in" | "idle"; dataUrl: string }>;
	}) => Promise<{ ok: boolean; script?: string; error?: string }>;
	refineScript?: (opts: {
		messages: Array<{ role: "user" | "assistant"; content: string }>;
		currentScript?: string;
		lang?: string;
		gender?: string;
		durationSec?: number;
		zooms?: Array<{ startMs: number; endMs: number; depth?: number; cx?: number; cy?: number }>;
	}) => Promise<{ ok: boolean; reply?: string; script?: string | null; error?: string }>;
}

function gg(): GlitchgrabAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabAPI }).glitchgrab ?? null;
}

function EventIcon({ type }: { type: CaptureEvent["type"] }) {
	const cls = "h-3.5 w-3.5 shrink-0 opacity-60";
	switch (type) {
		case "navigate":
			return <ArrowRight className={cls} />;
		case "idle":
			return <Clock className={cls} />;
		case "input":
			return <Keyboard className={cls} />;
		case "select":
			return <TextT className={cls} />;
		case "keydown":
			return <Keyboard className={cls} />;
		case "scroll":
			return <ArrowsDownUp className={cls} />;
		case "copy":
			return <Copy className={cls} />;
		case "paste":
			return <Clipboard className={cls} />;
		case "note":
			return <NoteBlank className="h-3.5 w-3.5 shrink-0 text-amber-400" weight="fill" />;
		case "mutate":
			return <Stack className={cls} />;
		default:
			return <CursorClick className={cls} />;
	}
}

function eventText(e: CaptureEvent): string {
	switch (e.type) {
		case "navigate":
			return `Navigate → ${e.label ?? e.url ?? ""}`;
		case "idle":
			return `Idle ${Math.round((e.durationMs ?? 0) / 1000)}s`;
		case "input":
			return `Typed in ${e.label ?? e.tag ?? "field"}${e.preview ? `: "${e.preview}"` : ""}`;
		case "select":
			return `Selected: "${(e.label ?? "").slice(0, 40)}"`;
		case "keydown":
			return `Key: ${e.label}`;
		case "scroll":
			return `Scrolled`;
		case "copy":
			return e.label ? `Copied: "${e.label.slice(0, 40)}"` : "Copy";
		case "paste":
			return "Paste";
		case "note":
			return `📌 Explain: ${e.label ?? "this"}`;
		case "mutate":
			return e.label ?? "Bulk change on canvas";
		default:
			return `Click: ${e.label ?? "element"}`;
	}
}

function formatStartSec(sec: number): string {
	const s = Math.max(0, Math.round(sec));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${s}s`;
}

// Distinct hue per Chrome profile, assigned by first-seen order (P1, P2, …).
const PROFILE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];

// Stretches where the presenter talked with NO captured clicks — the recording's
// lead-in (before the extension caught up) and long idle pauses. A screenshot is
// grabbed at each so the AI can narrate what's on screen where events are silent.
const LEAD_IN_MIN_MS = 6000; // ignore a trivial lead-in
const SILENT_GAP_MIN_MS = 10000; // a pause this long between events = worth a frame
const MAX_SILENT_FRAMES = 8; // cost cap on vision frames per generate
function computeSilentGaps(events: CaptureEvent[]): Array<{ tMs: number; kind: "lead-in" | "idle" }> {
	if (events.length === 0) return [];
	const sorted = [...events].sort((a, b) => a.t - b.t);
	const gaps: Array<{ tMs: number; kind: "lead-in" | "idle"; span: number }> = [];
	const firstT = sorted[0].t;
	if (firstT > LEAD_IN_MIN_MS) gaps.push({ tMs: Math.round(firstT / 2), kind: "lead-in", span: firstT });
	for (let i = 0; i < sorted.length - 1; i++) {
		const span = sorted[i + 1].t - sorted[i].t;
		if (span > SILENT_GAP_MIN_MS)
			gaps.push({ tMs: sorted[i].t + Math.round(span / 2), kind: "idle", span });
	}
	// Keep the lead-in + the largest pauses, capped; then restore timeline order.
	return gaps
		.sort((a, b) => (a.kind === "lead-in" ? -1 : b.kind === "lead-in" ? 1 : b.span - a.span))
		.slice(0, MAX_SILENT_FRAMES)
		.sort((a, b) => a.tMs - b.tMs)
		.map(({ tMs, kind }) => ({ tMs, kind }));
}

function hostOf(url?: string): string {
	if (!url) return "";
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

interface ProfileTime {
	client: string;
	label: string; // friendly hostname (e.g. "testing.localhost:3333")
	activeMs: number; // share of the timeline this profile was the active one
	firstT: number; // first appearance — drives P1/P2 ordering
	count: number;
}

// How long each Chrome profile was "active", by attributing every gap between
// consecutive events to the profile that produced the earlier event. The user
// switches profiles mid-recording; this shows where the time actually went.
// Sums to the full recording span. Ordered by first appearance (P1, P2, …).
function computeProfileTimes(events: CaptureEvent[]): ProfileTime[] {
	if (!events.some((e) => e.client)) return [];
	const sorted = [...events].sort((a, b) => a.t - b.t);
	const active = new Map<string, number>();
	const first = new Map<string, number>();
	const count = new Map<string, number>();
	const hostCounts = new Map<string, Map<string, number>>();
	for (let i = 0; i < sorted.length; i++) {
		const e = sorted[i];
		const c = e.client;
		if (!c) continue;
		if (!first.has(c)) first.set(c, e.t);
		count.set(c, (count.get(c) ?? 0) + 1);
		const next = sorted[i + 1];
		active.set(c, (active.get(c) ?? 0) + (next ? Math.max(0, next.t - e.t) : 0));
		const h = hostOf(e.url);
		if (h) {
			const hc = hostCounts.get(c) ?? new Map<string, number>();
			hc.set(h, (hc.get(h) ?? 0) + 1);
			hostCounts.set(c, hc);
		}
	}
	const domHost = (c: string): string => {
		let best = "";
		let bestN = 0;
		for (const [h, n] of hostCounts.get(c) ?? []) if (n > bestN) [best, bestN] = [h, n];
		return best;
	};
	return [...first.keys()]
		.sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0))
		.map((c) => ({
			client: c,
			label: domHost(c) || c.slice(0, 6),
			activeMs: active.get(c) ?? 0,
			firstT: first.get(c) ?? 0,
			count: count.get(c) ?? 0,
		}));
}

// TTS engines + voices — mirror the standalone Narration Tester window so the
// editor panel exposes the same model/voice choices.
const ENGINES: Array<[string, string]> = [
	["sarvam", "Sarvam AI · cloud · native Hinglish"],
	["supertonic", "Supertonic · local · Hindi"],
	["xtts", "XTTS · local · Western"],
];
const VOICES: Record<string, Array<[string, string]>> = {
	sarvam: [
		["ritu", "Ritu (F)"],
		["priya", "Priya (F)"],
		["neha", "Neha (F)"],
		["pooja", "Pooja (F)"],
		["simran", "Simran (F)"],
		["kavya", "Kavya (F)"],
		["aditya", "Aditya (M)"],
		["rahul", "Rahul (M)"],
		["rohan", "Rohan (M)"],
		["shubh", "Shubh (M)"],
		["varun", "Varun (M)"],
		["kabir", "Kabir (M)"],
	],
	supertonic: [
		["F1", "F1 (female)"],
		["F2", "F2 (female)"],
		["F3", "F3 (female)"],
		["M1", "M1 (male)"],
		["M2", "M2 (male)"],
		["M3", "M3 (male)"],
	],
	xtts: [
		["Ana Florence", "Ana (F)"],
		["Daisy Studious", "Daisy (F)"],
		["Andrew Chipper", "Andrew (M)"],
		["Damien Black", "Damien (M)"],
	],
};

// Clipboard fallback for non-Electron / when native IPC is unavailable.
function fallbackCopy(text: string, onDone: () => void) {
	if (navigator.clipboard?.writeText) {
		navigator.clipboard
			.writeText(text)
			.then(onDone)
			.catch(() => execCommandCopy(text, onDone));
		return;
	}
	execCommandCopy(text, onDone);
}

function execCommandCopy(text: string, onDone: () => void) {
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		document.execCommand("copy");
		document.body.removeChild(ta);
		onDone();
	} catch {
		/* give up silently */
	}
}

interface GlitchgrabLogPanelProps {
	/** Live playhead in TIMELINE seconds + play state, updated each frame by the editor. */
	playbackRef?: { current: { timelineTime: number; isPlaying: boolean } };
	timelineDurationSec?: number;
	/** Seek the video to a timeline-time position (seconds). */
	onSeekTimeline?: (sec: number) => void;
	/** Grab a still frame (JPEG data URL) from the raw recording at a recording-time (ms). */
	onCaptureFrame?: (tMs: number) => Promise<string | null>;
	onTogglePlay?: () => void;
	/** Mute the screen-recording audio while sync-previewing the narration. */
	onSetRecordingMuted?: (muted: boolean) => void;
	/** Bake the generated narration into the export as an audio region at startSec. */
	onAddNarrationToTimeline?: (audioPath: string, startSec: number, durationSec: number) => void;
	/** Zoom regions from the editor — fed to the AI as emphasis context. */
	zoomRegions?: Array<{
		startMs: number;
		endMs: number;
		depth?: number;
		focus?: { cx: number; cy: number };
	}>;
	/** Stable per-recording key — script + chat history are saved/restored under it. */
	storageKey?: string;
	/** "log" = Events/Narration tabs; "avatar" = dedicated avatar section (own rail item). */
	view?: "log" | "avatar";
	/** Called when an avatar clip is generated — editor adds it as a PiP overlay. */
	onAvatarReady?: (clipPath: string, shape: "box" | "circle", previewUrl?: string) => void;
	/** Live layout placeholder — show the chosen look as a PiP before generating. */
	onAvatarPreview?: (p: {
		previewUrl: string | null;
		shape: "box" | "circle";
		clearClip?: boolean;
	}) => void;
	/** Live position/size/framing of the avatar PiP overlay. */
	onAvatarSettings?: (patch: {
		positionPreset?: AvatarPositionPreset;
		size?: number;
		framingY?: number;
		muted?: boolean;
	}) => void;
	/** Current avatar-clip mute state (single source of truth — the overlay). The
	 * same value the preview PiP button toggles, so panel + preview never desync. */
	avatarMuted?: boolean;
	/** Spotlight regions (avatar goes full-frame) + add/remove at the playhead. */
	avatarRegions?: Array<{ id: string; startMs: number; endMs: number }>;
	onAddAvatarSpotlight?: (startMs: number) => void;
	onRemoveAvatarSpotlight?: (id: string) => void;
	/** Restored clip path (from the persisted overlay) so the panel preview survives reload. */
	initialAvatarClip?: string | null;
}

type AvatarPositionPreset =
	| "top-left"
	| "top-center"
	| "top-right"
	| "center-left"
	| "center"
	| "center-right"
	| "bottom-left"
	| "bottom-center"
	| "bottom-right";

export function GlitchgrabLogPanel({
	playbackRef,
	timelineDurationSec,
	onSeekTimeline,
	onCaptureFrame,
	onTogglePlay,
	onSetRecordingMuted,
	onAddNarrationToTimeline,
	zoomRegions,
	storageKey,
	view = "log",
	onAvatarReady,
	onAvatarPreview,
	onAvatarSettings,
	avatarRegions,
	onAddAvatarSpotlight,
	onRemoveAvatarSpotlight,
	initialAvatarClip,
	avatarMuted = true,
}: GlitchgrabLogPanelProps = {}) {
	const [events, setEvents] = useState<CaptureEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [hasGetEvents, setHasGetEvents] = useState(true);
	const [copied, setCopied] = useState(false);
	// Sync-preview: where the narration should START in the video (timeline seconds),
	// and whether we're actively keeping the audio aligned to the video playhead.
	const [narrationStartSec, setNarrationStartSec] = useState(0);
	const [syncArmed, setSyncArmed] = useState(false);
	const [narrationPath, setNarrationPath] = useState<string | null>(null);
	const [narrationAdded, setNarrationAdded] = useState(false);
	const syncAudioRef = useRef<HTMLAudioElement | null>(null);
	const [narrationText, setNarrationText] = useState("");
	// AI-written script pushed from the bridge (DeepSeek) when a recording stops.
	// Held aside so it never clobbers what the user typed — surfaced as a button.
	const [aiScript, setAiScript] = useState<string | null>(null);
	// On-demand "generate script from events" (DeepSeek) state.
	const [scriptLoading, setScriptLoading] = useState(false);
	const [scriptError, setScriptError] = useState<string | null>(null);
	// GlitchGrab login state — script writer needs an account; surface a Connect
	// button here so login is reachable from the editor (not just the recorder HUD).
	const [loggedIn, setLoggedIn] = useState<boolean>(false);
	// The script writer lives in a roomy right-side drawer (script is a big chunk).
	const [scriptOpen, setScriptOpen] = useState(false);
	// Per-note clarifying questions (asked before generating, when notes exist).
	const [noteQuestions, setNoteQuestions] = useState<Array<{
		id: string;
		tMs: number;
		label: string;
		question: string;
		options: string[];
	}> | null>(null);
	// Live, transparent progress for the 2-pass note flow (text → screenshots →
	// vision). Shown to the user so the screenshot step is never a black box.
	const [visionProgress, setVisionProgress] = useState<string | null>(null);
	// Per-question: multiple selected options + a free-text addition.
	const [noteAnswers, setNoteAnswers] = useState<Record<string, string[]>>({});
	const [noteText, setNoteText] = useState<Record<string, string>>({});
	// Refine-script chat thread (conversational edits to the script). Assistant
	// turns may carry a `script` (the revised draft) the user can apply.
	const [chatMessages, setChatMessages] = useState<
		Array<{ role: "user" | "assistant"; content: string; script?: string | null }>
	>([]);
	const [chatInput, setChatInput] = useState("");
	const [chatBusy, setChatBusy] = useState(false);
	const [chatError, setChatError] = useState<string | null>(null);
	const chatEndRef = useRef<HTMLDivElement | null>(null);
	const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
	// The main narration <textarea> + a pending [start,end] to highlight after an
	// "Apply to script" so the user is shown exactly what changed.
	const narrationTaRef = useRef<HTMLTextAreaElement | null>(null);
	const pendingHighlightRef = useRef<[number, number] | null>(null);
	const [narrating, setNarrating] = useState(false);
	const [narrationUrl, setNarrationUrl] = useState<string | null>(null);
	const [narrationError, setNarrationError] = useState<string | null>(null);
	const [narrationStage, setNarrationStage] = useState("");
	const [narrationElapsed, setNarrationElapsed] = useState(0);
	const [tab, setTab] = useState<"events" | "narration">("events");

	// ── Avatar (HeyGen talking head) state ──────────────────────
	// Source: your own photo, or a preset from HeyGen's avatar library.
	const [avatarSource, setAvatarSource] = useState<"photo" | "library">(
		() => (localStorage.getItem("gg.avatar.source") as "photo" | "library") || "photo",
	);
	const [avatarPhotoPath, setAvatarPhotoPath] = useState<string | null>(null);
	// HeyGen avatar library = searchable groups (e.g. "Ramisa") → looks.
	const [avatarQuery, setAvatarQuery] = useState("");
	const [avatarGroups, setAvatarGroups] = useState<
		Array<{
			id: string;
			name: string;
			numLooks: number;
			previewUrl?: string;
			isPublic: boolean;
		}>
	>([]);
	const [avatarGroupsLoading, setAvatarGroupsLoading] = useState(false);
	const [avatarGroupsError, setAvatarGroupsError] = useState<string | null>(null);
	const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string } | null>(null);
	const [groupLooks, setGroupLooks] = useState<
		Array<{ id: string; name: string; previewUrl?: string }>
	>([]);
	const [groupLooksLoading, setGroupLooksLoading] = useState(false);
	const [groupLooksError, setGroupLooksError] = useState<string | null>(null);
	const [selectedLookId, setSelectedLookId] = useState<string | null>(null);
	// Captured ONCE at first render (lazy init runs before any effect) so the
	// persistence effects — which clear localStorage when selection is null on
	// mount — can't wipe the saved selection before restore reads it.
	const [savedAvatarSelection] = useState(() => ({
		gid: localStorage.getItem("gg.avatar.groupId"),
		gname: localStorage.getItem("gg.avatar.groupName"),
		lookId: localStorage.getItem("gg.avatar.lookId"),
	}));
	const [avatarTier, setAvatarTier] = useState<"photo" | "iv">(
		() => (localStorage.getItem("gg.avatar.tier") as "photo" | "iv") || "photo",
	);
	// "box" = opaque rounded PiP; "circle" = transparent matte we key out.
	const [avatarShape, setAvatarShape] = useState<"box" | "circle">(
		() => (localStorage.getItem("gg.avatar.shape") as "box" | "circle") || "box",
	);
	const [avatarPosition, setAvatarPosition] = useState<AvatarPositionPreset>(
		() =>
			(localStorage.getItem("gg.avatar.position") as AvatarPositionPreset) || "bottom-right",
	);
	const [avatarSizePct, setAvatarSizePct] = useState<number>(
		() => Number(localStorage.getItem("gg.avatar.size")) || 26,
	);
	const [avatarFramingY, setAvatarFramingY] = useState<number>(() => {
		const v = localStorage.getItem("gg.avatar.framingY");
		return v === null ? 22 : Number(v);
	});
	const [avatarBusy, setAvatarBusy] = useState(false);
	const [avatarStage, setAvatarStage] = useState("");
	const [avatarPath, setAvatarPath] = useState<string | null>(null);
	const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
	const [avatarError, setAvatarError] = useState<string | null>(null);
	const [avatarHasKey, setAvatarHasKey] = useState<boolean | null>(null);
	// "Connect HeyGen account" (OAuth → subscription credits).
	const [heygenAccount, setHeygenAccount] = useState<{
		connected: boolean;
		email?: string;
		plan?: string;
		creditsRemaining?: number;
	} | null>(null);
	const [heygenConnecting, setHeygenConnecting] = useState(false);
	// TTS model/voice settings — restored from localStorage so the user picks once.
	const [engine, setEngine] = useState(() => localStorage.getItem("gg.tts.engine") || "sarvam");
	const [lang, setLang] = useState(() => localStorage.getItem("gg.tts.lang") || "hi");
	const [voice, setVoice] = useState(() => localStorage.getItem("gg.tts.voice") || "ritu");
	const [apiKey, setApiKey] = useState(() => localStorage.getItem("gg.tts.apiKey") || "");
	// Speaking pace (Sarvam): 1.0 normal, higher = faster + shorter audio.
	const [pace, setPace] = useState(() => Number(localStorage.getItem("gg.tts.pace")) || 1.0);
	// True when tts/.env already holds a Sarvam key → no need to paste one.
	const [hasSavedKey, setHasSavedKey] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		electronAPI()
			?.narrationKeyStatus?.()
			.then((s) => setHasSavedKey(!!s?.hasSarvamKey))
			.catch(() => {});
	}, []);

	// Track GlitchGrab login so we can show a Connect button + clear the
	// "log in first" error the moment auth lands (no relaunch needed).
	useEffect(() => {
		const api = gg();
		api?.status?.()
			.then((s) => setLoggedIn(!!s?.loggedIn))
			.catch(() => {});
		const unsub = api?.onAuthChanged?.((s) => {
			setLoggedIn(!!s?.loggedIn);
			if (s?.loggedIn) setScriptError(null);
		});
		return () => unsub?.();
	}, []);

	// Keep voice valid for the selected engine; persist all choices.
	useEffect(() => {
		localStorage.setItem("gg.tts.engine", engine);
		const valid = VOICES[engine] ?? [];
		if (!valid.some(([v]) => v === voice)) setVoice(valid[0]?.[0] ?? "");
	}, [engine, voice]);
	useEffect(() => {
		localStorage.setItem("gg.tts.lang", lang);
	}, [lang]);
	useEffect(() => {
		localStorage.setItem("gg.tts.voice", voice);
	}, [voice]);
	useEffect(() => {
		localStorage.setItem("gg.tts.apiKey", apiKey);
	}, [apiKey]);
	useEffect(() => {
		localStorage.setItem("gg.tts.pace", String(pace));
	}, [pace]);

	const electronAPI = () =>
		(
			window as unknown as {
				electronAPI?: {
					generateNarration?: (
						t: string,
						opts?: {
							engine?: string;
							lang?: string;
							voice?: string;
							apiKey?: string;
							pace?: number;
						},
					) => Promise<{ ok: boolean; path?: string; error?: string }>;
					getLocalMediaUrl?: (p: string) => Promise<{ success: boolean; url?: string }>;
					revealInFolder?: (p: string) => void;
					onNarrationProgress?: (cb: (stage: string) => void) => () => void;
					narrationKeyStatus?: () => Promise<{ hasSarvamKey: boolean }>;
					generateAvatar?: (opts: {
						photoPath?: string;
						avatarId?: string;
						talkingPhotoId?: string;
						useMcp?: boolean;
						audioPath: string;
						tier: "photo" | "iv";
						transparent?: boolean;
					}) => Promise<{
						ok: boolean;
						path?: string;
						format?: "webm" | "mp4";
						error?: string;
					}>;
					avatarKeyStatus?: () => Promise<{ hasKey: boolean }>;
					latestAvatarClip?: () => Promise<{ path: string | null }>;
					heygenMcpStatus?: () => Promise<{ connected: boolean }>;
					heygenMcpConnect?: () => Promise<{
						ok: boolean;
						email?: string;
						plan?: string;
						creditsRemaining?: number;
						error?: string;
					}>;
					heygenMcpUser?: () => Promise<{
						ok: boolean;
						email?: string;
						plan?: string;
						creditsRemaining?: number;
						error?: string;
					}>;
					heygenMcpDisconnect?: () => Promise<{ ok: boolean }>;
					pickAvatarPhoto?: () => Promise<{ path: string | null }>;
					onAvatarProgress?: (cb: (stage: string) => void) => () => void;
					searchAvatarGroups?: (query?: string) => Promise<{
						ok: boolean;
						groups?: Array<{
							id: string;
							name: string;
							numLooks: number;
							previewUrl?: string;
							isPublic: boolean;
						}>;
						error?: string;
					}>;
					listGroupLooks?: (groupId: string) => Promise<{
						ok: boolean;
						looks?: Array<{ id: string; name: string; previewUrl?: string }>;
						error?: string;
					}>;
				};
			}
		).electronAPI;

	// Live stage updates from the TTS process.
	useEffect(() => {
		const unsub = electronAPI()?.onNarrationProgress?.((stage) => setNarrationStage(stage));
		return () => unsub?.();
	}, []);

	// ── Avatar wiring ───────────────────────────────────────────
	useEffect(() => {
		electronAPI()
			?.avatarKeyStatus?.()
			.then((s) => setAvatarHasKey(!!s?.hasKey))
			.catch(() => setAvatarHasKey(false));
		electronAPI()
			?.heygenMcpStatus?.()
			.then((s) => {
				if (!s?.connected) return;
				setHeygenAccount({ connected: true });
				// Already connected → fetch plan + credits to show.
				electronAPI()
					?.heygenMcpUser?.()
					.then((u) => {
						if (u?.ok)
							setHeygenAccount({
								connected: true,
								email: u.email,
								plan: u.plan,
								creditsRemaining: u.creditsRemaining,
							});
					})
					.catch(() => {});
			})
			.catch(() => {});
	}, []);

	const connectHeygenAccount = useCallback(async () => {
		const api = electronAPI();
		if (!api?.heygenMcpConnect) return;
		setHeygenConnecting(true);
		try {
			const r = await api.heygenMcpConnect();
			if (r?.ok) {
				setHeygenAccount({
					connected: true,
					email: r.email,
					plan: r.plan,
					creditsRemaining: r.creditsRemaining,
				});
			}
		} finally {
			setHeygenConnecting(false);
		}
	}, []);

	const disconnectHeygenAccount = useCallback(async () => {
		await electronAPI()?.heygenMcpDisconnect?.();
		setHeygenAccount(null);
	}, []);
	useEffect(() => {
		const unsub = electronAPI()?.onAvatarProgress?.((stage) => setAvatarStage(stage));
		return () => unsub?.();
	}, []);
	useEffect(() => {
		localStorage.setItem("gg.avatar.tier", avatarTier);
	}, [avatarTier]);
	useEffect(() => {
		localStorage.setItem("gg.avatar.shape", avatarShape);
	}, [avatarShape]);
	useEffect(() => {
		localStorage.setItem("gg.avatar.source", avatarSource);
	}, [avatarSource]);
	useEffect(() => {
		localStorage.setItem("gg.avatar.position", avatarPosition);
		onAvatarSettings?.({ positionPreset: avatarPosition });
	}, [avatarPosition, onAvatarSettings]);
	useEffect(() => {
		localStorage.setItem("gg.avatar.size", String(avatarSizePct));
		onAvatarSettings?.({ size: avatarSizePct });
	}, [avatarSizePct, onAvatarSettings]);
	useEffect(() => {
		localStorage.setItem("gg.avatar.framingY", String(avatarFramingY));
		onAvatarSettings?.({ framingY: avatarFramingY });
	}, [avatarFramingY, onAvatarSettings]);
	// Persist the chosen group + look so the selection survives panel remounts.
	useEffect(() => {
		if (selectedGroup) {
			localStorage.setItem("gg.avatar.groupId", selectedGroup.id);
			localStorage.setItem("gg.avatar.groupName", selectedGroup.name);
		} else {
			localStorage.removeItem("gg.avatar.groupId");
			localStorage.removeItem("gg.avatar.groupName");
		}
	}, [selectedGroup]);
	useEffect(() => {
		if (selectedLookId) localStorage.setItem("gg.avatar.lookId", selectedLookId);
		else localStorage.removeItem("gg.avatar.lookId");
	}, [selectedLookId]);

	const searchAvatarGroups = useCallback((query: string) => {
		setAvatarGroupsLoading(true);
		setAvatarGroupsError(null);
		electronAPI()
			?.searchAvatarGroups?.(query)
			.then((r) => {
				if (r?.ok && r.groups) setAvatarGroups(r.groups);
				else setAvatarGroupsError(r?.error || "Could not load avatars");
			})
			.catch((e) =>
				setAvatarGroupsError(e instanceof Error ? e.message : "Could not load avatars"),
			)
			.finally(() => setAvatarGroupsLoading(false));
	}, []);

	// Load groups the first time the user switches to the library.
	useEffect(() => {
		if (avatarSource !== "library" || avatarGroups.length > 0 || avatarGroupsLoading) return;
		searchAvatarGroups("");
	}, [avatarSource, avatarGroups.length, avatarGroupsLoading, searchAvatarGroups]);

	const openAvatarGroup = useCallback(
		(group: { id: string; name: string }, preselectLookId?: string) => {
			setSelectedGroup(group);
			setSelectedLookId(preselectLookId ?? null);
			setGroupLooks([]);
			setGroupLooksLoading(true);
			setGroupLooksError(null);
			electronAPI()
				?.listGroupLooks?.(group.id)
				.then((r) => {
					if (r?.ok && r.looks) {
						setGroupLooks(r.looks);
						// Restore the saved look + re-show its placeholder PiP.
						const look = preselectLookId
							? r.looks.find((l) => l.id === preselectLookId)
							: undefined;
						if (look)
							onAvatarPreview?.({
								previewUrl: look.previewUrl ?? null,
								shape: avatarShape,
							});
					} else setGroupLooksError(r?.error || "Could not load looks");
				})
				.catch((e) =>
					setGroupLooksError(e instanceof Error ? e.message : "Could not load looks"),
				)
				.finally(() => setGroupLooksLoading(false));
		},
		[onAvatarPreview, avatarShape],
	);

	// On mount, restore the previously chosen group + look (so it doesn't reset).
	const restoredAvatarRef = useRef(false);
	useEffect(() => {
		if (restoredAvatarRef.current) return;
		restoredAvatarRef.current = true;
		const { gid, gname, lookId } = savedAvatarSelection;
		if (gid && gname) {
			setAvatarSource("library");
			openAvatarGroup({ id: gid, name: gname }, lookId ?? undefined);
		}
	}, [openAvatarGroup, savedAvatarSelection]);
	// Restore the previously generated clip so the panel preview AND the main PiP
	// survive a reload — no re-generating. Prefer the persisted overlay clip,
	// fall back to our own localStorage copy.
	const restoredClipRef = useRef(false);
	useEffect(() => {
		if (restoredClipRef.current || avatarPath) return;
		restoredClipRef.current = true;
		const fromStorage = storageKey
			? localStorage.getItem(`gg.avatar.clip.${storageKey}`)
			: null;
		const attach = (clip: string) => {
			setAvatarPath(clip);
			onAvatarReady?.(clip, avatarShape); // re-attach to the main overlay
		};
		const known = initialAvatarClip || fromStorage;
		if (known) {
			attach(known);
			return;
		}
		// No in-app reference — recover the most recent clip from disk.
		electronAPI()
			?.latestAvatarClip?.()
			.then((r) => {
				if (r?.path) attach(r.path);
			})
			.catch(() => {});
	}, [initialAvatarClip, avatarPath, storageKey, onAvatarReady, avatarShape]);

	// Persist the generated clip path (panel-side fallback).
	useEffect(() => {
		if (!storageKey || !avatarPath) return;
		localStorage.setItem(`gg.avatar.clip.${storageKey}`, avatarPath);
	}, [avatarPath, storageKey]);

	// Resolve a playable URL for the generated clip preview.
	useEffect(() => {
		if (!avatarPath) {
			setAvatarUrl(null);
			return;
		}
		let alive = true;
		electronAPI()
			?.getLocalMediaUrl?.(avatarPath)
			.then((r) => {
				if (alive && r?.success && r.url) setAvatarUrl(r.url);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [avatarPath]);

	const pickAvatarPhoto = useCallback(async () => {
		const res = await electronAPI()?.pickAvatarPhoto?.();
		if (res?.path) setAvatarPhotoPath(res.path);
	}, []);

	const generateAvatar = useCallback(async () => {
		const api = electronAPI();
		if (!api?.generateAvatar) return;
		const usingLibrary = avatarSource === "library";
		if (usingLibrary && !selectedLookId) {
			setAvatarError("Pick a HeyGen avatar look first");
			return;
		}
		if (!usingLibrary && !avatarPhotoPath) {
			setAvatarError("Choose a photo first");
			return;
		}
		if (!narrationPath) {
			setAvatarError("Generate narration audio first (Narration tab)");
			return;
		}
		setAvatarBusy(true);
		setAvatarError(null);
		setAvatarPath(null);
		setAvatarStage("Starting…");
		try {
			const res = await api.generateAvatar({
				photoPath: usingLibrary ? undefined : (avatarPhotoPath ?? undefined),
				talkingPhotoId: usingLibrary ? (selectedLookId ?? undefined) : undefined,
				// Connected HeyGen account + library look → MCP (subscription credits).
				useMcp: usingLibrary && !!heygenAccount?.connected,
				audioPath: narrationPath,
				tier: avatarTier,
				transparent: avatarShape === "circle",
			});
			if (res.ok && res.path) {
				setAvatarPath(res.path);
				// Push the clip to the editor as a PiP overlay (visible on the video).
				const lookPreview = groupLooks.find((l) => l.id === selectedLookId)?.previewUrl;
				onAvatarReady?.(res.path, avatarShape, lookPreview);
			} else setAvatarError(res.error || "Avatar generation failed");
		} catch (e) {
			setAvatarError(e instanceof Error ? e.message : "Avatar generation failed");
		} finally {
			setAvatarBusy(false);
			setAvatarStage("");
		}
	}, [
		avatarSource,
		avatarPhotoPath,
		selectedLookId,
		groupLooks,
		narrationPath,
		avatarTier,
		avatarShape,
		onAvatarReady,
		heygenAccount?.connected,
	]);

	// AI script arrives from the bridge after a recording stops → stash it and
	// jump to the Narration tab so the "Use AI script" button is visible.
	useEffect(() => {
		const unsub = gg()?.onScriptReady?.((data) => {
			if (data?.script?.trim()) {
				setAiScript(data.script.trim());
				setTab("narration");
				setScriptOpen(true);
			}
		});
		return () => unsub?.();
	}, []);

	// Persist the script + chat history per recording so they survive reopen/crash
	// and switching away. Load on key change; debounce-save after hydration.
	const hydratedKeyRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		hydratedKeyRef.current = undefined;
		if (!storageKey) return;
		try {
			const raw = localStorage.getItem(`gg.script.${storageKey}`);
			if (raw) {
				const d = JSON.parse(raw) as {
					script?: string;
					chat?: typeof chatMessages;
					audioPath?: string | null;
				};
				setNarrationText(typeof d.script === "string" ? d.script : "");
				setChatMessages(Array.isArray(d.chat) ? d.chat : []);
				// Restore the generated audio (player + "Add to video") until a new one is made.
				if (d.audioPath) {
					setNarrationPath(d.audioPath);
					electronAPI()
						?.getLocalMediaUrl?.(d.audioPath)
						.then((m) => setNarrationUrl(m?.success ? (m.url ?? null) : null))
						.catch(() => {});
				} else {
					setNarrationPath(null);
					setNarrationUrl(null);
				}
			} else {
				setNarrationText("");
				setChatMessages([]);
				setNarrationPath(null);
				setNarrationUrl(null);
			}
		} catch {
			/* ignore corrupt storage */
		}
		hydratedKeyRef.current = storageKey;
	}, [storageKey]);
	useEffect(() => {
		if (!storageKey || hydratedKeyRef.current !== storageKey) return;
		const t = setTimeout(() => {
			try {
				localStorage.setItem(
					`gg.script.${storageKey}`,
					JSON.stringify({
						script: narrationText,
						chat: chatMessages,
						audioPath: narrationPath,
					}),
				);
			} catch {
				/* quota / serialize issues — non-fatal */
			}
		}, 800);
		return () => clearTimeout(t);
	}, [storageKey, narrationText, chatMessages, narrationPath]);

	// Elapsed-seconds ticker while generating (XTTS has no clean %, so show time).
	useEffect(() => {
		if (!narrating) return;
		setNarrationElapsed(0);
		const id = setInterval(() => setNarrationElapsed((s) => s + 1), 1000);
		return () => clearInterval(id);
	}, [narrating]);

	// Actually generate the script (with the user's per-note answers, if any).
	const runGenerate = useCallback(
		async (
			answers?: Array<{ label: string; answer: string }>,
			visualContext?: Array<{ tMs: number; kind: "lead-in" | "idle"; dataUrl: string }>,
		) => {
			const api = gg();
			if (!api?.generateScript) return;
			setScriptLoading(true);
			setScriptError(null);
			try {
				const voiceLabel = (VOICES[engine] ?? []).find(([v]) => v === voice)?.[1] ?? "";
				const gender = /\(m\)|male/i.test(voiceLabel) ? "male" : "female";
				const zooms = (zoomRegions ?? []).map((z) => ({
					startMs: z.startMs,
					endMs: z.endMs,
					depth: z.depth,
					cx: z.focus?.cx,
					cy: z.focus?.cy,
				}));
				// Grab screenshots of silent stretches (lead-in + long pauses) so the AI
				// narrates what's on screen where no clicks were captured — e.g. the
				// dashboard the presenter talks over before the first click.
				let visual = visualContext;
				if (!visual && onCaptureFrame) {
					const gaps = computeSilentGaps(events);
					if (gaps.length > 0) {
						setVisionProgress(`📸 Capturing ${gaps.length} silent moment${gaps.length === 1 ? "" : "s"}…`);
						const captured: Array<{ tMs: number; kind: "lead-in" | "idle"; dataUrl: string }> = [];
						for (const g of gaps) {
							const dataUrl = await onCaptureFrame(g.tMs);
							if (dataUrl) captured.push({ tMs: g.tMs, kind: g.kind, dataUrl });
						}
						visual = captured.length ? captured : undefined;
						setVisionProgress(null);
					}
				}
				const res = await api.generateScript({
					lang,
					gender,
					durationSec: timelineDurationSec,
					zooms,
					noteAnswers: answers,
					visualContext: visual,
				});
				if (res.ok && res.script) {
					setNarrationText(res.script);
					setAiScript(res.script);
					setNoteQuestions(null);
				} else {
					setScriptError(res.error ?? "Script generation failed.");
				}
			} catch (e) {
				setScriptError(String(e));
			} finally {
				setScriptLoading(false);
			}
		},
		[engine, voice, lang, timelineDurationSec, zoomRegions, events, onCaptureFrame],
	);

	// Generate from events: if there are shift-marked notes, ASK what to explain
	// at each one first (3 options + free text), then generate using the answers.
	const generateScriptFromEvents = useCallback(async () => {
		const api = gg();
		setScriptError(null);
		setNoteQuestions(null);
		setVisionProgress(null);
		if (!api?.generateScript) {
			setScriptError("Quit & relaunch GlitchRecord — this feature needs a restart.");
			return;
		}
		if (api.noteQuestions) {
			setScriptLoading(true);
			try {
				// PASS 1 — text. Which marked spots stay unclear from labels alone?
				setVisionProgress("Reviewing your marked spots…");
				const q1 = await api.noteQuestions();
				let questions = q1.ok ? (q1.questions ?? []) : [];

				// PASS 2 — vision. For each unclear spot grab a screenshot from the
				// recording at that exact moment and let the AI look BEFORE asking
				// you. Most doubt vanishes once it can see the element.
				if (questions.length > 0 && onCaptureFrame) {
					setVisionProgress(
						`${questions.length} spot${questions.length === 1 ? "" : "s"} unclear — grabbing screenshots…`,
					);
					const frames: Array<{ id: string; dataUrl: string }> = [];
					for (const qq of questions) {
						setVisionProgress(
							`📸 Capturing ${formatMs(qq.tMs)} — “${qq.label.slice(0, 28)}”…`,
						);
						const dataUrl = await onCaptureFrame(qq.tMs);
						if (dataUrl) frames.push({ id: qq.id, dataUrl });
					}
					if (frames.length > 0) {
						setVisionProgress(
							`Sending ${frames.length} screenshot${frames.length === 1 ? "" : "s"} to the AI to review…`,
						);
						const q2 = await api.noteQuestions(frames);
						if (q2.ok && q2.questions) questions = q2.questions;
					}
				}

				if (questions.length > 0) {
					setVisionProgress(null);
					setNoteQuestions(questions);
					setNoteAnswers({});
					setNoteText({});
					setScriptLoading(false);
					return; // wait for the user to answer, then runGenerate
				}
				setVisionProgress(null);
			} catch {
				setVisionProgress(null);
				/* fall through to plain generate */
			}
			setScriptLoading(false);
		}
		await runGenerate();
	}, [runGenerate, onCaptureFrame]);

	// Send a chat instruction to refine the script. Replies with the full revised
	// script → shown in the thread AND synced into the narration box.
	const sendChat = useCallback(async () => {
		const api = gg();
		const text = chatInput.trim();
		if (!text || chatBusy) return;
		if (!api?.refineScript) {
			setChatError("Quit & relaunch GlitchRecord — chat needs a restart.");
			return;
		}
		setChatError(null);
		const voiceLabel = (VOICES[engine] ?? []).find(([v]) => v === voice)?.[1] ?? "";
		const gender = /\(m\)|male/i.test(voiceLabel) ? "male" : "female";
		const zooms = (zoomRegions ?? []).map((z) => ({
			startMs: z.startMs,
			endMs: z.endMs,
			depth: z.depth,
			cx: z.focus?.cx,
			cy: z.focus?.cy,
		}));
		// Send only role+content to the API (strip the local `script` field).
		const apiMessages = [
			...chatMessages.map((m) => ({ role: m.role, content: m.content })),
			{ role: "user" as const, content: text },
		];
		setChatMessages((prev) => [...prev, { role: "user", content: text }]);
		setChatInput("");
		setChatBusy(true);
		try {
			const res = await api.refineScript({
				messages: apiMessages,
				currentScript: narrationText,
				lang,
				gender,
				durationSec: timelineDurationSec,
				zooms,
			});
			if (res.ok) {
				const reply = res.reply?.trim() || (res.script ? "Updated the script." : "");
				setChatMessages((prev) => [
					...prev,
					{ role: "assistant", content: reply, script: res.script ?? null },
				]);
			} else {
				setChatError(res.error ?? "Refine failed.");
			}
		} catch (e) {
			setChatError(String(e));
		} finally {
			setChatBusy(false);
		}
	}, [
		chatInput,
		chatBusy,
		chatMessages,
		narrationText,
		engine,
		voice,
		lang,
		timelineDurationSec,
		zoomRegions,
	]);

	// Keep the chat scrolled to the latest message.
	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [chatMessages, chatBusy]);

	// Apply a refined script AND remember which span changed so the next render can
	// show it (highlight + scroll). Diff is computed against the CURRENT text before
	// it's replaced.
	const applyScript = useCallback(
		(next: string) => {
			pendingHighlightRef.current = changedRange(narrationText, next);
			setNarrationText(next);
		},
		[narrationText],
	);

	// After an Apply re-renders the textarea with the new text, select the changed
	// span (native highlight) and scroll it to roughly a third down the box so the
	// user sees exactly what the edit touched.
	useEffect(() => {
		const range = pendingHighlightRef.current;
		const ta = narrationTaRef.current;
		if (!range || !ta) return;
		pendingHighlightRef.current = null;
		const [start, end] = range;
		ta.focus();
		try {
			ta.setSelectionRange(start, end);
		} catch {
			/* offsets out of range — ignore */
		}
		// Manual scroll: setSelectionRange alone doesn't reliably scroll a textarea.
		const before = narrationText.slice(0, start);
		const line = before.split("\n").length - 1;
		const lineHeight =
			parseFloat(getComputedStyle(ta).lineHeight) || 20;
		ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 3);
	}, [narrationText]);

	// Auto-grow the refine textarea to fit its content (so the long placeholder /
	// typed text isn't clipped and no inner scrollbar shows). Caps at ~6 lines.
	useEffect(() => {
		const el = chatInputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
	}, [chatInput]);

	const generateNarration = useCallback(async () => {
		const api = electronAPI();
		if (!api?.generateNarration || !narrationText.trim()) return;
		if (engine === "sarvam" && !apiKey.trim() && !hasSavedKey) {
			setNarrationError("Sarvam needs an API key — paste one, or save it in tts/.env.");
			return;
		}
		setNarrating(true);
		setNarrationError(null);
		setNarrationUrl(null);
		setNarrationStage("Starting…");
		try {
			const res = await api.generateNarration(narrationText, {
				engine,
				lang,
				voice,
				apiKey: apiKey.trim(),
				pace,
			});
			if (res.ok && res.path) {
				const media = await api.getLocalMediaUrl?.(res.path);
				setNarrationUrl(media?.success ? (media.url ?? null) : null);
				setNarrationPath(res.path);
				setNarrationAdded(false);
				(window as unknown as { __ggNarrationPath?: string }).__ggNarrationPath = res.path;
			} else {
				setNarrationError(res.error ?? "Generation failed");
			}
		} catch (e) {
			setNarrationError(String(e));
		} finally {
			setNarrating(false);
		}
	}, [narrationText, engine, lang, voice, apiKey, pace, hasSavedKey]);

	const copyAll = useCallback(() => {
		if (events.length === 0) return;
		const text = events
			.map((e, i) => {
				const detail = e.preview ? `"${e.preview}"` : (e.label ?? "");
				const head = `${String(i + 1).padStart(2, "0")}. [${formatMs(e.t)}] ${e.type.toUpperCase()}${detail ? `: ${detail}` : ""}`;
				const lines: string[] = [head];
				if (e.durationMs != null)
					lines.push(`      duration: ${Math.round(e.durationMs / 1000)}s`);
				if (e.url) lines.push(`      url: ${e.url}`);
				if (e.meta) {
					for (const [k, v] of Object.entries(e.meta)) {
						if (v) lines.push(`      ${k}: ${v}`);
					}
				}
				return lines.join("\n");
			})
			.join("\n");
		const profiles = computeProfileTimes(events);
		const profileLine =
			profiles.length >= 2
				? `profiles: ${profiles.map((p, i) => `P${i + 1} ${p.label} ${formatMs(p.activeMs)}`).join(" · ")}\n`
				: "";
		const header =
			`GlitchGrab event log\n` +
			`page: ${events.find((e) => e.url)?.url ?? "unknown"}\n` +
			`events: ${events.length}\n` +
			profileLine +
			`${"=".repeat(50)}\n`;
		const payload = header + text;

		const markCopied = () => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		};

		// 1. Electron native clipboard (most reliable in the desktop app)
		const api = (
			window as unknown as {
				electronAPI?: { writeClipboard?: (t: string) => Promise<unknown> };
			}
		).electronAPI;
		if (api?.writeClipboard) {
			void api
				.writeClipboard(payload)
				.then(markCopied)
				.catch(() => fallbackCopy(payload, markCopied));
			return;
		}
		fallbackCopy(payload, markCopied);
	}, [events]);

	const loadEvents = useCallback(() => {
		const api = gg();
		if (!api) {
			setLoading(false);
			return;
		}
		if (typeof api.getEvents !== "function") {
			// Old preload — getEvents not available yet, restart app required
			setHasGetEvents(false);
			setLoading(false);
			return;
		}
		setLoading(true);
		api.getEvents()
			.then(({ events: evts }) => {
				setEvents(evts);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, []);

	// Load on mount
	useEffect(() => {
		loadEvents();
	}, [loadEvents]);

	// Live-append new events during an active recording
	useEffect(() => {
		const unsub = gg()?.onLiveEvent((e) => {
			setEvents((prev) => [...prev, e]);
		});
		return () => unsub?.();
	}, []);

	// Auto-refresh when recording stops and events are uploaded
	useEffect(() => {
		const unsub = gg()?.onEventsReady?.(() => {
			loadEvents();
		});
		return () => unsub?.();
	}, [loadEvents]);

	// "New Recording" pressed → clear the panel immediately
	useEffect(() => {
		const unsub = gg()?.onSessionReset?.(() => {
			setEvents([]);
			setLoading(false);
		});
		return () => unsub?.();
	}, []);

	// Auto-scroll to bottom on new events
	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
	}, [events.length]);

	// ── Sync-preview loop ──────────────────────────────────────────────
	// While armed, keep the narration <audio> aligned to the video playhead:
	// audio position = (timeline playhead) − (narration start). Reads the editor's
	// playbackRef via rAF so there's no per-frame React re-render. Timeline time
	// (not source time) keeps 1× audio correct across speed regions + cuts.
	useEffect(() => {
		if (!syncArmed || !playbackRef) return;
		let raf = 0;
		const tick = () => {
			const audio = syncAudioRef.current;
			const pb = playbackRef.current;
			if (audio && pb) {
				const rel = pb.timelineTime - narrationStartSec;
				const dur = Number.isFinite(audio.duration) ? audio.duration : Infinity;
				if (!pb.isPlaying || rel < 0 || rel > dur) {
					if (!audio.paused) audio.pause();
				} else {
					if (Math.abs(audio.currentTime - rel) > 0.3) audio.currentTime = rel;
					if (audio.paused) audio.play().catch(() => {});
				}
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			syncAudioRef.current?.pause();
		};
	}, [syncArmed, narrationStartSec, playbackRef]);

	// Arming mutes the recording audio and jumps the video to the narration start
	// so the user immediately hears it from the right spot; disarming restores audio.
	const toggleSync = useCallback(() => {
		setSyncArmed((armed) => {
			const next = !armed;
			onSetRecordingMuted?.(next);
			if (next) onSeekTimeline?.(narrationStartSec);
			else syncAudioRef.current?.pause();
			return next;
		});
	}, [onSetRecordingMuted, onSeekTimeline, narrationStartSec]);

	const setStartAtPlayhead = useCallback(() => {
		if (!playbackRef) return;
		const max = timelineDurationSec ?? Infinity;
		setNarrationStartSec(Math.max(0, Math.min(playbackRef.current.timelineTime, max)));
	}, [playbackRef, timelineDurationSec]);

	// Bake the narration into the export: add it as an audio region at the start point.
	const addNarrationToTimeline = useCallback(() => {
		const dur = syncAudioRef.current?.duration;
		if (!narrationPath || !onAddNarrationToTimeline || !dur || !Number.isFinite(dur)) return;
		onAddNarrationToTimeline(narrationPath, narrationStartSec, dur);
		setNarrationAdded(true);
	}, [narrationPath, narrationStartSec, onAddNarrationToTimeline]);

	// Per-profile time split (multi-profile recordings) + a stable color per profile.
	const profileTimes = useMemo(() => computeProfileTimes(events), [events]);
	const multiProfile = profileTimes.length >= 2;
	// The lead-in (recording start → first captured event) is real time the user
	// spent NOT clicking — e.g. talking over the stats. It belongs to no profile,
	// so surface it separately + a total, else the split looks like it lost time.
	const timelineSpan = useMemo(() => {
		if (events.length === 0) return { leadInMs: 0, lastT: 0 };
		let min = Infinity;
		let max = 0;
		for (const e of events) {
			if (e.t < min) min = e.t;
			if (e.t > max) max = e.t;
		}
		return { leadInMs: min === Infinity ? 0 : min, lastT: max };
	}, [events]);
	const totalMs = timelineDurationSec != null ? timelineDurationSec * 1000 : timelineSpan.lastT;
	const clientColor = useMemo(() => {
		const m = new Map<string, string>();
		profileTimes.forEach((p, i) => m.set(p.client, PROFILE_COLORS[i % PROFILE_COLORS.length]));
		return m;
	}, [profileTimes]);
	const clientIndex = useMemo(() => {
		const m = new Map<string, number>();
		profileTimes.forEach((p, i) => m.set(p.client, i + 1));
		return m;
	}, [profileTimes]);

	// Memoized so the per-frame re-renders during playback don't re-map 65+ events.
	// When >1 profile recorded, a colored dot on each row shows which profile it
	// came from — so profile switches are visible right in the timeline.
	const eventListEls = useMemo(
		() =>
			events.map((e, i) => (
				<div
					key={`${e.t}-${i}`}
					className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-foreground/[0.04]"
				>
					{multiProfile && e.client && (
						<span
							className="mt-1 h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: clientColor.get(e.client) ?? "transparent" }}
							title={`Profile ${clientIndex.get(e.client) ?? "?"}`}
						/>
					)}
					<EventIcon type={e.type} />
					<span className="flex-1 min-w-0 truncate text-foreground/80">
						{eventText(e)}
					</span>
					<span className="shrink-0 text-[10px] font-mono text-foreground/30 pt-0.5">
						{formatMs(e.t)}
					</span>
				</div>
			)),
		[events, multiProfile, clientColor, clientIndex],
	);

	if (!gg()) return null;

	return (
		<div className="flex h-full w-[260px] flex-col gap-3 p-4">
			{/* Title */}
			<div className="flex items-center gap-2">
				{view === "avatar" ? (
					<>
						<UserCircle className="h-4 w-4 text-blue-500 shrink-0" />
						<span className="text-[13px] font-semibold">Avatar</span>
					</>
				) : (
					<>
						<Sparkle className="h-4 w-4 text-blue-500 shrink-0" />
						<span className="text-[13px] font-semibold">GlitchGrab</span>
					</>
				)}
			</div>

			{/* Tab bar (log view only — avatar has its own rail item) */}
			{view === "log" && (
				<div className="flex shrink-0 gap-1 rounded-lg bg-foreground/[0.04] p-0.5">
					<button
						type="button"
						onClick={() => setTab("events")}
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
							tab === "events"
								? "bg-foreground/10 text-foreground"
								: "text-foreground/50 hover:text-foreground/80"
						}`}
					>
						<CursorClick className="h-3.5 w-3.5" /> Events
						{events.length > 0 && (
							<span className="font-mono text-[9px] text-foreground/40">
								{events.length}
							</span>
						)}
					</button>
					<button
						type="button"
						onClick={() => setTab("narration")}
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
							tab === "narration"
								? "bg-foreground/10 text-foreground"
								: "text-foreground/50 hover:text-foreground/80"
						}`}
					>
						<Sparkle className="h-3.5 w-3.5" /> Narration
					</button>
				</div>
			)}

			{view === "log" && tab === "events" && (
				<>
					{/* Events tab actions */}
					<div className="flex items-center justify-end gap-1.5">
						<button
							type="button"
							onClick={copyAll}
							disabled={events.length === 0}
							className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground/40 hover:bg-foreground/5 hover:text-foreground/70 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
							title="Copy all events to clipboard"
						>
							{copied ? (
								<>
									<Check className="h-3.5 w-3.5 text-green-500" /> Copied
								</>
							) : (
								<>
									<ClipboardText className="h-3.5 w-3.5" /> Copy
								</>
							)}
						</button>
						<button
							type="button"
							onClick={loadEvents}
							className="rounded p-0.5 text-foreground/30 hover:text-foreground/60 transition-colors"
							title="Refresh"
						>
							<ArrowClockwise className="h-3.5 w-3.5" />
						</button>
					</div>

					{/* Per-profile time split — only for multi-profile recordings (you
					    switched Chrome profiles mid-recording). Shows where the time went. */}
					{multiProfile && (
						<div className="flex shrink-0 flex-col gap-1 rounded-lg border border-foreground/10 bg-foreground/[0.03] p-2 text-[11px]">
							<div className="flex items-center gap-1 font-semibold text-foreground/60">
								<Clock className="h-3 w-3" /> Time per profile
							</div>
							{profileTimes.map((p, i) => (
								<div key={p.client} className="flex items-center gap-1.5">
									<span
										className="h-2 w-2 shrink-0 rounded-full"
										style={{ backgroundColor: PROFILE_COLORS[i % PROFILE_COLORS.length] }}
									/>
									<span className="shrink-0 text-foreground/50">P{i + 1}</span>
									<span className="min-w-0 flex-1 truncate text-foreground/40" title={p.label}>
										{p.label}
									</span>
									<span className="shrink-0 font-mono text-foreground/70">
										{formatMs(p.activeMs)}
									</span>
								</div>
							))}
							{/* Time before the first click (talking / setup) — belongs to no profile. */}
							{timelineSpan.leadInMs > 2000 && (
								<div className="flex items-center gap-1.5 text-foreground/35">
									<span className="h-2 w-2 shrink-0 rounded-full border border-foreground/20" />
									<span className="min-w-0 flex-1 truncate italic">intro — no clicks</span>
									<span className="shrink-0 font-mono">{formatMs(timelineSpan.leadInMs)}</span>
								</div>
							)}
							<div className="mt-0.5 flex items-center gap-1.5 border-t border-foreground/10 pt-1 text-foreground/50">
								<span className="min-w-0 flex-1 truncate font-medium">Total</span>
								<span className="shrink-0 font-mono">{formatMs(totalMs)}</span>
							</div>
						</div>
					)}

					{/* Event list */}
					{loading ? (
						<div className="text-[12px] text-foreground/40">Loading…</div>
					) : !hasGetEvents ? (
						<div className="flex flex-col gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3 text-[12px] text-foreground/50">
							<p className="font-semibold text-foreground/70">Restart required</p>
							<p>Quit and relaunch GlitchRecord to enable event tracking.</p>
						</div>
					) : events.length === 0 ? (
						<div className="flex flex-col gap-3 text-[12px] text-foreground/40">
							<div className="flex flex-col items-center gap-2 py-6 text-center">
								<CursorClick className="h-7 w-7 opacity-20" />
								<p>No events captured yet.</p>
							</div>
							<div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3 text-[11px] leading-relaxed">
								<p className="mb-1 font-semibold text-foreground/60">
									How to capture events:
								</p>
								<ol className="list-decimal pl-4 space-y-1">
									<li>Log in to GlitchGrab (top bar)</li>
									<li>Select a GitHub repo</li>
									<li>Press Record — extension captures automatically</li>
								</ol>
							</div>
						</div>
					) : (
						<div
							ref={listRef}
							className="flex flex-col gap-0.5 overflow-y-auto"
							style={{ scrollbarWidth: "thin" }}
						>
							{eventListEls}
						</div>
					)}
				</>
			)}

			{/* ── Narration generator ─────────────────────────────── */}
			{view === "log" && tab === "narration" && (
				<div
					className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto"
					style={{ scrollbarWidth: "thin" }}
				>
					<div className="flex items-center gap-2">
						<span className="text-[9px] font-mono uppercase tracking-wide text-foreground/30">
							model: {engine}
						</span>
					</div>

					{/* Model + voice pickers (mirror the Narration Tester window) */}
					<div className="flex flex-col gap-1.5">
						<label className="flex flex-col gap-0.5">
							<span className="text-[9px] uppercase tracking-wide text-foreground/40">
								Model
							</span>
							<select
								value={engine}
								onChange={(e) => setEngine(e.target.value)}
								className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
							>
								{ENGINES.map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</select>
						</label>
						<div className="flex gap-1.5">
							<label className="flex flex-1 flex-col gap-0.5 min-w-0">
								<span className="text-[9px] uppercase tracking-wide text-foreground/40">
									Voice
								</span>
								<select
									value={voice}
									onChange={(e) => setVoice(e.target.value)}
									className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
								>
									{(VOICES[engine] ?? []).map(([v, l]) => (
										<option key={v} value={v}>
											{l}
										</option>
									))}
								</select>
							</label>
							<label className="flex flex-col gap-0.5 w-[72px] shrink-0">
								<span className="text-[9px] uppercase tracking-wide text-foreground/40">
									Lang
								</span>
								<select
									value={lang}
									onChange={(e) => setLang(e.target.value)}
									className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
								>
									<option value="hi">Hindi</option>
									<option value="hinglish">Hinglish</option>
									<option value="en">English</option>
								</select>
							</label>
							<label className="flex flex-col gap-0.5 w-[78px] shrink-0">
								<span className="text-[9px] uppercase tracking-wide text-foreground/40">
									Speed
								</span>
								<select
									value={String(pace)}
									onChange={(e) => setPace(Number(e.target.value))}
									className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
									title="Speaking pace — higher = faster + shorter audio (fits a short video)"
								>
									<option value="1">1.0×</option>
									<option value="1.1">1.1×</option>
									<option value="1.2">1.2×</option>
									<option value="1.3">1.3×</option>
									<option value="1.5">1.5×</option>
								</select>
							</label>
						</div>
						{engine === "sarvam" &&
							(hasSavedKey ? (
								<div className="flex items-center gap-1.5 text-[10px] text-green-400/80">
									<Check className="h-3 w-3" /> Sarvam key loaded from tts/.env
								</div>
							) : (
								<input
									type="password"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder="Sarvam API key (dashboard.sarvam.ai)"
									className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
								/>
							))}
					</div>

					{/* Script lives in the right-side Script Writer drawer (a big chunk). */}
					<button
						type="button"
						onClick={() => setScriptOpen(true)}
						className="flex items-center justify-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-300 transition-colors hover:bg-blue-500/20"
						title="Open the AI script writer"
					>
						<Sparkle className="h-3.5 w-3.5" />{" "}
						{narrationText.trim() ? "Open script writer" : "Write script with AI"}
					</button>
					{narrationText.trim() ? (
						<button
							type="button"
							onClick={() => setScriptOpen(true)}
							className="rounded-md border border-foreground/10 bg-foreground/[0.03] p-2 text-left text-[11px] leading-relaxed text-foreground/60 line-clamp-3 hover:border-blue-500/40"
							title="Open script writer to edit"
						>
							{narrationText}
						</button>
					) : (
						<p className="text-[10px] text-foreground/40">
							No script yet — open the writer to generate one from your events.
						</p>
					)}

					<button
						type="button"
						onClick={generateNarration}
						disabled={narrating || !narrationText.trim()}
						className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
					>
						{narrating ? (
							<>
								<ArrowClockwise className="h-3.5 w-3.5 animate-spin" />{" "}
								{narrationStage || "Generating…"} {narrationElapsed}s
							</>
						) : (
							<>
								<Sparkle className="h-3.5 w-3.5" /> Generate narration
							</>
						)}
					</button>
					{narrating && (
						<p className="text-[10px] text-foreground/40 text-center">
							First run loads the model (~20–40s). Later runs are faster.
						</p>
					)}
					{narrationError && (
						<div className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-400 max-h-[60px] overflow-y-auto">
							{narrationError}
						</div>
					)}
					{narrationUrl && (
						<div className="flex flex-col gap-1.5">
							{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
							<audio
								ref={syncAudioRef}
								controls
								src={narrationUrl}
								className="w-full h-8"
							/>

							{/* ── Sync preview: hear narration aligned to the video ── */}
							{playbackRef && (
								<div className="flex flex-col gap-1.5 rounded-md border border-foreground/10 bg-foreground/[0.03] p-2">
									<div className="flex items-center justify-between text-[10px] text-foreground/50">
										<span>Sync preview</span>
										<span className="font-mono">
											starts at {formatStartSec(narrationStartSec)}
										</span>
									</div>
									<div className="flex gap-1.5">
										<button
											type="button"
											onClick={setStartAtPlayhead}
											className="flex-1 rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-foreground/[0.08]"
											title="Set narration start to the current playhead position"
										>
											Set start at playhead
										</button>
										<button
											type="button"
											onClick={() => setNarrationStartSec(0)}
											className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-[11px] text-foreground/50 transition-colors hover:bg-foreground/[0.08]"
											title="Reset start to 0"
										>
											0:00
										</button>
									</div>
									<div className="flex gap-1.5">
										<button
											type="button"
											onClick={toggleSync}
											className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
												syncArmed
													? "bg-green-600 text-white hover:bg-green-500"
													: "bg-blue-600 text-white hover:bg-blue-500"
											}`}
										>
											{syncArmed ? "● Synced — disarm" : "Sync with video"}
										</button>
										{onTogglePlay && (
											<button
												type="button"
												onClick={onTogglePlay}
												className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-foreground/[0.08]"
												title="Play / pause the video"
											>
												▶ / ❚❚
											</button>
										)}
									</div>
									{syncArmed && (
										<p className="text-[9px] leading-snug text-foreground/40">
											Recording audio muted. Hit play — narration speaks from{" "}
											{formatStartSec(narrationStartSec)}. Scrub + "Set start
											at playhead" to move it.
										</p>
									)}
								</div>
							)}

							{/* Bake narration into the video so the export includes it */}
							{onAddNarrationToTimeline && (
								<button
									type="button"
									onClick={addNarrationToTimeline}
									className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
										narrationAdded
											? "bg-green-600/15 text-green-400"
											: "bg-foreground/90 text-background hover:bg-foreground"
									}`}
								>
									{narrationAdded ? (
										<>
											<Check className="h-3.5 w-3.5" /> Added — re-add to
											update
										</>
									) : (
										<>
											＋ Add narration to video (at{" "}
											{formatStartSec(narrationStartSec)})
										</>
									)}
								</button>
							)}
							{narrationAdded && (
								<p className="text-[9px] leading-snug text-foreground/40 text-center">
									On the timeline now — adjust/trim it there, then export. The
									video will include the narration.
								</p>
							)}

							<button
								type="button"
								onClick={() => {
									const p =
										narrationPath ??
										(window as unknown as { __ggNarrationPath?: string })
											.__ggNarrationPath;
									if (p) electronAPI()?.revealInFolder?.(p);
								}}
								className="text-[11px] text-foreground/50 hover:text-foreground/80 transition-colors text-left"
							>
								Reveal file → drag into timeline manually
							</button>
						</div>
					)}
				</div>
			)}
			{view === "avatar" && (
				<div
					className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-1"
					style={{ scrollbarWidth: "thin" }}
				>
					<p className="text-[11px] leading-snug text-foreground/50">
						Add an AI talking-head that lip-syncs your narration. Generate narration
						first, then pick a photo.
					</p>

					{avatarHasKey === false && (
						<p className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-[10px] text-amber-300/90">
							HEYGEN_API_KEY not set — add it to the environment to enable avatar
							generation.
						</p>
					)}

					{/* Provider: connect HeyGen account (subscription credits) */}
					<div className="flex flex-col gap-1 rounded-md border border-foreground/10 bg-foreground/[0.03] p-2">
						{heygenAccount?.connected ? (
							<>
								<div className="flex items-center justify-between text-[11px]">
									<span className="flex items-center gap-1.5 text-emerald-300">
										<Check className="h-3.5 w-3.5" /> HeyGen connected
									</span>
									<button
										type="button"
										onClick={disconnectHeygenAccount}
										className="text-[10px] text-foreground/40 transition-colors hover:text-red-400"
									>
										Disconnect
									</button>
								</div>
								{(heygenAccount.email ||
									heygenAccount.creditsRemaining != null) && (
									<span className="text-[9px] text-foreground/40">
										{heygenAccount.email}
										{heygenAccount.plan ? ` · ${heygenAccount.plan}` : ""}
										{heygenAccount.creditsRemaining != null
											? ` · ${heygenAccount.creditsRemaining} credits`
											: ""}
									</span>
								)}
								<span className="text-[9px] text-foreground/35">
									Generation uses your HeyGen subscription credits.
								</span>
							</>
						) : (
							<>
								<button
									type="button"
									onClick={connectHeygenAccount}
									disabled={heygenConnecting}
									className="flex items-center justify-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-[11px] font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-40"
								>
									{heygenConnecting ? (
										<>
											<ArrowClockwise className="h-3.5 w-3.5 animate-spin" />{" "}
											Waiting for login…
										</>
									) : (
										<>
											<UserCircle className="h-3.5 w-3.5" /> Connect HeyGen
											account
										</>
									)}
								</button>
								<span className="text-[9px] text-foreground/35">
									Optional — use your HeyGen subscription credits (cheaper)
									instead of the platform API key.
								</span>
							</>
						)}
					</div>

					{/* Source: custom photo vs HeyGen library */}
					<div className="flex gap-1 rounded-lg bg-foreground/[0.04] p-0.5">
						{(
							[
								["photo", "Custom photo"],
								["library", "HeyGen avatar"],
							] as const
						).map(([val, label]) => (
							<button
								key={val}
								type="button"
								onClick={() => setAvatarSource(val)}
								className={`flex flex-1 items-center justify-center rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${avatarSource === val ? "bg-foreground/10 text-foreground" : "text-foreground/50 hover:text-foreground/80"}`}
							>
								{label}
							</button>
						))}
					</div>

					{avatarSource === "photo" ? (
						<button
							type="button"
							onClick={pickAvatarPhoto}
							className="flex items-center justify-between rounded-md border border-foreground/10 bg-foreground/[0.04] px-2.5 py-2 text-[11px] text-foreground/70 transition-colors hover:border-foreground/25"
						>
							<span className="flex items-center gap-1.5">
								<UserCircle className="h-3.5 w-3.5" />{" "}
								{avatarPhotoPath ? "Change photo" : "Choose avatar photo"}
							</span>
							{avatarPhotoPath && (
								<span className="max-w-[160px] truncate font-mono text-[9px] text-foreground/40">
									{avatarPhotoPath.split("/").pop()}
								</span>
							)}
						</button>
					) : selectedGroup ? (
						/* Looks inside the chosen group (e.g. Ramisa's 13 looks) */
						<div className="flex flex-col gap-1.5">
							<button
								type="button"
								onClick={() => {
									setSelectedGroup(null);
									setSelectedLookId(null);
								}}
								className="flex items-center gap-1 self-start text-[11px] text-foreground/50 transition-colors hover:text-foreground/80"
							>
								← {selectedGroup.name}
							</button>
							{groupLooksLoading && (
								<p className="flex items-center gap-1.5 text-[11px] text-foreground/50">
									<ArrowClockwise className="h-3 w-3 animate-spin" /> Loading
									looks…
								</p>
							)}
							{groupLooksError && (
								<p className="text-[11px] text-red-400/80">{groupLooksError}</p>
							)}
							{!groupLooksLoading && !groupLooksError && groupLooks.length > 0 && (
								<div
									className="grid max-h-[240px] grid-cols-3 gap-1.5 overflow-y-auto pr-1"
									style={{ scrollbarWidth: "thin" }}
								>
									{groupLooks.map((a) => (
										<button
											key={a.id}
											type="button"
											onClick={() => {
												setSelectedLookId(a.id);
												onAvatarPreview?.({
													previewUrl: a.previewUrl ?? null,
													shape: avatarShape,
													clearClip: true,
												});
											}}
											title={a.name}
											className={`relative aspect-square overflow-hidden rounded-md border transition-colors ${selectedLookId === a.id ? "border-blue-500 ring-1 ring-blue-500" : "border-foreground/10 hover:border-foreground/30"}`}
										>
											{a.previewUrl ? (
												<img
													src={a.previewUrl}
													alt={a.name}
													className="h-full w-full object-cover"
												/>
											) : (
												<span className="flex h-full w-full items-center justify-center p-1 text-[8px] text-foreground/40">
													{a.name}
												</span>
											)}
										</button>
									))}
								</div>
							)}
						</div>
					) : (
						/* Search + group grid (type "Ramisa" to find it) */
						<div className="flex flex-col gap-1.5">
							<input
								type="text"
								value={avatarQuery}
								onChange={(e) => setAvatarQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") searchAvatarGroups(avatarQuery);
								}}
								placeholder="Search avatars (e.g. Ramisa)…"
								className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-[11px] text-foreground/80 placeholder:text-foreground/30 focus:border-blue-500/50 focus:outline-none"
							/>
							{avatarGroupsLoading && (
								<p className="flex items-center gap-1.5 text-[11px] text-foreground/50">
									<ArrowClockwise className="h-3 w-3 animate-spin" /> Loading
									avatars…
								</p>
							)}
							{avatarGroupsError && (
								<p className="text-[11px] text-red-400/80">{avatarGroupsError}</p>
							)}
							{!avatarGroupsLoading && !avatarGroupsError && (
								<div
									className="grid max-h-[240px] grid-cols-3 gap-1.5 overflow-y-auto pr-1"
									style={{ scrollbarWidth: "thin" }}
								>
									{avatarGroups.map((g) => (
										<button
											key={g.id}
											type="button"
											onClick={() => openAvatarGroup(g)}
											title={`${g.name} · ${g.numLooks} looks`}
											className="relative aspect-square overflow-hidden rounded-md border border-foreground/10 transition-colors hover:border-foreground/40"
										>
											{g.previewUrl ? (
												<img
													src={g.previewUrl}
													alt={g.name}
													className="h-full w-full object-cover"
												/>
											) : (
												<span className="flex h-full w-full items-center justify-center p-1 text-[8px] text-foreground/40">
													{g.name}
												</span>
											)}
											<span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[8px] text-white/90">
												{g.name}
											</span>
										</button>
									))}
									{avatarGroups.length === 0 && (
										<p className="col-span-3 text-[11px] text-foreground/40">
											No avatars found.
										</p>
									)}
								</div>
							)}
						</div>
					)}

					<div className="flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-wide text-foreground/40">
							Quality / lip-sync
						</span>
						<div className="flex gap-1 rounded-lg bg-foreground/[0.04] p-0.5">
							{(
								[
									["photo", "Photo Avatar", "~$3 / 3-min"],
									["iv", "Avatar IV", "~$12 / 3-min"],
								] as const
							).map(([val, label, cost]) => (
								<button
									key={val}
									type="button"
									onClick={() => setAvatarTier(val)}
									className={`flex flex-1 flex-col items-center rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${avatarTier === val ? "bg-foreground/10 text-foreground" : "text-foreground/50 hover:text-foreground/80"}`}
								>
									{label}
									<span className="text-[9px] text-foreground/40">{cost}</span>
								</button>
							))}
						</div>
						<span className="text-[9px] text-foreground/35">
							Avatar IV = better lip-sync (esp. non-English), 4× the cost.
						</span>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-wide text-foreground/40">
							Shape
						</span>
						<div className="flex gap-1 rounded-lg bg-foreground/[0.04] p-0.5">
							{(
								[
									["box", "Rounded box"],
									["circle", "Circle (cutout)"],
								] as const
							).map(([val, label]) => (
								<button
									key={val}
									type="button"
									onClick={() => {
										setAvatarShape(val);
										onAvatarPreview?.({
											previewUrl:
												avatarSource === "library"
													? (groupLooks.find(
															(l) => l.id === selectedLookId,
														)?.previewUrl ?? null)
													: null,
											shape: val,
										});
									}}
									className={`flex flex-1 items-center justify-center rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${avatarShape === val ? "bg-foreground/10 text-foreground" : "text-foreground/50 hover:text-foreground/80"}`}
								>
									{label}
								</button>
							))}
						</div>
					</div>

					{/* Audio — play the avatar clip's own synced voice to check lip-sync */}
					<div className="flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-wide text-foreground/40">
							Audio
						</span>
						<button
							type="button"
							onClick={() => onAvatarSettings?.({ muted: !avatarMuted })}
							className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5 text-[11px] text-foreground/80 transition-colors hover:bg-foreground/[0.07]"
						>
							<span className="flex flex-col items-start text-left">
								<span className="font-medium">
									{avatarMuted ? "Avatar muted" : "Avatar voice on"}
								</span>
								<span className="text-[10px] text-foreground/45">
									{avatarMuted
										? "Narration track carries the voice"
										: "Plays the avatar's own synced voice"}
								</span>
							</span>
							<span
								className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${avatarMuted ? "bg-foreground/15" : "bg-blue-500"}`}
							>
								<span
									className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${avatarMuted ? "left-0.5" : "left-3.5"}`}
								/>
							</span>
						</button>
					</div>

					{/* Position — 3×3 preset grid */}
					<div className="flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-wide text-foreground/40">
							Position
						</span>
						<div className="grid w-[84px] grid-cols-3 gap-1">
							{(
								[
									"top-left",
									"top-center",
									"top-right",
									"center-left",
									"center",
									"center-right",
									"bottom-left",
									"bottom-center",
									"bottom-right",
								] as const
							).map((preset) => (
								<button
									key={preset}
									type="button"
									title={preset}
									onClick={() => setAvatarPosition(preset)}
									className={`flex h-6 w-6 rounded border transition-colors ${avatarPosition === preset ? "border-blue-500 bg-blue-500/20" : "border-foreground/15 bg-foreground/[0.04] hover:border-foreground/40"}`}
								>
									<span
										className={`block h-1.5 w-1.5 rounded-[1px] ${avatarPosition === preset ? "bg-blue-400" : "bg-foreground/30"} ${preset.includes("top") ? "self-start" : preset.includes("bottom") ? "self-end" : "self-center"} ${preset.includes("left") ? "mr-auto" : preset.includes("right") ? "ml-auto" : "mx-auto"}`}
									/>
								</button>
							))}
						</div>
					</div>

					{/* Size */}
					<div className="flex flex-col gap-1">
						<span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-foreground/40">
							Size{" "}
							<span className="font-mono text-foreground/50">{avatarSizePct}%</span>
						</span>
						<input
							type="range"
							min={12}
							max={60}
							value={avatarSizePct}
							onChange={(e) => setAvatarSizePct(Number(e.target.value))}
							className="w-full"
						/>
					</div>

					{/* Framing — vertical crop so the face sits in the box */}
					<div className="flex flex-col gap-1">
						<span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-foreground/40">
							Face framing{" "}
							<span className="font-mono text-foreground/50">{avatarFramingY}%</span>
						</span>
						<input
							type="range"
							min={0}
							max={100}
							value={avatarFramingY}
							onChange={(e) => setAvatarFramingY(Number(e.target.value))}
							className="w-full"
						/>
						<span className="text-[9px] text-foreground/35">
							Lower = more of the top. Or <b>Shift+drag</b> the avatar to pan the
							face.
						</span>
					</div>

					{/* Spotlight — avatar grows to full-frame for a moment */}
					<div className="flex flex-col gap-1.5">
						<span className="text-[10px] uppercase tracking-wide text-foreground/40">
							Full-screen moments
						</span>
						<button
							type="button"
							onClick={() => {
								const sec = playbackRef?.current?.timelineTime ?? 0;
								onAddAvatarSpotlight?.(Math.max(0, sec * 1000));
							}}
							className="flex items-center justify-center gap-1.5 rounded-md border border-foreground/15 bg-foreground/[0.04] px-2.5 py-1.5 text-[11px] text-foreground/70 transition-colors hover:border-blue-500/40 hover:text-foreground"
						>
							<UserCircle className="h-3.5 w-3.5" /> Avatar full-screen at playhead
						</button>
						{avatarRegions && avatarRegions.length > 0 && (
							<div className="flex flex-col gap-1">
								{avatarRegions
									.slice()
									.sort((a, b) => a.startMs - b.startMs)
									.map((r) => (
										<div
											key={r.id}
											className="flex items-center justify-between rounded border border-foreground/10 bg-foreground/[0.03] px-2 py-1 text-[10px] text-foreground/60"
										>
											<span className="font-mono">
												{formatStartSec(r.startMs / 1000)} →{" "}
												{formatStartSec(r.endMs / 1000)}
											</span>
											<button
												type="button"
												onClick={() => onRemoveAvatarSpotlight?.(r.id)}
												className="text-foreground/40 transition-colors hover:text-red-400"
												title="Remove"
											>
												✕
											</button>
										</div>
									))}
							</div>
						)}
						<span className="text-[9px] text-foreground/35">
							Avatar slides from the corner to full-screen for ~3s, then back.
						</span>
					</div>

					<button
						type="button"
						onClick={generateAvatar}
						disabled={
							avatarBusy ||
							!narrationPath ||
							(avatarSource === "photo" ? !avatarPhotoPath : !selectedLookId)
						}
						className="flex items-center justify-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[12px] font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-40"
						title={
							!narrationPath
								? "Generate narration audio first"
								: avatarSource === "photo"
									? !avatarPhotoPath
										? "Choose a photo first"
										: "Generate the talking-head avatar"
									: !selectedLookId
										? "Pick a HeyGen avatar look first"
										: "Generate the talking-head avatar"
						}
					>
						{avatarBusy ? (
							<>
								<ArrowClockwise className="h-3.5 w-3.5 animate-spin" />{" "}
								{avatarStage || "Generating…"}
							</>
						) : (
							<>
								<UserCircle className="h-3.5 w-3.5" /> Generate avatar
							</>
						)}
					</button>

					{!narrationPath && (
						<p className="text-[10px] text-foreground/40">
							No narration audio yet — make it in the Narration tab.
						</p>
					)}
					{avatarError && <p className="text-[11px] text-red-400/80">{avatarError}</p>}

					{avatarUrl && (
						<div className="flex flex-col gap-1.5">
							<span className="text-[10px] uppercase tracking-wide text-foreground/40">
								Preview
							</span>
							{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
							<video
								src={avatarUrl}
								controls
								className="w-full rounded-md border border-foreground/10 bg-black"
							/>
							<button
								type="button"
								onClick={() => {
									if (avatarPath) electronAPI()?.revealInFolder?.(avatarPath);
								}}
								className="text-left text-[11px] text-foreground/50 transition-colors hover:text-foreground/80"
							>
								Reveal file →
							</button>
						</div>
					)}
				</div>
			)}

			{view === "log" &&
				!scriptOpen &&
				createPortal(
					<button
						type="button"
						data-testid="gg-script-toggle"
						onClick={() => setScriptOpen(true)}
						title="Open script writer"
						className="absolute right-2 top-2 z-30 flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-background/90 px-2.5 py-1.5 text-[11px] font-medium text-blue-300 shadow-md backdrop-blur transition hover:bg-blue-500/10"
					>
						<Sparkle className="h-3.5 w-3.5" /> Script
					</button>,
					document.getElementById("gg-editor-row") ?? document.body,
				)}
			{scriptOpen &&
				createPortal(
					<div className="gg-selectable flex w-[420px] shrink-0 flex-col rounded-lg border border-foreground/10 bg-background shadow-lg">
						<div className="flex items-center justify-between border-b border-foreground/10 px-3 py-2">
							<span className="flex items-center gap-1.5 text-[13px] font-semibold">
								<Sparkle className="h-4 w-4 text-blue-500" /> Script Writer
							</span>
							<button
								type="button"
								onClick={() => setScriptOpen(false)}
								title="Close"
								className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition hover:bg-foreground/[0.06] hover:text-foreground"
							>
								✕
							</button>
						</div>
						<div
							className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
							style={{ scrollbarWidth: "thin" }}
						>
							<button
								type="button"
								data-testid="gg-generate-script"
								onClick={generateScriptFromEvents}
								disabled={scriptLoading}
								className="flex items-center justify-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[12px] font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-40"
								title="Use AI to write a narration script from the captured events"
							>
								{scriptLoading ? (
									<>
										<ArrowClockwise className="h-3.5 w-3.5 animate-spin" />{" "}
										{visionProgress ? "Working…" : "Writing script…"}
									</>
								) : (
									<>
										<Sparkle className="h-3.5 w-3.5" /> Generate script from
										events
									</>
								)}
							</button>
							{visionProgress && (
								<p
									className="flex items-center gap-1.5 text-[11px] text-blue-300/80"
									data-testid="gg-vision-progress"
								>
									<ArrowClockwise className="h-3 w-3 shrink-0 animate-spin" />{" "}
									{visionProgress}
								</p>
							)}
							{!loggedIn && (
								<button
									type="button"
									onClick={() => gg()?.login?.()}
									className="flex items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
									title="Log in to GlitchGrab to generate scripts and create issues"
								>
									<Sparkle className="h-3.5 w-3.5" /> Connect GlitchGrab
								</button>
							)}
							{scriptError && (
								<p className="text-[11px] text-red-400/80">{scriptError}</p>
							)}
							{noteQuestions && noteQuestions.length > 0 && (
								<div className="flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-3">
									<div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
										<NoteBlank className="h-3.5 w-3.5" weight="fill" />{" "}
										{noteQuestions.length} spot
										{noteQuestions.length === 1 ? " needs" : "s need"} your
										input — what should I explain?
									</div>
									{noteQuestions.map((q) => (
										<div key={q.id} className="flex flex-col gap-1.5">
											<span className="text-[11px] text-foreground/70">
												<span className="text-foreground/40">
													{formatStartSec(q.tMs / 1000)} ·{" "}
												</span>
												{q.question}
											</span>
											<div className="flex flex-wrap gap-1">
												{q.options.map((opt) => {
													const selected = (
														noteAnswers[q.id] ?? []
													).includes(opt);
													return (
														<button
															key={opt}
															type="button"
															onClick={() =>
																setNoteAnswers((p) => {
																	const cur = p[q.id] ?? [];
																	return {
																		...p,
																		[q.id]: cur.includes(opt)
																			? cur.filter(
																					(x) =>
																						x !== opt,
																				)
																			: [...cur, opt],
																	};
																})
															}
															className={
																selected
																	? "rounded-md border border-amber-500/60 bg-amber-500/20 px-2 py-1 text-[10px] text-amber-100"
																	: "rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-[10px] text-foreground/70 hover:border-amber-500/40"
															}
														>
															{selected ? "✓ " : ""}
															{opt}
														</button>
													);
												})}
											</div>
											<input
												type="text"
												value={noteText[q.id] ?? ""}
												onChange={(e) =>
													setNoteText((p) => ({
														...p,
														[q.id]: e.target.value,
													}))
												}
												placeholder="…or add your own (combined with picks above)"
												className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-2 py-1 text-[11px] outline-none focus:border-amber-500/40"
											/>
										</div>
									))}
									<div className="flex items-center gap-1.5">
										<button
											type="button"
											onClick={() =>
												void runGenerate(
													(noteQuestions ?? [])
														.map((q) => ({
															label: q.label,
															answer: [
																...(noteAnswers[q.id] ?? []),
																(noteText[q.id] ?? "").trim(),
															]
																.filter(Boolean)
																.join("; "),
														}))
														.filter((n) => n.answer),
												)
											}
											disabled={scriptLoading}
											className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
										>
											{scriptLoading ? (
												<>
													<ArrowClockwise className="h-3.5 w-3.5 animate-spin" />{" "}
													Writing…
												</>
											) : (
												<>
													<Sparkle className="h-3.5 w-3.5" /> Write script
												</>
											)}
										</button>
										<button
											type="button"
											onClick={() => void runGenerate()}
											disabled={scriptLoading}
											className="rounded-md border border-foreground/10 px-2 py-1.5 text-[11px] text-foreground/60 hover:bg-foreground/[0.06] disabled:opacity-40"
										>
											Skip
										</button>
									</div>
								</div>
							)}
							{aiScript && aiScript !== narrationText.trim() && (
								<button
									type="button"
									data-testid="gg-use-ai-script"
									onClick={() => setNarrationText(aiScript)}
									className="flex items-center gap-1.5 self-start rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-300 transition-colors hover:bg-blue-500/20"
									title="Use the AI-generated script"
								>
									<Sparkle className="h-3 w-3" /> Use AI script
								</button>
							)}
							<textarea
								ref={narrationTaRef}
								data-testid="gg-narration-textarea"
								value={narrationText}
								onChange={(e) => setNarrationText(e.target.value)}
								placeholder="Generate a script from your events, or write your own here…"
								className="min-h-[200px] flex-1 resize-none rounded-md border border-foreground/10 bg-foreground/[0.03] p-3 text-[13px] leading-relaxed outline-none focus:border-blue-500/40"
							/>
							<div className="flex flex-col gap-1.5 rounded-md border border-foreground/10 bg-foreground/[0.02] p-2">
								<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-foreground/40">
									<Sparkle className="h-3 w-3" /> Refine with AI
								</div>
								{chatMessages.length > 0 && (
									<div
										className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto"
										style={{ scrollbarWidth: "thin" }}
									>
										{chatMessages.map((m, i) => (
											<div
												key={i}
												className={
													m.role === "user"
														? "flex flex-col items-end"
														: "flex flex-col items-start"
												}
											>
												<div
													className={
														m.role === "user"
															? "self-end rounded-lg bg-blue-600/80 px-2 py-1 text-[12px] text-white max-w-[85%]"
															: "self-start rounded-lg bg-foreground/[0.06] px-2 py-1 text-[12px] text-foreground/70 max-w-[90%] whitespace-pre-wrap"
													}
												>
													{m.content}
												</div>
												{m.role === "assistant" &&
													m.script &&
													m.script !== narrationText && (
														<button
															type="button"
															data-testid="gg-apply-script"
															onClick={() =>
																applyScript(m.script as string)
															}
															className="mt-1 flex items-center gap-1 self-start rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300 hover:bg-blue-500/20"
														>
															<Sparkle className="h-3 w-3" /> Apply to
															script
														</button>
													)}
											</div>
										))}
										{chatBusy && (
											<div className="self-start flex items-center gap-1.5 text-[11px] text-foreground/40">
												<ArrowClockwise className="h-3 w-3 animate-spin" />{" "}
												Thinking…
											</div>
										)}
										<div ref={chatEndRef} />
									</div>
								)}
								{chatError && (
									<p className="text-[11px] text-red-400/80">{chatError}</p>
								)}
								<div className="flex items-end gap-1.5">
									<textarea
										ref={chatInputRef}
										data-testid="gg-refine-input"
										value={chatInput}
										onChange={(e) => setChatInput(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault();
												void sendChat();
											}
										}}
										placeholder="e.g. explain the OTP step more; intro shorter…"
										rows={2}
										className="flex-1 resize-none overflow-y-auto rounded-md border border-foreground/10 bg-foreground/[0.03] px-2 py-1.5 text-[12px] leading-snug outline-none min-h-[2.6rem] max-h-[120px] focus:border-blue-500/40"
									/>
									<button
										type="button"
										data-testid="gg-refine-send"
										onClick={() => void sendChat()}
										disabled={chatBusy || !chatInput.trim()}
										className="flex items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
									>
										Send
									</button>
								</div>
							</div>
						</div>
					</div>,
					document.getElementById("gg-editor-row") ?? document.body,
				)}
		</div>
	);
}
