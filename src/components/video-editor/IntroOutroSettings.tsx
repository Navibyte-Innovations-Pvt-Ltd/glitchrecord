import { Trash as TrashIcon, UploadSimple as UploadIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CardPreview } from "./CardPreview";
import {
	INTRO_OUTRO_MAX_DURATION_MS,
	INTRO_OUTRO_MAX_SIZE,
	INTRO_OUTRO_MIN_DURATION_MS,
	INTRO_OUTRO_MIN_SIZE,
	type IntroOutroConfig,
	type IntroOutroPosition,
	type IntroOutroPreset,
	type IntroOutroSideConfig,
} from "./introOutroTypes";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const PRESET_OPTIONS: { value: IntroOutroPreset; label: string }[] = [
	{ value: "fade", label: "Fade" },
	{ value: "scale-pop", label: "Pop" },
	{ value: "slide", label: "Slide" },
	{ value: "glitch", label: "Glitch" },
];

const POSITION_OPTIONS: { value: IntroOutroPosition; label: string }[] = [
	{ value: "center", label: "Center" },
	{ value: "top", label: "Top" },
	{ value: "bottom", label: "Bottom" },
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
];

interface IntroOutroSettingsProps {
	config: IntroOutroConfig;
	onChange: (next: IntroOutroConfig) => void;
}

export function IntroOutroSettings({ config, onChange }: IntroOutroSettingsProps) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const hasLogo = Boolean(config.logoDataUrl);

	const handleLogoFile = (file: File | undefined) => {
		if (!file) return;
		if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
			return;
		}
		if (file.size > MAX_LOGO_BYTES) {
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				onChange({ ...config, logoDataUrl: reader.result });
			}
		};
		reader.readAsDataURL(file);
	};

	const updateSide = (which: "intro" | "outro", patch: Partial<IntroOutroSideConfig>) => {
		onChange({ ...config, [which]: { ...config[which], ...patch } });
	};

	return (
		<div className="mb-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Intro / Outro
				</span>
			</div>

			{/* Logo upload */}
			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="hidden"
				onChange={(event) => {
					handleLogoFile(event.target.files?.[0]);
					event.target.value = "";
				}}
			/>
			<div className="mb-3 flex items-center gap-3">
				{hasLogo ? (
					<div
						className="h-12 w-12 shrink-0 rounded-lg border border-foreground/10 bg-[length:10px_10px] bg-center"
						style={{
							backgroundImage:
								"linear-gradient(45deg,#8883 25%,transparent 25%),linear-gradient(-45deg,#8883 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8883 75%),linear-gradient(-45deg,transparent 75%,#8883 75%)",
							backgroundPosition: "0 0,0 5px,5px -5px,-5px 0",
						}}
					>
						<img
							src={config.logoDataUrl}
							alt="Logo preview"
							className="h-full w-full rounded-lg object-contain"
						/>
					</div>
				) : (
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-foreground/20 text-muted-foreground">
						<UploadIcon className="h-4 w-4" />
					</div>
				)}
				<div className="min-w-0 flex-1">
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/10"
					>
						{hasLogo ? "Replace logo" : "Upload logo (PNG)"}
					</button>
					<p className="mt-1 text-[9px] text-muted-foreground/70">
						Transparent PNG recommended · max 2 MB
					</p>
				</div>
				{hasLogo ? (
					<button
						type="button"
						onClick={() => onChange({ ...config, logoDataUrl: "" })}
						aria-label="Remove logo"
						className="shrink-0 rounded-lg border border-foreground/10 p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
					>
						<TrashIcon className="h-3.5 w-3.5" />
					</button>
				) : null}
			</div>

			{!hasLogo ? (
				<p className="mb-1 px-0.5 text-[10px] text-amber-500/90">
					Upload a logo to enable intro / outro cards.
				</p>
			) : null}

			<SideEditor
				title="Intro"
				side={config.intro}
				disabled={!hasLogo}
				logoDataUrl={config.logoDataUrl}
				onChange={(patch) => updateSide("intro", patch)}
			/>
			<div className="h-2" />
			<SideEditor
				title="Outro"
				side={config.outro}
				disabled={!hasLogo}
				logoDataUrl={config.logoDataUrl}
				onChange={(patch) => updateSide("outro", patch)}
			/>
		</div>
	);
}

