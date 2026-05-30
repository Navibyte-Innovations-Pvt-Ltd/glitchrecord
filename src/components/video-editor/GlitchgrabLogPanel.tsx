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
	Sparkle,
	TextT,
} from "@phosphor-icons/react";

interface CaptureEvent {
	type: "click" | "navigate" | "idle" | "input" | "select" | "keydown" | "scroll" | "copy" | "paste";
	t: number;
	label?: string;
	tag?: string;
	url?: string;
	durationMs?: number;
	preview?: string;
	meta?: Record<string, string>;
}

interface GlitchgrabAPI {
	getEvents?: () => Promise<{ events: CaptureEvent[]; sessionId: string | null }>;
	onLiveEvent: (cb: (event: CaptureEvent) => void) => () => void;
	onEventsReady?: (cb: (data: { sessionId: string; count: number }) => void) => () => void;
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
		default:         return `Click: ${e.label ?? "element"}`;
	}
}

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${s}s`;
}

export function GlitchgrabLogPanel() {
	const [events, setEvents] = useState<CaptureEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [hasGetEvents, setHasGetEvents] = useState(true);
	const [copied, setCopied] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

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
		void navigator.clipboard.writeText(header + text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
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
		</div>
	);
}
