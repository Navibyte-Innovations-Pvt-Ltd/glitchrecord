import { useEffect, useRef, useState } from "react";
import {
	ArrowRight,
	ArrowsDownUp,
	Clipboard,
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
}

interface GlitchgrabAPI {
	getEvents: () => Promise<{ events: CaptureEvent[]; sessionId: string | null }>;
	onLiveEvent: (cb: (event: CaptureEvent) => void) => () => void;
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
	const listRef = useRef<HTMLDivElement>(null);

	// Load existing events once
	useEffect(() => {
		const api = gg();
		if (!api) { setLoading(false); return; }
		api.getEvents().then(({ events: evts }) => {
			setEvents(evts);
			setLoading(false);
		}).catch(() => setLoading(false));
	}, []);

	// Live-append new events during an active recording
	useEffect(() => {
		const unsub = gg()?.onLiveEvent((e) => {
			setEvents((prev) => [...prev, e]);
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
				{events.length > 0 && (
					<span className="ml-auto text-[10px] text-foreground/40 font-mono">
						{events.length}
					</span>
				)}
			</div>

			{/* Event list */}
			{loading ? (
				<div className="text-[12px] text-foreground/40">Loading…</div>
			) : events.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
					<CursorClick className="h-8 w-8 opacity-20" />
					<p className="text-[12px] text-foreground/40">
						No events yet. Start a recording with the GlitchGrab extension active.
					</p>
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
