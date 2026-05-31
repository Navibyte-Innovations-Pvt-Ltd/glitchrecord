import { useCallback, useEffect, useRef, useState } from "react";
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
	TextT,
} from "@phosphor-icons/react";

interface CaptureEvent {
	type: "click" | "navigate" | "idle" | "input" | "select" | "keydown" | "scroll" | "copy" | "paste" | "note";
	t: number;
	label?: string;
	tag?: string;
	url?: string;
	durationMs?: number;
	preview?: string;
	meta?: Record<string, string>;
	note?: string;
}

interface GlitchgrabAPI {
	getEvents?: () => Promise<{ events: CaptureEvent[]; sessionId: string | null }>;
	onLiveEvent: (cb: (event: CaptureEvent) => void) => () => void;
	onEventsReady?: (cb: (data: { sessionId: string; count: number }) => void) => () => void;
	onSessionReset?: (cb: () => void) => () => void;
}

function gg(): GlitchgrabAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabAPI }).glitchgrab ?? null;
}

function EventIcon({ type }: { type: CaptureEvent["type"] }) {
	const cls = "h-3.5 w-3.5 shrink-0 opacity-60";
	switch (type) {
		case "navigate": return <ArrowRight className={cls} />;
		case "idle":     return <Clock className={cls} />;
		case "input":    return <Keyboard className={cls} />;
		case "select":   return <TextT className={cls} />;
		case "keydown":  return <Keyboard className={cls} />;
		case "scroll":   return <ArrowsDownUp className={cls} />;
		case "copy":     return <Copy className={cls} />;
		case "paste":    return <Clipboard className={cls} />;
		case "note":     return <NoteBlank className="h-3.5 w-3.5 shrink-0 text-amber-400" weight="fill" />;
		default:         return <CursorClick className={cls} />;
	}
}

