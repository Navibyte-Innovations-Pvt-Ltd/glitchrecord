import { PencilSimple, Play, Plus, X } from "@phosphor-icons/react";
import { useTimelineContext } from "dnd-timeline";
import { TIMELINE_AXIS_HEIGHT_PX, TIMELINE_ROW_MAX_HEIGHT_PX } from "../../timelineLayout";

/** One intro/outro segment shown as a real block inside the timeline track. */
export interface BookendSide {
	label: string;
	active: boolean;
	/** True while this side's card is playing — sweeps a mini-playhead. */
	playing?: boolean;
	onPlay: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
}

export interface TimelineBookendsProps {
	/** Intro length in composite ms (0 = no intro band, show the add chip). */
	leadInMs: number;
	/** Recording length in ms (the middle band). */
	recMs: number;
	/** Outro length in composite ms (0 = no outro band, show the add chip). */
	tailMs: number;
	intro: BookendSide;
	outro: BookendSide;
	onAddIntro: () => void;
	onAddOutro: () => void;
}

/**
 * Renders the intro/outro as actual timeline segments (flanking the clips in the
 * same coordinate space) instead of detached side gutters. Lives inside the
 * dnd-timeline context so it can map composite ms → pixels exactly like clips.
 */
export default function TimelineBookends({
	leadInMs,
	recMs,
	tailMs,
	intro,
	outro,
	onAddIntro,
	onAddOutro,
}: TimelineBookendsProps) {
	const { sidebarWidth, range, valueToPixels } = useTimelineContext();
	const top = TIMELINE_AXIS_HEIGHT_PX;
	const height = TIMELINE_ROW_MAX_HEIGHT_PX;

	// abs composite ms → left px within the timeline content (after the sidebar).
	const leftAt = (absMs: number) => sidebarWidth + valueToPixels(absMs - range.start);
	const recEndMs = leadInMs + recMs;

	return (
		<div className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
			{leadInMs > 0 ? (
				<BookendBlock
					side={intro}
					kind="intro"
					left={leftAt(0)}
					width={valueToPixels(leadInMs)}
					top={top}
					height={height}
				/>
			) : (
				<AddChip
					label="+ Intro"
					left={leftAt(0)}
					top={top}
					onClick={onAddIntro}
					anchor="left"
				/>
			)}

			{tailMs > 0 ? (
				<BookendBlock
					side={outro}
					kind="outro"
					left={leftAt(recEndMs)}
					width={valueToPixels(tailMs)}
					top={top}
					height={height}
				/>
			) : (
				<AddChip
					label="+ Outro"
					left={leftAt(recEndMs)}
					top={top}
					onClick={onAddOutro}
					anchor="left"
				/>
			)}
		</div>
	);
}

function BookendBlock({
	side,
	kind,
	left,
	width,
	top,
	height,
}: {
	side: BookendSide;
	kind: "intro" | "outro";
	left: number;
	width: number;
	top: number;
	height: number;
}) {
	return (
		<div
			className="pointer-events-auto absolute flex items-center gap-1 overflow-hidden rounded-md border border-[#2563EB]/50 bg-[#2563EB]/25 px-1.5 text-[10px] font-semibold text-white"
			style={{ left, width: Math.max(0, width), top, height }}
		>
			<button
				type="button"
				onClick={side.onPlay}
				className="flex min-w-0 flex-1 items-center gap-1 text-left"
				title={`Play ${kind}`}
			>
				<Play className="h-3 w-3 shrink-0" weight="fill" />
				<span className="truncate">{side.label}</span>
			</button>
			{side.onEdit ? (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						side.onEdit?.();
					}}
					aria-label={`Edit ${kind}`}
					className="shrink-0 rounded bg-black/40 p-0.5 text-white/80 hover:text-white"
				>
					<PencilSimple className="h-3 w-3" weight="bold" />
				</button>
			) : null}
			{side.onDelete ? (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						side.onDelete?.();
					}}
					aria-label={`Delete ${kind}`}
					className="shrink-0 rounded bg-black/40 p-0.5 text-white/80 hover:text-red-400"
				>
					<X className="h-3 w-3" weight="bold" />
				</button>
			) : null}
		</div>
	);
}

function AddChip({
	label,
	left,
	top,
	onClick,
	anchor,
}: {
	label: string;
	left: number;
	top: number;
	onClick: () => void;
	anchor: "left" | "right";
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="pointer-events-auto absolute flex items-center gap-1 rounded-md border border-dashed border-white/25 bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white/70 hover:bg-black/70"
			style={{
				top,
				...(anchor === "left" ? { left } : { left: left - 64 }),
			}}
		>
			<Plus className="h-3 w-3" weight="bold" />
			{label}
		</button>
	);
}
