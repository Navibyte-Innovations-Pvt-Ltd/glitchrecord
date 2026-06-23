import {
	FilmStrip as FilmIcon,
	MusicNotes as MusicIcon,
	Trash as TrashIcon,
	UploadSimple as UploadIcon,
	X as XIcon,
} from "@phosphor-icons/react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CardPreview } from "./CardPreview";
import {
	BUILTIN_TRACKS,
	type CardAudio,
	type CardBackground,
	type CardLayout,
	type CardText,
	INTRO_OUTRO_MAX_DURATION_MS,
	INTRO_OUTRO_MAX_SIZE,
	INTRO_OUTRO_MIN_DURATION_MS,
	INTRO_OUTRO_MIN_SIZE,
	type IntroOutroConfig,
	type IntroOutroMode,
	type IntroOutroPosition,
	type IntroOutroPreset,
	type IntroOutroSideConfig,
	type LogoContainerStyle,
} from "./introOutroTypes";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const PRESETS: { value: IntroOutroPreset; label: string }[] = [
	{ value: "fade", label: "Fade" },
	{ value: "scale-pop", label: "Pop" },
	{ value: "slide", label: "Slide" },
	{ value: "glitch", label: "Glitch" },
];
const LAYOUTS: { value: CardLayout; label: string }[] = [
	{ value: "logo-top", label: "Logo + text" },
	{ value: "logo-left", label: "Side by side" },
	{ value: "logo-only", label: "Logo only" },
	{ value: "text-only", label: "Text only" },
];
const POSITIONS: { value: IntroOutroPosition; label: string }[] = [
	{ value: "center", label: "Center" },
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
];
const CONTAINERS: { value: LogoContainerStyle; label: string }[] = [
	{ value: "panel", label: "Card" },
	{ value: "rounded", label: "Rounded" },
	{ value: "none", label: "None" },
];

interface IntroStudioModalProps {
	open: boolean;
	onClose: () => void;
	config: IntroOutroConfig;
	onChange: (next: IntroOutroConfig) => void;
	activeTab: "intro" | "outro";
	onTabChange: (tab: "intro" | "outro") => void;
}

