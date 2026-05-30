import { useEffect, useRef, useState } from "react";
import { CursorClickIcon, ArrowRightIcon, ClockIcon } from "@phosphor-icons/react";

interface LiveEvent {
	type: "click" | "navigate" | "idle";
	t: number;
	label?: string;
	tag?: string;
	url?: string;
	durationMs?: number;
}

interface GlitchgrabAPI {
	onLiveEvent: (cb: (event: LiveEvent) => void) => () => void;
}

function gg(): GlitchgrabAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabAPI }).glitchgrab ?? null;
}

function eventIcon(type: LiveEvent["type"]) {
	if (type === "navigate") return <ArrowRightIcon size={13} />;
	if (type === "idle") return <ClockIcon size={13} />;
	return <CursorClickIcon size={13} />;
}

function eventText(e: LiveEvent): string {
	if (e.type === "navigate") return `Navigate → ${e.label ?? e.url ?? ""}`;
	if (e.type === "idle") return `Waited ${Math.round((e.durationMs ?? 0) / 1000)}s`;
	return `Click: ${e.label ?? "element"}`;
}

const MAX_SHOWN = 6;

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

	if (!gg() || events.length === 0) return null;

	return (
		<div className="rounded-[11px] border border-[var(--launch-border)] bg-[var(--launch-surface)] text-[var(--launch-text)] p-2 w-[280px]">
			<div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide opacity-50">
				<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
				Capturing events
			</div>
			<div ref={listRef} className="max-h-[140px] overflow-y-auto">
				{events.map((e, i) => (
					<div
						key={`${e.t}-${i}`}
						className="flex items-center gap-2 px-1 py-1 text-[12px]"
					>
						<span className="shrink-0 opacity-60">{eventIcon(e.type)}</span>
						<span className="truncate">{eventText(e)}</span>
					</div>
				))}
			</div>
		</div>
	);
}
