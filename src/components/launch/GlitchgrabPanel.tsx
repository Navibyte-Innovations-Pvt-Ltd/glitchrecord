import { useEffect, useState } from "react";

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

// Typed view of the preload-exposed API
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

export function GlitchgrabPanel() {
	const [status, setStatus] = useState<AuthStatus | null>(null);
	const [repos, setRepos] = useState<Repo[]>([]);
	const [loadingRepos, setLoadingRepos] = useState(false);

	const refresh = async () => {
		const api = gg();
		if (!api) return;
		const s = await api.status();
		setStatus(s);
		if (s.loggedIn) loadRepos();
	};

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

	useEffect(() => {
		refresh();
		const api = gg();
		const unsub = api?.onAuthChanged((s) => {
			setStatus(s);
			if (s.loggedIn) loadRepos();
		});
		return () => unsub?.();
	}, []);

	if (!gg()) return null; // not running inside GlitchRecord

	if (!status?.loggedIn) {
		return (
			<div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
				<div className="mb-2 text-xs font-semibold text-foreground/70">Glitchgrab</div>
				<button
					type="button"
					onClick={() => gg()?.login()}
					className="w-full rounded-lg bg-[#7c3aed] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
				>
					Connect Glitchgrab
				</button>
				<p className="mt-2 text-[11px] text-foreground/50">
					Login to pick a repo and auto-create issues from recordings.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="text-xs font-semibold text-foreground/70">
					{status.name}
				</span>
				<button
					type="button"
					onClick={async () => { await gg()?.logout(); refresh(); }}
					className="text-[11px] text-foreground/40 hover:text-foreground/70"
				>
					Logout
				</button>
			</div>

			<label className="mb-1 block text-[11px] text-foreground/50">Recording repo</label>
			<select
				value={status.selectedRepoId ?? ""}
				disabled={loadingRepos}
				onChange={async (e) => {
					const repo = repos.find((r) => r.id === e.target.value);
					if (repo) {
						await gg()?.setRepo(repo.id, repo.name);
						setStatus({ ...status, selectedRepoId: repo.id, selectedRepoName: repo.name });
					}
				}}
				className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.06] px-2 py-1.5 text-sm text-foreground"
			>
				<option value="" disabled>
					{loadingRepos ? "Loading repos..." : "Select a repo"}
				</option>
				{repos.map((r) => (
					<option key={r.id} value={r.id}>
						{r.name}
					</option>
				))}
			</select>

			{status.selectedRepoName && (
				<p className="mt-2 text-[11px] text-[#4ade80]">
					Recording → {status.selectedRepoName}
				</p>
			)}
		</div>
	);
}