function eventText(e: CaptureEvent): string {
	switch (e.type) {
		case "navigate": return `Navigate → ${e.label ?? e.url ?? ""}`;
		case "idle":     return `Idle ${Math.round((e.durationMs ?? 0) / 1000)}s`;
		case "input":    return `Typed in ${e.label ?? e.tag ?? "field"}${e.preview ? `: "${e.preview}"` : ""}`;
		case "select":   return `Selected: "${(e.label ?? "").slice(0, 40)}"`;
		case "keydown":  return `Key: ${e.label}`;
		case "scroll":   return `Scrolled`;
		case "copy":     return e.label ? `Copied: "${e.label.slice(0, 40)}"` : "Copy";
		case "paste":    return "Paste";
		case "note":     return `📌 Explain: ${e.label ?? "this"}`;
		default:         return `Click: ${e.label ?? "element"}`;
	}
}

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${s}s`;
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
		["ritu", "Ritu (F)"], ["priya", "Priya (F)"], ["neha", "Neha (F)"],
		["pooja", "Pooja (F)"], ["simran", "Simran (F)"], ["kavya", "Kavya (F)"],
		["aditya", "Aditya (M)"], ["rahul", "Rahul (M)"], ["rohan", "Rohan (M)"],
		["shubh", "Shubh (M)"], ["varun", "Varun (M)"], ["kabir", "Kabir (M)"],
	],
	supertonic: [
		["F1", "F1 (female)"], ["F2", "F2 (female)"], ["F3", "F3 (female)"],
		["M1", "M1 (male)"], ["M2", "M2 (male)"], ["M3", "M3 (male)"],
	],
	xtts: [
		["Ana Florence", "Ana (F)"], ["Daisy Studious", "Daisy (F)"],
		["Andrew Chipper", "Andrew (M)"], ["Damien Black", "Damien (M)"],
	],
};

// Clipboard fallback for non-Electron / when native IPC is unavailable.
function fallbackCopy(text: string, onDone: () => void) {
	if (navigator.clipboard?.writeText) {
		navigator.clipboard.writeText(text).then(onDone).catch(() => execCommandCopy(text, onDone));
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

export function GlitchgrabLogPanel() {
	const [events, setEvents] = useState<CaptureEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [hasGetEvents, setHasGetEvents] = useState(true);
	const [copied, setCopied] = useState(false);
	const [narrationText, setNarrationText] = useState("");
	const [narrating, setNarrating] = useState(false);
	const [narrationUrl, setNarrationUrl] = useState<string | null>(null);
	const [narrationError, setNarrationError] = useState<string | null>(null);
	const [narrationStage, setNarrationStage] = useState("");
	const [narrationElapsed, setNarrationElapsed] = useState(0);
	// TTS model/voice settings — restored from localStorage so the user picks once.
	const [engine, setEngine] = useState(() => localStorage.getItem("gg.tts.engine") || "sarvam");
	const [lang, setLang] = useState(() => localStorage.getItem("gg.tts.lang") || "hi");
	const [voice, setVoice] = useState(() => localStorage.getItem("gg.tts.voice") || "ritu");
	const [apiKey, setApiKey] = useState(() => localStorage.getItem("gg.tts.apiKey") || "");
	const listRef = useRef<HTMLDivElement>(null);

	// Keep voice valid for the selected engine; persist all choices.
	useEffect(() => {
		localStorage.setItem("gg.tts.engine", engine);
		const valid = VOICES[engine] ?? [];
		if (!valid.some(([v]) => v === voice)) setVoice(valid[0]?.[0] ?? "");
	}, [engine, voice]);
	useEffect(() => { localStorage.setItem("gg.tts.lang", lang); }, [lang]);
	useEffect(() => { localStorage.setItem("gg.tts.voice", voice); }, [voice]);
	useEffect(() => { localStorage.setItem("gg.tts.apiKey", apiKey); }, [apiKey]);

	const electronAPI = () =>
		(window as unknown as {
			electronAPI?: {
				generateNarration?: (
					t: string,
					opts?: { engine?: string; lang?: string; voice?: string; apiKey?: string },
				) => Promise<{ ok: boolean; path?: string; error?: string }>;
				getLocalMediaUrl?: (p: string) => Promise<{ success: boolean; url?: string }>;
				revealInFolder?: (p: string) => void;
				onNarrationProgress?: (cb: (stage: string) => void) => () => void;
			};
		}).electronAPI;

	// Live stage updates from the TTS process.
	useEffect(() => {
		const unsub = electronAPI()?.onNarrationProgress?.((stage) => setNarrationStage(stage));
		return () => unsub?.();
	}, []);

	// Elapsed-seconds ticker while generating (XTTS has no clean %, so show time).
	useEffect(() => {
		if (!narrating) return;
		setNarrationElapsed(0);
		const id = setInterval(() => setNarrationElapsed((s) => s + 1), 1000);
		return () => clearInterval(id);
	}, [narrating]);

	const generateNarration = useCallback(async () => {
		const api = electronAPI();
		if (!api?.generateNarration || !narrationText.trim()) return;
		if (engine === "sarvam" && !apiKey.trim()) {
			setNarrationError("Sarvam needs an API key (get from dashboard.sarvam.ai).");
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
			});
			if (res.ok && res.path) {
				const media = await api.getLocalMediaUrl?.(res.path);
				setNarrationUrl(media?.success ? (media.url ?? null) : null);
				(window as unknown as { __ggNarrationPath?: string }).__ggNarrationPath = res.path;
			} else {
				setNarrationError(res.error ?? "Generation failed");
			}
		} catch (e) {
			setNarrationError(String(e));
		} finally {
			setNarrating(false);
		}
	}, [narrationText, engine, lang, voice, apiKey]);

	const copyAll = useCallback(() => {
		if (events.length === 0) return;
		const text = events
			.map((e, i) => {
				const detail = e.preview ? `"${e.preview}"` : (e.label ?? "");
				const head = `${String(i + 1).padStart(2, "0")}. [${formatMs(e.t)}] ${e.type.toUpperCase()}${detail ? `: ${detail}` : ""}`;
				const lines: string[] = [head];
				if (e.durationMs != null) lines.push(`      duration: ${Math.round(e.durationMs / 1000)}s`);
				if (e.url) lines.push(`      url: ${e.url}`);
				if (e.meta) {
					for (const [k, v] of Object.entries(e.meta)) {
						if (v) lines.push(`      ${k}: ${v}`);
					}
				}
				return lines.join("\n");
			})
			.join("\n");
		const header =
			`GlitchGrab event log\n` +
			`page: ${events.find((e) => e.url)?.url ?? "unknown"}\n` +
			`events: ${events.length}\n` +
			`${"=".repeat(50)}\n`;
		const payload = header + text;

		const markCopied = () => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		};

		// 1. Electron native clipboard (most reliable in the desktop app)
		const api = (window as unknown as {
			electronAPI?: { writeClipboard?: (t: string) => Promise<unknown> };
		}).electronAPI;
		if (api?.writeClipboard) {
			void api.writeClipboard(payload).then(markCopied).catch(() => fallbackCopy(payload, markCopied));
			return;
		}
		fallbackCopy(payload, markCopied);
	}, [events]);

	const loadEvents = useCallback(() => {
		const api = gg();
		if (!api) { setLoading(false); return; }
		if (typeof api.getEvents !== "function") {
			// Old preload — getEvents not available yet, restart app required
			setHasGetEvents(false);
			setLoading(false);
			return;
		}
		setLoading(true);
		api.getEvents()
			.then(({ events: evts }) => { setEvents(evts); setLoading(false); })
			.catch(() => setLoading(false));
	}, []);

	// Load on mount
	useEffect(() => { loadEvents(); }, [loadEvents]);

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

	if (!gg()) return null;

	return (
		<div className="flex h-full w-[260px] flex-col gap-3 p-4">
			{/* Header */}
			<div className="flex items-center gap-2">
				<Sparkle className="h-4 w-4 text-blue-500 shrink-0" />
				<span className="text-[13px] font-semibold">GlitchGrab Events</span>
				<div className="ml-auto flex items-center gap-1.5">
					{events.length > 0 && (
						<span className="text-[10px] text-foreground/40 font-mono">{events.length}</span>
					)}
					<button
						type="button"
						onClick={copyAll}
						disabled={events.length === 0}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground/40 hover:bg-foreground/5 hover:text-foreground/70 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
						title="Copy all events to clipboard"
					>
						{copied ? (
							<><Check className="h-3.5 w-3.5 text-green-500" /> Copied</>
						) : (
							<><ClipboardText className="h-3.5 w-3.5" /> Copy</>
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
			</div>

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
						<p className="mb-1 font-semibold text-foreground/60">How to capture events:</p>
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
					{events.map((e, i) => (
						<div
							key={`${e.t}-${i}`}
							className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-foreground/[0.04]"
						>
							<EventIcon type={e.type} />
							<span className="flex-1 min-w-0 truncate text-foreground/80">
								{eventText(e)}
							</span>
							<span className="shrink-0 text-[10px] font-mono text-foreground/30 pt-0.5">
								{formatMs(e.t)}
							</span>
						</div>
					))}
				</div>
			)}

			{/* ── Narration generator ─────────────────────────────── */}
			<div className="mt-auto shrink-0 border-t border-foreground/10 pt-3 flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Sparkle className="h-3.5 w-3.5 text-blue-500" />
					<span className="text-[12px] font-semibold">Narration</span>
					<span className="ml-auto text-[9px] font-mono uppercase tracking-wide text-foreground/30">
						{engine}
					</span>
				</div>

				{/* Model + voice pickers (mirror the Narration Tester window) */}
				<div className="flex flex-col gap-1.5">
					<label className="flex flex-col gap-0.5">
						<span className="text-[9px] uppercase tracking-wide text-foreground/40">Model</span>
						<select
							value={engine}
							onChange={(e) => setEngine(e.target.value)}
							className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
						>
							{ENGINES.map(([v, l]) => (
								<option key={v} value={v}>{l}</option>
							))}
						</select>
					</label>
					<div className="flex gap-1.5">
						<label className="flex flex-1 flex-col gap-0.5 min-w-0">
							<span className="text-[9px] uppercase tracking-wide text-foreground/40">Voice</span>
							<select
								value={voice}
								onChange={(e) => setVoice(e.target.value)}
								className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
							>
								{(VOICES[engine] ?? []).map(([v, l]) => (
									<option key={v} value={v}>{l}</option>
								))}
							</select>
						</label>
						<label className="flex flex-col gap-0.5 w-[72px] shrink-0">
							<span className="text-[9px] uppercase tracking-wide text-foreground/40">Lang</span>
							<select
								value={lang}
								onChange={(e) => setLang(e.target.value)}
								className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
							>
								<option value="hi">Hindi</option>
								<option value="en">Hinglish</option>
							</select>
						</label>
					</div>
					{engine === "sarvam" && (
						<input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="Sarvam API key (dashboard.sarvam.ai)"
							className="w-full rounded-md border border-foreground/10 bg-foreground/[0.03] px-1.5 py-1 text-[11px] outline-none focus:border-blue-500/40"
						/>
					)}
				</div>

				<textarea
					value={narrationText}
					onChange={(e) => setNarrationText(e.target.value)}
					placeholder="Paste your script here (from Claude), then Generate…"
					rows={3}
					className="w-full resize-none rounded-md border border-foreground/10 bg-foreground/[0.03] p-2 text-[11px] leading-relaxed outline-none focus:border-blue-500/40"
				/>
				<button
					type="button"
					onClick={generateNarration}
					disabled={narrating || !narrationText.trim()}
					className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
				>
					{narrating ? (
						<><ArrowClockwise className="h-3.5 w-3.5 animate-spin" /> {narrationStage || "Generating…"} {narrationElapsed}s</>
					) : (
						<><Sparkle className="h-3.5 w-3.5" /> Generate narration</>
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
						<audio controls src={narrationUrl} className="w-full h-8" />
						<button
							type="button"
							onClick={() => {
								const p = (window as unknown as { __ggNarrationPath?: string }).__ggNarrationPath;
								if (p) electronAPI()?.revealInFolder?.(p);
							}}
							className="text-[11px] text-foreground/50 hover:text-foreground/80 transition-colors text-left"
						>
							Reveal file → drag into timeline via Add Layer
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
