import { useCallback, useEffect, useState } from "react";
import { VideoCamera, Sparkle, ArrowClockwise, Trash, Check, X } from "@phosphor-icons/react";
import { toFileUrl } from "../video-editor/projectPersistence";
import type { ProjectLibraryEntry } from "../video-editor/ProjectBrowserDialog";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

type RecordingEntry = { path: string; name: string; sizeBytes: number; mtimeMs: number };

function fmtSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function api() {
	return (window as unknown as { electronAPI?: Record<string, (...a: unknown[]) => unknown> })
		.electronAPI;
}

export function HomeWindow() {
	const [projects, setProjects] = useState<ProjectLibraryEntry[]>([]);
	const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [thumbs, setThumbs] = useState<Record<string, string>>({});
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const a = api();
			const [proj, rec] = await Promise.all([
				(a?.listProjectFiles?.() as Promise<{ entries?: ProjectLibraryEntry[] }>) ??
					Promise.resolve({ entries: [] }),
				(a?.listRecordings?.() as Promise<{ entries?: RecordingEntry[] }>) ??
					Promise.resolve({ entries: [] }),
			]);
			setProjects(proj?.entries ?? []);
			setRecordings(rec?.entries ?? []);
		} catch (e) {
			console.error("Home load failed:", e);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const startNewRecording = useCallback(() => {
		void api()?.openRecorder?.();
	}, []);

	const openRecording = useCallback(async (path: string) => {
		const a = api();
		await a?.setCurrentVideoPath?.(path);
		await a?.switchToEditor?.();
	}, []);

	const openProject = useCallback(async (path: string) => {
		const a = api();
		await a?.openProjectFileAtPath?.(path);
		await a?.switchToEditor?.();
	}, []);

	// Lazily fetch first-frame thumbnails (sequential so we don't spawn 20 ffmpegs at once).
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const a = api();
			if (!a?.getRecordingThumbnail) return;
			for (const r of recordings) {
				if (cancelled) return;
				if (thumbs[r.path]) continue;
				try {
					const res = (await a.getRecordingThumbnail(r.path)) as {
						success: boolean;
						thumbnailPath?: string;
					};
					if (!cancelled && res?.success && res.thumbnailPath) {
						setThumbs((prev) => ({ ...prev, [r.path]: res.thumbnailPath as string }));
					}
				} catch {
					/* skip */
				}
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [recordings]);

	const deleteRecording = useCallback(
		async (path: string) => {
			const a = api();
			const res = (await a?.deleteRecording?.(path)) as { success: boolean } | undefined;
			if (res?.success) {
				setRecordings((prev) => prev.filter((r) => r.path !== path));
				setConfirmDelete(null);
			}
		},
		[],
	);

	return (
		<div className="flex h-screen w-screen flex-col bg-editor-bg text-foreground">
			{/* Header — draggable title bar; left padding clears the macOS traffic lights */}
			<div
				className="flex items-center gap-3 border-b border-foreground/10 py-4 pr-5"
				style={{
					WebkitAppRegion: "drag",
					paddingLeft: IS_MAC ? 88 : 20,
				} as React.CSSProperties}
			>
				<Sparkle className="h-5 w-5 shrink-0 text-blue-500" weight="fill" />
				<div className="flex flex-col">
					<span className="text-[15px] font-semibold tracking-tight">GlitchGrab</span>
					<span className="text-[11px] text-foreground/45">Record · edit · narrate</span>
				</div>
				<button
					type="button"
					onClick={startNewRecording}
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
					className="ml-auto flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.28)] transition hover:bg-blue-500"
				>
					<VideoCamera className="h-4 w-4" weight="fill" /> New Recording
				</button>
				<button
					type="button"
					onClick={() => void refresh()}
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
					className="rounded-lg p-2 text-foreground/40 transition hover:bg-foreground/5 hover:text-foreground/70"
					title="Refresh"
				>
					<ArrowClockwise className="h-4 w-4" />
				</button>
			</div>

			{/* Body */}
			<div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "thin" }}>
				{loading ? (
					<div className="pt-10 text-center text-[13px] text-foreground/40">Loading…</div>
				) : projects.length === 0 && recordings.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-4 pt-20 text-center">
						<VideoCamera className="h-12 w-12 text-foreground/15" weight="duotone" />
						<div className="text-[14px] font-semibold text-foreground/70">No recordings yet</div>
						<p className="max-w-[320px] text-[12px] leading-relaxed text-foreground/45">
							Press <span className="font-medium text-foreground/70">New Recording</span> to
							capture your screen. It'll show up here afterwards.
						</p>
						<button
							type="button"
							onClick={startNewRecording}
							className="mt-1 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500"
						>
							<VideoCamera className="h-4 w-4" weight="fill" /> New Recording
						</button>
					</div>
				) : (
					<div className="flex flex-col gap-6">
						{projects.length > 0 && (
							<section>
								<h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
									Projects
								</h2>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
									{projects.map((p) => (
										<button
											key={p.path}
											type="button"
											onClick={() => void openProject(p.path)}
											className="group flex flex-col gap-1.5 text-left"
										>
											<div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-editor-dialog-alt shadow-[0_8px_18px_rgba(0,0,0,0.28)] transition group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_28px_rgba(0,0,0,0.4)]">
												{p.thumbnailPath ? (
													<img
														src={toFileUrl(p.thumbnailPath)}
														alt=""
														className="h-full w-full object-cover"
														draggable={false}
													/>
												) : (
													<div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,_rgba(37,99,235,0.22),_rgba(13,17,23,0.92))] text-[10px] text-white/55">
														No preview
													</div>
												)}
											</div>
											<span className="truncate text-[12px] font-medium tracking-tight">
												{p.name}
											</span>
										</button>
									))}
								</div>
							</section>
						)}

						{recordings.length > 0 && (
							<section>
								<h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
									Recent Recordings
								</h2>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
									{recordings.map((r) => (
										<div key={r.path} className="group flex flex-col gap-1.5">
											<div
												role="button"
												tabIndex={0}
												onClick={() => void openRecording(r.path)}
												onKeyDown={(e) => {
													if (e.key === "Enter") void openRecording(r.path);
												}}
												className="relative flex aspect-[16/10] cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(180deg,_rgba(37,99,235,0.18),_rgba(13,17,23,0.94))] shadow-[0_8px_18px_rgba(0,0,0,0.28)] transition group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_28px_rgba(0,0,0,0.4)]"
											>
												{thumbs[r.path] ? (
													<img
														src={toFileUrl(thumbs[r.path])}
														alt=""
														className="h-full w-full object-cover"
														draggable={false}
													/>
												) : (
													<VideoCamera
														className="h-7 w-7 text-white/35 transition group-hover:text-white/60"
														weight="fill"
													/>
												)}

												{/* Delete control (hover) with inline confirm */}
												{confirmDelete === r.path ? (
													<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-[2px]">
														<span className="text-[11px] font-medium text-white">Delete this recording?</span>
														<div className="flex gap-2">
															<button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	void deleteRecording(r.path);
																}}
																className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
															>
																<Check className="h-3 w-3" /> Delete
															</button>
															<button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	setConfirmDelete(null);
																}}
																className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/20"
															>
																<X className="h-3 w-3" /> Cancel
															</button>
														</div>
													</div>
												) : (
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															setConfirmDelete(r.path);
														}}
														title="Delete recording"
														className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/70 opacity-0 transition hover:bg-red-600 hover:text-white group-hover:opacity-100"
													>
														<Trash className="h-3.5 w-3.5" />
													</button>
												)}
											</div>
											<span className="truncate text-[12px] font-medium tracking-tight">
												{r.name.replace(/^recording-/, "").replace(/\.mp4$/, "")}
											</span>
											<span className="text-[10px] text-foreground/40">{fmtSize(r.sizeBytes)}</span>
										</div>
									))}
								</div>
							</section>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
