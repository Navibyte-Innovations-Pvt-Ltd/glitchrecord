import { MusicNotes, Trash, UploadSimple } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";
import { type BackgroundMusicConfig, DEFAULT_BACKGROUND_MUSIC_VOLUME } from "./types";

interface BackgroundMusicSettingsProps {
	config: BackgroundMusicConfig | null | undefined;
	onPick: () => void;
	onVolumeChange: (volume: number) => void;
	onRemove: () => void;
}

// Background-music bed control in the export menu. Plays under the narration for
// the whole main video and loops seamlessly when the file is shorter. It sits
// outside the intro/outro cards, so music never plays over them.
export function BackgroundMusicSettings({
	config,
	onPick,
	onVolumeChange,
	onRemove,
}: BackgroundMusicSettingsProps) {
	const volumePercent = Math.round((config?.volume ?? DEFAULT_BACKGROUND_MUSIC_VOLUME) * 100);

	return (
		<div className="mb-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Background Music
				</span>
			</div>

			{config ? (
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2 rounded-lg border border-foreground/10 bg-background/40 px-3 py-2">
						<div className="flex min-w-0 items-center gap-2">
							<MusicNotes className="h-4 w-4 shrink-0 text-[#2563EB]" />
							<span className="truncate text-[11px] font-medium text-foreground">
								{config.name ?? config.audioPath.split(/[\\/]/).pop() ?? "Music"}
							</span>
						</div>
						<button
							type="button"
							onClick={onRemove}
							title="Remove music"
							className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-red-500"
						>
							<Trash className="h-3.5 w-3.5" />
						</button>
					</div>

					<div className="px-1">
						<div className="mb-1 flex items-center justify-between">
							<span className="text-[10px] text-muted-foreground">Volume</span>
							<span className="text-[10px] tabular-nums text-muted-foreground">
								{volumePercent}%
							</span>
						</div>
						<Slider
							value={[volumePercent]}
							onValueChange={([value]) => onVolumeChange((value ?? 0) / 100)}
							min={0}
							max={100}
							step={1}
						/>
					</div>

					<p className="px-1 text-[10px] text-muted-foreground/70">
						Loops seamlessly for the whole video. Silent during intro/outro.
					</p>
				</div>
			) : (
				<button
					type="button"
					onClick={onPick}
					className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/20 bg-background/40 px-3 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[#2563EB]/40 hover:text-foreground"
				>
					<UploadSimple className="h-4 w-4" />
					Add music track
				</button>
			)}
		</div>
	);
}