interface SideEditorProps {
	title: string;
	side: IntroOutroSideConfig;
	disabled: boolean;
	logoDataUrl: string;
	onChange: (patch: Partial<IntroOutroSideConfig>) => void;
}

function SideEditor({ title, side, disabled, logoDataUrl, onChange }: SideEditorProps) {
	return (
		<div className="rounded-lg border border-foreground/10 bg-background/40 p-2.5">
			<div className="flex items-center justify-between">
				<span className="text-[11px] font-semibold text-foreground">{title}</span>
				<Switch
					checked={side.enabled}
					disabled={disabled}
					onCheckedChange={(checked) => onChange({ enabled: checked })}
					aria-label={`Attach ${title.toLowerCase()}`}
					className="scale-75 data-[state=checked]:bg-[#2563EB]"
				/>
			</div>

			{side.enabled && !disabled ? (
				<div className="mt-2.5 space-y-2.5">
					<CardPreview side={side} logoDataUrl={logoDataUrl} />
					<ChipRow
						label="Animation"
						options={PRESET_OPTIONS}
						value={side.preset}
						onSelect={(preset) => onChange({ preset })}
					/>
					<ChipRow
						label="Position"
						options={POSITION_OPTIONS}
						value={side.position}
						onSelect={(position) => onChange({ position })}
					/>
					<SliderRow
						label="Duration"
						valueLabel={`${(side.durationMs / 1000).toFixed(1)}s`}
						min={INTRO_OUTRO_MIN_DURATION_MS}
						max={INTRO_OUTRO_MAX_DURATION_MS}
						step={100}
						value={side.durationMs}
						onValueChange={(durationMs) => onChange({ durationMs })}
					/>
					<SliderRow
						label="Logo size"
						valueLabel={`${Math.round(side.size * 100)}%`}
						min={INTRO_OUTRO_MIN_SIZE}
						max={INTRO_OUTRO_MAX_SIZE}
						step={0.05}
						value={side.size}
						onValueChange={(size) => onChange({ size })}
					/>
					<div className="flex items-center justify-between">
						<span className="text-[10px] text-muted-foreground">Background</span>
						<div className="flex items-center gap-2">
							<input
								type="color"
								value={side.backgroundColor}
								onChange={(event) =>
									onChange({ backgroundColor: event.target.value })
								}
								aria-label={`${title} background color`}
								className="h-6 w-8 cursor-pointer rounded border border-foreground/10 bg-transparent p-0"
							/>
							<span className="font-mono text-[10px] uppercase text-muted-foreground/80">
								{side.backgroundColor}
							</span>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

interface ChipRowProps<T extends string> {
	label: string;
	options: { value: T; label: string }[];
	value: T;
	onSelect: (value: T) => void;
}

function ChipRow<T extends string>({ label, options, value, onSelect }: ChipRowProps<T>) {
	return (
		<div>
			<span className="mb-1 block text-[10px] text-muted-foreground">{label}</span>
			<div className="flex flex-wrap gap-1">
				{options.map((option) => {
					const isActive = value === option.value;
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => onSelect(option.value)}
							aria-pressed={isActive}
							className={cn(
								"rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
								isActive
									? "border-[#2563EB]/50 bg-[#2563EB]/10 text-[#2563EB] dark:text-white"
									: "border-foreground/10 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
							)}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

interface SliderRowProps {
	label: string;
	valueLabel: string;
	min: number;
	max: number;
	step: number;
	value: number;
	onValueChange: (value: number) => void;
}

function SliderRow({ label, valueLabel, min, max, step, value, onValueChange }: SliderRowProps) {
	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-[10px] text-muted-foreground">{label}</span>
				<span className="text-[10px] font-medium text-foreground">{valueLabel}</span>
			</div>
			<Slider
				min={min}
				max={max}
				step={step}
				value={[value]}
				onValueChange={(next) => onValueChange(next[0] ?? value)}
				className="py-1"
			/>
		</div>
	);
}
