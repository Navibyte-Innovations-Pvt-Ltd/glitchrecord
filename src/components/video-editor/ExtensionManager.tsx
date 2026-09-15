/**
 * ExtensionManager — Sidebar panel for managing locally installed extensions.
 *
 * Extensions are installed from a folder on disk (or the extensions
 * directory). There is no remote marketplace.
 */

import {
	ArrowSquareOut as ExternalLink,
	FolderOpen,
	SpinnerGap as Loader2,
	Plus,
	PuzzlePiece as Puzzle,
	ArrowsClockwise as RefreshCw,
	Trash as Trash2,
} from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { useExtensions } from "@/hooks/useExtensions";
import type { ExtensionInfo } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import { ExtensionIcon } from "./ExtensionIcon";

function toSafeHttpUrl(value?: string): string | null {
	if (!value) return null;

	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.toString()
			: null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Installed Extension Card
// ---------------------------------------------------------------------------

function InstalledExtensionCard({
	extension,
	isActive,
	onToggle,
	onUninstall,
	onClick,
}: {
	extension: ExtensionInfo;
	isActive: boolean;
	onToggle: () => void;
	onUninstall?: () => void;
	onClick?: () => void;
}) {
	const t = useScopedT("extensions");
	const isError = extension.status === "error";
	const isBuiltin = extension.builtin;
	const homepageUrl = toSafeHttpUrl(extension.manifest.homepage);

	return (
		<div
			className={cn(
				"flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer",
				isError
					? "border-red-500/30 bg-red-500/5"
					: isActive
						? "border-[#2563EB]/20 bg-[#2563EB]/5"
						: "border-foreground/[0.06] bg-white/[0.02] hover:bg-foreground/[0.04]",
			)}
			onClick={onClick}
		>
			<div className="flex-shrink-0 w-8 h-8 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center overflow-hidden">
				<ExtensionIcon
					icon={extension.manifest.icon}
					extensionPath={extension.path}
					className="w-3.5 h-3.5 text-muted-foreground"
					imageClassName="w-8 h-8 rounded-lg"
				/>
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-[13px] font-medium text-foreground truncate">
						{extension.manifest.name}
					</span>
				</div>

				{extension.manifest.author && (
					<p className="text-[10px] text-muted-foreground/70 mt-0.5">
						{homepageUrl ? (
							<a
								href={homepageUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-muted-foreground transition-colors"
								onClick={(e) => e.stopPropagation()}
							>
								{t("detail.by", undefined, { author: extension.manifest.author })}
							</a>
						) : (
							<>{t("detail.by", undefined, { author: extension.manifest.author })}</>
						)}
					</p>
				)}

				<p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-3">
					{extension.manifest.description || t("detail.noDescription")}
				</p>

				{isError && extension.error && (
					<p className="text-[10px] text-red-400 mt-1">
						{t("detail.error", undefined, { message: extension.error })}
					</p>
				)}

				{extension.manifest.permissions.length > 0 && (
					<div className="flex gap-1 mt-1.5 flex-wrap">
						{extension.manifest.permissions.map((perm) => (
							<span
								key={perm}
								className="text-[8px] px-1 py-[1px] rounded bg-foreground/5 text-muted-foreground font-mono"
							>
								{perm}
							</span>
						))}
					</div>
				)}
			</div>

			<div className="flex items-center gap-1.5 flex-shrink-0">
				{!isBuiltin && onUninstall && (
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
						onClick={(e) => {
							e.stopPropagation();
							onUninstall();
						}}
						title={t("actions.uninstall")}
					>
						<Trash2 className="w-3 h-3" />
					</Button>
				)}
				<div onClick={(e) => e.stopPropagation()}>
					<Switch checked={isActive} onCheckedChange={onToggle} disabled={isError} />
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Extension Detail
// ---------------------------------------------------------------------------

function ExtensionDetailModal({
	extension,
	isActive,
	onClose,
	onToggle,
}: {
	extension: ExtensionInfo;
	isActive: boolean;
	onClose: () => void;
	onToggle: () => void;
}) {
	const t = useScopedT("extensions");
	const { manifest } = extension;
	const description = manifest.description || t("detail.noDescription");
	const homepageUrl = toSafeHttpUrl(manifest.homepage);
	const isError = extension.status === "error";

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-w-md bg-editor-panel border-foreground/10 text-foreground p-0 gap-0 overflow-hidden">
				{/* Header */}
				<div className="p-5 pb-4">
					<div className="flex items-start gap-3.5">
						<div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-[#2563EB]/20 to-[#2563EB]/5 border border-foreground/10 flex items-center justify-center">
							<ExtensionIcon
								icon={manifest.icon}
								extensionPath={extension.path}
								className="w-5 h-5 text-[#2563EB]/60"
							/>
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5">
								<h2 className="text-[15px] font-semibold text-foreground truncate">
									{manifest.name}
								</h2>
							</div>
							<p className="text-[11px] text-muted-foreground/70 mt-0.5">
								{manifest.author ? (
									homepageUrl ? (
										<a
											href={homepageUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="hover:text-muted-foreground transition-colors inline-flex items-center gap-1"
										>
											{t("detail.by", undefined, { author: manifest.author })}
											<ExternalLink className="w-2.5 h-2.5" />
										</a>
									) : (
										<>{t("detail.by", undefined, { author: manifest.author })}</>
									)
								) : (
									t("detail.unknownAuthor")
								)}
							</p>
						</div>
					</div>
				</div>

				{/* Body */}
				<div className="px-5 pb-5 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
					<div>
						<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
							{t("detail.description")}
						</p>
						<p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
							{description}
						</p>
					</div>

					{manifest.permissions.length > 0 && (
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
								{t("detail.permissions")}
							</p>
							<div className="flex flex-wrap gap-1.5">
								{manifest.permissions.map((perm) => (
									<span
										key={perm}
										className="text-[10px] px-2 py-0.5 rounded bg-foreground/5 text-muted-foreground font-mono"
									>
										{perm}
									</span>
								))}
							</div>
						</div>
					)}

					<div>
						<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
							{t("detail.location")}
						</p>
						<p className="text-[10px] text-muted-foreground/70 font-mono break-all">
							{extension.path}
						</p>
					</div>

					{isError && extension.error && (
						<div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
							<p className="text-[11px] text-red-400">{extension.error}</p>
						</div>
					)}
				</div>

				{/* Footer actions */}
				<div className="flex items-center gap-2 px-5 py-3 border-t border-foreground/[0.06] bg-white/[0.02]">
					<div className="flex items-center gap-2">
						<Switch checked={isActive} onCheckedChange={onToggle} disabled={isError} />
						<span className="text-[11px] text-muted-foreground">
							{isActive ? t("status.enabled") : t("status.disabled")}
						</span>
					</div>
					<div className="flex-1" />
					<Button
						variant="ghost"
						size="sm"
						className="h-8 px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/10"
						onClick={onClose}
					>
						{t("actions.close")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ExtensionManager() {
	const t = useScopedT("extensions");
	const {
		extensions,
		activeIds,
		ready,
		refresh,
		toggleExtension,
		installFromFolder,
		uninstall,
		openDirectory,
	} = useExtensions();

	const [isRefreshing, setIsRefreshing] = useState(false);
	const [detailId, setDetailId] = useState<string | null>(null);
	const detailExtension = detailId
		? extensions.find((ext) => ext.manifest.id === detailId) ?? null
		: null;

	const handleInstallFromFolder = useCallback(async () => {
		const success = await installFromFolder();
		if (success) {
			toast.success(t("toast.installedAndEnabled"));
		}
	}, [installFromFolder, t]);

	const handleUninstall = useCallback(
		async (id: string, name: string) => {
			const success = await uninstall(id);
			if (success) {
				toast.success(t("toast.uninstalled", undefined, { name }));
			} else {
				toast.error(t("toast.uninstallFailed", undefined, { name }));
			}
		},
		[uninstall, t],
	);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await refresh();
			toast.success(t("toast.refreshed"));
		} catch {
			toast.error(t("toast.refreshFailed"));
		} finally {
			setIsRefreshing(false);
		}
	}, [refresh, t]);

	return (
		<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel border border-foreground/10 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
			{/* Header */}
			<div className="flex-shrink-0 p-4 pb-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Puzzle className="w-4 h-4 text-[#2563EB]" />
						<h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
					</div>
					<div className="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10"
							onClick={handleRefresh}
							disabled={isRefreshing}
							title={t("actions.refresh")}
						>
							<RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10"
							onClick={openDirectory}
							title={t("actions.openFolder")}
						>
							<FolderOpen className="w-3 h-3" />
						</Button>
					</div>
				</div>
			</div>

			{/* Content */}
			<div
				className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0 pt-0"
				style={{ scrollbarGutter: "stable" }}
			>
				{!ready ? (
					<div className="flex-1 flex items-center justify-center py-12">
						<Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
					</div>
				) : (
					<InstalledList
						extensions={extensions}
						activeIds={activeIds}
						onToggle={toggleExtension}
						onUninstall={handleUninstall}
						onInstallFromFolder={handleInstallFromFolder}
						onOpenDirectory={openDirectory}
						onViewDetail={(ext) => setDetailId(ext.manifest.id)}
					/>
				)}
			</div>

			{detailExtension && (
				<ExtensionDetailModal
					extension={detailExtension}
					isActive={activeIds.has(detailExtension.manifest.id)}
					onClose={() => setDetailId(null)}
					onToggle={() => void toggleExtension(detailExtension.manifest.id)}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Installed List
// ---------------------------------------------------------------------------

function InstalledList({
	extensions,
	activeIds,
	onToggle,
	onUninstall,
	onInstallFromFolder,
	onOpenDirectory,
	onViewDetail,
}: {
	extensions: ExtensionInfo[];
	activeIds: Set<string>;
	onToggle: (id: string) => Promise<void>;
	onUninstall: (id: string, name: string) => void;
	onInstallFromFolder: () => void;
	onOpenDirectory: () => void;
	onViewDetail: (ext: ExtensionInfo) => void;
}) {
	const t = useScopedT("extensions");
	if (extensions.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-10">
				<div className="w-11 h-11 rounded-full bg-foreground/[0.04] flex items-center justify-center">
					<Puzzle className="w-5 h-5 text-muted-foreground" />
				</div>
				<div className="text-center">
					<p className="text-[13px] font-medium text-muted-foreground">{t("empty.title")}</p>
					<p className="text-[11px] text-muted-foreground mt-1 leading-relaxed max-w-[200px]">
						{t("empty.description")}
					</p>
				</div>
				<div className="flex gap-2 mt-2">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/10 gap-1"
						onClick={onInstallFromFolder}
					>
						<Plus className="w-3 h-3" />
						{t("actions.install")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/10 gap-1"
						onClick={onOpenDirectory}
					>
						<FolderOpen className="w-3 h-3" />
						{t("actions.folder")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between mb-1">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{t("tabs.installed")}
				</p>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-[10px] text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10 gap-1"
					onClick={onInstallFromFolder}
				>
					<Plus className="w-2.5 h-2.5" />
					{t("actions.add")}
				</Button>
			</div>
			{extensions.map((ext) => (
				<InstalledExtensionCard
					key={ext.manifest.id}
					extension={ext}
					isActive={activeIds.has(ext.manifest.id)}
					onToggle={() => onToggle(ext.manifest.id)}
					onUninstall={
						ext.builtin
							? undefined
							: () => onUninstall(ext.manifest.id, ext.manifest.name)
					}
					onClick={() => onViewDetail(ext)}
				/>
			))}
		</div>
	);
}
