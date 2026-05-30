import { useEffect, useRef, useState } from "react";
import {
	ArrowRight,
	ArrowsDownUp,
	Clipboard,
	Clock,
	Copy,
	CursorClick,
	Keyboard,
	TextT,
} from "@phosphor-icons/react";

interface LiveEvent {
	type: "click" | "navigate" | "idle" | "input" | "select" | "keydown" | "scroll" | "copy" | "paste";
	t: number;
	label?: string;
	tag?: string;
	url?: string;
	durationMs?: number;
	preview?: string;
}

interface GlitchgrabAPI {
	onLiveEvent: (cb: (event: LiveEvent) => void) => () => void;
}

function gg(): GlitchgrabAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabAPI }).glitchgrab ?? null;
}

function EventIcon({ type }: { type: LiveEvent["type"] }) {
	const cls = "h-3.5 w-3.5 shrink-0 opacity-70";
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

function eventLabel(type: LiveEvent["type"]): string {
	switch (type) {
		case "navigate": return "Navigate";
		case "idle":     return "Idle";
		case "input":    return "Typed";
		case "select":   return "Selected";
		case "keydown":  return "Key";
		case "scroll":   return "Scroll";
		case "copy":     return "Copy";
		case "paste":    return "Paste";
		default:         return "Click";
	}
}

function eventDetail(e: LiveEvent): string {
	switch (e.type) {
		case "navigate": return e.label ?? e.url ?? "";
		case "idle":     return `${Math.round((e.durationMs ?? 0) / 1000)}s`;
		case "input":    return e.preview ? `"${e.preview}"` : (e.label ?? e.tag ?? "field");
		case "select":   return `"${(e.label ?? "").slice(0, 50)}"`;
		case "keydown":  return e.label ?? "";
		case "scroll":   return "";
		case "copy":     return e.label ? `"${e.label.slice(0, 50)}"` : "";
		case "paste":    return "";
		default:         return e.label ?? "element";
	}
}

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	if (m > 0) return `${m}:${String(s % 60).padStart(2, "0")}`;
	return `0:${String(s).padStart(2, "0")}`;
}

const MAX_SHOWN = 40;

export function GlitchgrabEventFeed() {
	const [events, setEvents] = useState<LiveEvent[]>([]);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const unsub = gg()?.onLiveEvent((e) => {
			setEvents((prev) => [...prev.slice(-(MAX_SHOWN - 1)), e]);
		});
		return () => unsub?.();
	}, []);

	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
	}, [events]);

	if (!gg()) return null;

	return (
		<div className="w-[340px] rounded-[12px] border border-[var(--launch-border)] bg-[var(--launch-surface)] text-[var(--launch-text)] p-2.5 shadow-xl">
			<div className="mb-1.5 flex items-center gap-1.5 px-1">
				<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
				<span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
					Capturing events
				</span>
				<span className="ml-auto text-[11px] font-mono opacity-50">{events.length}</span>
			</div>
			<div
				ref={listRef}
				className="max-h-[220px] overflow-y-auto flex flex-col gap-0.5"
				style={{ scrollbarWidth: "thin" }}
			>
				{events.length === 0 ? (
					<div className="px-1 py-3 text-[12px] opacity-40 text-center">
						Interact with the page — events appear here live.
					</div>
				) : (
					events.map((e, i) => {
						const detail = eventDetail(e);
						return (
							<div
								key={`${e.t}-${i}`}
								className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/[0.04]"
							>
								<EventIcon type={e.type} />
								<span className="text-[11px] font-semibold uppercase tracking-wide opacity-50 w-[52px] shrink-0">
									{eventLabel(e.type)}
								</span>
								<span className="flex-1 min-w-0 truncate text-[12px] opacity-90">
									{detail}
								</span>
								<span className="shrink-0 text-[10px] font-mono opacity-30">
									{formatMs(e.t)}
								</span>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
