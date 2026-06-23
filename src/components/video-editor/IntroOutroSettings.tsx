import { Sparkle as SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { IntroStudioModal } from "./IntroStudioModal";
import { type IntroOutroConfig, sideIsRenderable } from "./introOutroTypes";

interface IntroOutroSettingsProps {
	config: IntroOutroConfig;
	onChange: (next: IntroOutroConfig) => void;
}

export function IntroOutroSettings({ config, onChange }: IntroOutroSettingsProps) {
	const [studioOpen, setStudioOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<"intro" | "outro">("intro");

	const openStudio = (tab: "intro" | "outro") => {
		setActiveTab(tab);
		setStudioOpen(true);
	};

	const sideSummary = (which: "intro" | "outro") => {
		const side = config[which];
		if (!side.enabled) return "Off";
		if (side.mode === "video") return side.videoPath ? "Video clip" : "Video (no clip)";
		const ready = sideIsRenderable(side, config.logoDataUrl);
		return ready
			? `${side.preset} · ${(side.durationMs / 1000).toFixed(1)}s`
			: "Needs logo/text";
	};

	return (
		<div className="mb-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Intro / Outro
				</span>
			</div>

			{(["intro", "outro"] as const).map((which) => (
				<div
					key={which}
					className="mb-2 flex items-center justify-between rounded-lg border border-foreground/10 bg-background/40 px-3 py-2"
				>
					<button
						type="button"
						onClick={() => openStudio(which)}
						className="flex min-w-0 flex-1 flex-col items-start text-left"
					>
						<span className="text-[11px] font-semibold capitalize text-foreground">
							{which}
						</span>
						<span className="truncate text-[10px] capitalize text-muted-foreground">
							{sideSummary(which)}
						</span>
					</button>
					<Switch
						checked={config[which].enabled}
						onCheckedChange={(checked) =>
							onChange({ ...config, [which]: { ...config[which], enabled: checked } })
						}
						aria-label={`Enable ${which}`}
						className="scale-75 data-[state=checked]:bg-[#2563EB]"
					/>
				</div>
			))}

			<button
				type="button"
				onClick={() => openStudio(activeTab)}
				className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2563EB]/90"
			>
				<SparkleIcon className="h-3.5 w-3.5" weight="fill" />
				Open Intro Studio
			</button>

			<IntroStudioModal
				open={studioOpen}
				onClose={() => setStudioOpen(false)}
				config={config}
				onChange={onChange}
				activeTab={activeTab}
				onTabChange={setActiveTab}
			/>
		</div>
	);
}