export function IntroStudioModal({
	open,
	onClose,
	config,
	onChange,
	activeTab,
	onTabChange,
}: IntroStudioModalProps) {
	if (!open) return null;

	const side = config[activeTab];
	const setSide = (patch: Partial<IntroOutroSideConfig>) => {
		onChange({ ...config, [activeTab]: { ...side, ...patch } });
	};
	const setBackground = (patch: Partial<CardBackground>) => {
		setSide({ background: { ...side.background, ...patch } });
	};
	const setText = (patch: Partial<CardText>) => {
		setSide({ text: { ...side.text, ...patch } });
	};
	const setAudio = (patch: Partial<CardAudio>) => {
		setSide({ audio: { ...side.audio, ...patch } });
	};

	return createPortal(
		<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
			<div className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-editor-surface text-foreground shadow-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-foreground/10 px-5 py-3">
					<div className="flex items-center gap-3">
						<span className="text-sm font-semibold">Intro / Outro Studio</span>
						<div className="flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
							{(["intro", "outro"] as const).map((tab) => (
								<button
									key={tab}
									type="button"
									onClick={() => onTabChange(tab)}
									className={cn(
										"flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
										activeTab === tab
											? "bg-[#2563EB] text-white"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{tab}
									<span
										className={cn(
											"h-1.5 w-1.5 rounded-full",
											config[tab].enabled
												? "bg-emerald-400"
												: "bg-foreground/20",
										)}
									/>
								</button>
							))}
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
					>
						<XIcon className="h-4 w-4" />
					</button>
				</div>

				<div className="flex min-h-0 flex-1">
					{/* Left: preview + mode + enable */}
					<div className="flex w-1/2 flex-col gap-3 border-r border-foreground/10 p-5">
						<div className="flex items-center justify-between">
							<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								{activeTab} preview
							</span>
							<label className="flex items-center gap-2 text-xs text-muted-foreground">
								Enabled
								<Switch
									checked={side.enabled}
									onCheckedChange={(c) => setSide({ enabled: c })}
									className="scale-90 data-[state=checked]:bg-[#2563EB]"
								/>
							</label>
						</div>

						{/* Mode toggle */}
						<div className="grid grid-cols-2 gap-1 rounded-xl border border-foreground/10 bg-foreground/5 p-1">
							{(
								[
									{ value: "card", label: "Logo card", icon: MusicIcon },
									{ value: "video", label: "Video clip", icon: FilmIcon },
								] as const
							).map((opt) => (
								<button
									key={opt.value}
									type="button"
									onClick={() => setSide({ mode: opt.value as IntroOutroMode })}
									className={cn(
										"rounded-lg py-2 text-xs font-medium transition-colors",
										side.mode === opt.value
											? "bg-[#2563EB] text-white"
											: "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
									)}
								>
									{opt.label}
								</button>
							))}
						</div>

						{side.mode === "card" ? (
							<div className="overflow-hidden rounded-xl border border-foreground/10">
								<CardPreview
									side={side}
									logoDataUrl={config.logoDataUrl}
									width={640}
									height={360}
								/>
							</div>
						) : (
							<VideoModePreview side={side} onChange={setSide} />
						)}
					</div>

					{/* Right: controls */}
					<div className="w-1/2 overflow-y-auto p-5">
						{side.mode === "video" ? (
							<AudioSection audio={side.audio} setAudio={setAudio} />
						) : (
							<div className="space-y-5">
								<LogoRow config={config} onChange={onChange} />
								<Section title="Layout">
									<ChipRow
										options={LAYOUTS}
										value={side.layout}
										onSelect={(layout) => setSide({ layout })}
									/>
								</Section>
								<Section title="Brand text">
									<input
										type="text"
										placeholder="Brand name"
										value={side.text.brandName}
										onChange={(e) => setText({ brandName: e.target.value })}
										className="mb-2 w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm outline-none focus:border-[#2563EB]/50"
									/>
									<input
										type="text"
										placeholder="Tagline"
										value={side.text.tagline}
										onChange={(e) => setText({ tagline: e.target.value })}
										className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm outline-none focus:border-[#2563EB]/50"
									/>
									<ColorField
										label="Text color"
										value={side.text.color}
										onChange={(color) => setText({ color })}
									/>
								</Section>
								<Section title="Animation">
									<ChipRow
										options={PRESETS}
										value={side.preset}
										onSelect={(preset) => setSide({ preset })}
									/>
								</Section>
								<Section title="Position">
									<ChipRow
										options={POSITIONS}
										value={side.position}
										onSelect={(position) => setSide({ position })}
									/>
								</Section>
								<Section title="Logo container">
									<ChipRow
										options={CONTAINERS}
										value={side.logoContainer}
										onSelect={(logoContainer) => setSide({ logoContainer })}
									/>
								</Section>
								<Section title="Background">
									<div className="mb-2 flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
										{(["gradient", "solid"] as const).map((type) => (
											<button
												key={type}
												type="button"
												onClick={() => setBackground({ type })}
												className={cn(
													"flex-1 rounded-md py-1 text-xs font-medium capitalize transition-colors",
													side.background.type === type
														? "bg-[#2563EB] text-white"
														: "text-muted-foreground hover:text-foreground",
												)}
											>
												{type}
											</button>
										))}
									</div>
									<ColorField
										label={
											side.background.type === "gradient"
												? "Color 1"
												: "Color"
										}
										value={side.background.color1}
										onChange={(color1) => setBackground({ color1 })}
									/>
									{side.background.type === "gradient" ? (
										<>
											<ColorField
												label="Color 2"
												value={side.background.color2}
												onChange={(color2) => setBackground({ color2 })}
											/>
											<SliderRow
												label="Angle"
												valueLabel={`${Math.round(side.background.angle)}°`}
												min={0}
												max={360}
												step={5}
												value={side.background.angle}
												onValueChange={(angle) => setBackground({ angle })}
											/>
										</>
									) : null}
								</Section>
								<Section title="Timing & size">
									<SliderRow
										label="Duration"
										valueLabel={`${(side.durationMs / 1000).toFixed(1)}s`}
										min={INTRO_OUTRO_MIN_DURATION_MS}
										max={INTRO_OUTRO_MAX_DURATION_MS}
										step={100}
										value={side.durationMs}
										onValueChange={(durationMs) => setSide({ durationMs })}
									/>
									<SliderRow
										label="Logo size"
										valueLabel={`${Math.round(side.size * 100)}%`}
										min={INTRO_OUTRO_MIN_SIZE}
										max={INTRO_OUTRO_MAX_SIZE}
										step={0.05}
										value={side.size}
										onValueChange={(size) => setSide({ size })}
									/>
								</Section>
								<AudioSection audio={side.audio} setAudio={setAudio} />
							</div>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function LogoRow({
	config,
	onChange,
}: {
	config: IntroOutroConfig;
	onChange: (next: IntroOutroConfig) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const hasLogo = Boolean(config.logoDataUrl);
	const handleFile = (file: File | undefined) => {
		if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_LOGO_BYTES)
			return;
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string")
				onChange({ ...config, logoDataUrl: reader.result });
		};
		reader.readAsDataURL(file);
	};
	return (
		<Section title="Logo">
			<input
				ref={inputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="hidden"
				onChange={(e) => {
					handleFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<div className="flex items-center gap-3">
				{hasLogo ? (
					<img
						src={config.logoDataUrl}
						alt="Logo"
						className="h-12 w-12 rounded-lg border border-foreground/10 bg-white object-contain"
					/>
				) : (
					<div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-foreground/20 text-muted-foreground">
						<UploadIcon className="h-4 w-4" />
					</div>
				)}
				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-foreground/10"
				>
					{hasLogo ? "Replace" : "Upload PNG"}
				</button>
				{hasLogo ? (
					<button
						type="button"
						onClick={() => onChange({ ...config, logoDataUrl: "" })}
						aria-label="Remove logo"
						className="rounded-lg border border-foreground/10 p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10"
					>
						<TrashIcon className="h-3.5 w-3.5" />
					</button>
				) : null}
			</div>
		</Section>
	);
}

function VideoModePreview({
	side,
	onChange,
}: {
	side: IntroOutroSideConfig;
	onChange: (patch: Partial<IntroOutroSideConfig>) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const pick = (file: File | undefined) => {
		// Electron exposes the absolute path on the File object.
		const filePath = (file as (File & { path?: string }) | undefined)?.path;
		if (filePath) onChange({ videoPath: filePath });
	};
	return (
		<div className="flex flex-1 flex-col gap-2">
			<input
				ref={inputRef}
				type="file"
				accept="video/mp4,video/quicktime,video/webm"
				className="hidden"
				onChange={(e) => {
					pick(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-foreground/10 bg-black">
				{side.videoPath ? (
					// biome-ignore lint/a11y/useMediaCaption: user clip preview
					<video src={`file://${side.videoPath}`} controls className="h-full w-full" />
				) : (
					<button
						type="button"
						onClick={() => inputRef.current?.click()}
						className="flex flex-col items-center gap-2 text-muted-foreground"
					>
						<FilmIcon className="h-8 w-8" />
						<span className="text-xs">Upload a video clip</span>
					</button>
				)}
			</div>
			{side.videoPath ? (
				<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
					<span className="truncate">{side.videoPath.split(/[\\/]/).pop()}</span>
					<button
						type="button"
						onClick={() => inputRef.current?.click()}
						className="shrink-0 rounded-md border border-foreground/10 px-2 py-1 hover:bg-foreground/10"
					>
						Replace
					</button>
				</div>
			) : null}
		</div>
	);
}

function AudioSection({
	audio,
	setAudio,
}: {
	audio: CardAudio;
	setAudio: (patch: Partial<CardAudio>) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const handleFile = (file: File | undefined) => {
		if (!file || !file.type.startsWith("audio/") || file.size > MAX_AUDIO_BYTES) return;
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string")
				setAudio({ mode: "upload", dataUrl: reader.result });
		};
		reader.readAsDataURL(file);
	};
	return (
		<Section title="Sound">
			<input
				ref={inputRef}
				type="file"
				accept="audio/*"
				className="hidden"
				onChange={(e) => {
					handleFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<div className="mb-2 flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
				{(
					[
						{ value: "none", label: "None" },
						{ value: "builtin", label: "Built-in" },
						{ value: "upload", label: "Upload" },
					] as const
				).map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => {
							if (opt.value === "upload") inputRef.current?.click();
							else setAudio({ mode: opt.value });
						}}
						className={cn(
							"flex-1 rounded-md py-1 text-xs font-medium transition-colors",
							audio.mode === opt.value
								? "bg-[#2563EB] text-white"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{opt.label}
					</button>
				))}
			</div>
			{audio.mode === "builtin" ? (
				<div className="mb-2 flex flex-wrap gap-1">
					{BUILTIN_TRACKS.map((track) => (
						<button
							key={track.id}
							type="button"
							onClick={() => setAudio({ trackId: track.id })}
							className={cn(
								"rounded-md border px-2 py-1 text-[11px] transition-colors",
								audio.trackId === track.id
									? "border-[#2563EB]/50 bg-[#2563EB]/10 text-[#2563EB] dark:text-white"
									: "border-foreground/10 bg-foreground/5 text-muted-foreground hover:bg-foreground/10",
							)}
						>
							{track.label}
						</button>
					))}
				</div>
			) : null}
			{audio.mode === "upload" && audio.dataUrl ? (
				<p className="mb-2 text-[11px] text-emerald-400">Custom audio loaded.</p>
			) : null}
			{audio.mode !== "none" ? (
				<SliderRow
					label="Volume"
					valueLabel={`${Math.round(audio.volume * 100)}%`}
					min={0}
					max={1}
					step={0.05}
					value={audio.volume}
					onValueChange={(volume) => setAudio({ volume })}
				/>
			) : null}
		</Section>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</span>
			{children}
		</div>
	);
}

function ChipRow<T extends string>({
	options,
	value,
	onSelect,
}: {
	options: { value: T; label: string }[];
	value: T;
	onSelect: (value: T) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					onClick={() => onSelect(opt.value)}
					className={cn(
						"rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
						value === opt.value
							? "border-[#2563EB]/50 bg-[#2563EB]/10 text-[#2563EB] dark:text-white"
							: "border-foreground/10 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
					)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="mt-2 flex items-center justify-between">
			<span className="text-xs text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2">
				<input
					type="color"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					aria-label={label}
					className="h-7 w-9 cursor-pointer rounded border border-foreground/10 bg-transparent p-0"
				/>
				<span className="font-mono text-[11px] uppercase text-muted-foreground/80">
					{value}
				</span>
			</div>
		</div>
	);
}

function SliderRow({
	label,
	valueLabel,
	min,
	max,
	step,
	value,
	onValueChange,
}: {
	label: string;
	valueLabel: string;
	min: number;
	max: number;
	step: number;
	value: number;
	onValueChange: (value: number) => void;
}) {
	return (
		<div className="mt-2">
			<div className="mb-1 flex items-center justify-between">
				<span className="text-xs text-muted-foreground">{label}</span>
				<span className="text-xs font-medium">{valueLabel}</span>
			</div>
			<Slider
				min={min}
				max={max}
				step={step}
				value={[value]}
				onValueChange={(next) => onValueChange(next[0] ?? value)}
			/>
		</div>
	);
}
