import { useEffect, useState } from "react";
import { SparkleIcon, CaretUpIcon, GitBranchIcon } from "@phosphor-icons/react";
import { Button } from "../ui/button";
import styles from "./LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./popovers/LaunchPopoverCoordinator";
import { HudPopover, DropdownItem } from "./popovers/PopoverScaffold";

const POPOVER_ID = "glitchgrab";

interface AuthStatus {
	loggedIn: boolean;
	name: string | null;
	userId: string | null;
	selectedRepoId: string | null;
	selectedRepoName: string | null;
}

interface Repo {
	id: string;
	name: string;
	fullName: string;
}

interface GlitchgrabAPI {
	login: () => Promise<{ ok: boolean }>;
	status: () => Promise<AuthStatus>;
	getRepos: () => Promise<Repo[]>;
	setRepo: (repoId: string, repoName: string) => Promise<{ ok: boolean }>;
	logout: () => Promise<{ ok: boolean }>;
	onAuthChanged: (cb: (status: AuthStatus) => void) => () => void;
}

function gg(): GlitchgrabAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabAPI }).glitchgrab ?? null;
}

export function GlitchgrabPopover({ onOpen }: { onOpen?: () => void }) {
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

	const [status, setStatus] = useState<AuthStatus | null>(null);
	const [repos, setRepos] = useState<Repo[]>([]);
	const [loadingRepos, setLoadingRepos] = useState(false);
	const [query, setQuery] = useState("");

	const loadRepos = async () => {
		const api = gg();
		if (!api) return;
		setLoadingRepos(true);
		try {
			setRepos(await api.getRepos());
		} finally {
			setLoadingRepos(false);
		}
	};

	const refresh = async () => {
		const api = gg();
		if (!api) return;
		const s = await api.status();
		setStatus(s);
		if (s.loggedIn) loadRepos();
	};

	useEffect(() => {
		refresh();
		const unsub = gg()?.onAuthChanged((s) => {
			setStatus(s);
			if (s.loggedIn) loadRepos();
		});
		return () => unsub?.();
	}, []);

	if (!gg()) return null; // not inside GlitchRecord

	const loggedIn = status?.loggedIn ?? false;
	const triggerLabel = loggedIn
		? (status?.selectedRepoName ?? "Select repo")
		: "Connect Glitchgrab";

	const trigger = (
		<Button
			variant="outline"
			size="lg"
			className={`${styles.electronNoDrag} group gap-2 px-3 min-w-0 max-w-[180px] rounded-[11px] font-medium text-[12px] shrink-0 border-[var(--launch-border)] bg-[var(--launch-surface)] text-[var(--launch-text)] hover:border-[var(--launch-border-strong)] hover:bg-[var(--launch-hover)] transition-all ${open ? "border-[var(--launch-border-strong)] bg-[var(--launch-hover)]" : ""}`}
			title={triggerLabel}
		>
			<SparkleIcon size={16} className="shrink-0" />
			<div className="flex-1 min-w-0 overflow-hidden truncate">{triggerLabel}</div>
			<CaretUpIcon
				size={10}
				className={`text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200 ${open ? "" : "rotate-180"}`}
			/>
		</Button>
	);

	return (
		<HudPopover
			open={open}
			onOpenChange={(next) => {
				if (!next) { requestClose(POPOVER_ID); return; }
				onOpen?.();
				requestOpen(POPOVER_ID);
				refresh();
			}}
			trigger={trigger}
			align="center"
		>
			<div className="min-w-[220px] p-1">
				{!loggedIn ? (
					<DropdownItem icon={<SparkleIcon size={16} />} onClick={() => gg()?.login()}>
						Connect Glitchgrab
					</DropdownItem>
				) : (
					<>
						<div className="px-2 py-1.5 text-[11px] opacity-50">{status?.name}</div>
						<div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide opacity-40">
							{loadingRepos ? "Loading repos..." : "Recording repo"}
						</div>
						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search repos..."
							className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-lg border border-[var(--launch-border)] bg-[var(--launch-hover)] px-2 py-1.5 text-[12px] text-[var(--launch-text)] outline-none placeholder:opacity-40 focus:border-[var(--launch-border-strong)]"
						/>
						<div className="max-h-[240px] overflow-y-auto">
							{repos
								.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
								.map((r) => (
									<DropdownItem
										key={r.id}
										icon={<GitBranchIcon size={16} />}
										selected={status?.selectedRepoId === r.id}
										onClick={async () => {
											await gg()?.setRepo(r.id, r.name);
											setStatus((prev) => prev && { ...prev, selectedRepoId: r.id, selectedRepoName: r.name });
										}}
									>
										{r.name}
									</DropdownItem>
								))}
							{!loadingRepos &&
								repos.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())).length === 0 && (
									<div className="px-2 py-2 text-[11px] opacity-40">No repos match</div>
								)}
						</div>
					</>
				)}
			</div>
		</HudPopover>
	);
}
