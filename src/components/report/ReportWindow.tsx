import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportFn, ReportResult, ReportType } from "../../vendor/report-ui";
import { ReportDialog } from "../../vendor/report-ui";

/**
 * The desktop "Report Bug" window.
 *
 * Renders the SAME dialog component the npm SDK ships (packages/report-ui,
 * synced into src/vendor by scripts/sync-report-ui.mjs), so the bug-reporting
 * UI a tester sees is identical everywhere and only has to be changed once.
 *
 * What's different from the SDK/extension hosts:
 *  - screenshots come from Electron's desktopCapturer (the whole screen), so a
 *    tester can report from Firefox, Safari, a native app or a terminal — not
 *    just from a Chrome tab.
 *  - submission goes through the main process, which holds the reporter
 *    session (a QA tester's, or the signed-in owner's) and the repo scope.
 */

interface RepoOption {
	id: string;
	fullName: string;
}

interface ReportPayload {
	sessionId: string | null;
	reporterName: string | null;
	repos: RepoOption[];
	screenshotDataUrl: string | null;
}

interface GlitchgrabReportAPI {
	reportPayload: () => Promise<ReportPayload>;
	recaptureScreen: () => Promise<string | null>;
	submitReport: (payload: {
		repoId: string;
		type: string;
		description: string;
		metadata?: Record<string, string>;
	}) => Promise<
		| { ok: true; issueUrl: string; issueNumber: number; title: string }
		| { ok: false; error: string }
	>;
	closeReport: () => Promise<{ ok: boolean }>;
}

function gg(): GlitchgrabReportAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabReportAPI }).glitchgrab ?? null;
}

const LAST_REPO_KEY = "gg_last_repo_id";

export function ReportWindow() {
	const [payload, setPayload] = useState<ReportPayload | null>(null);
	const [repoId, setRepoId] = useState("");
	const [error, setError] = useState<string | null>(null);
	// The screenshot taken just before this window opened is what the reporter
	// actually saw, so it wins the first capture. "Retake" then goes live.
	const initialShotUsed = useRef(false);

	useEffect(() => {
		const api = gg();
		if (!api) {
			setError("Bridge unavailable — restart GlitchRecord.");
			return;
		}
		let cancelled = false;
		api.reportPayload()
			.then((p) => {
				if (cancelled) return;
				setPayload(p);
				if (!p.sessionId) {
					setError(
						"Not signed in — log in to GlitchRecord, or open your QA link and press “Open in GlitchRecord”.",
					);
					return;
				}
				const saved = localStorage.getItem(LAST_REPO_KEY);
				setRepoId(
					saved && p.repos.some((r) => r.id === saved) ? saved : (p.repos[0]?.id ?? ""),
				);
			})
			.catch(() => {
				if (!cancelled) setError("Couldn't load your repos — check your connection.");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// ReportDialog renders nothing until it hears this. Normally the SDK
	// provider's openReportDialog() fires it; there's no provider here.
	useEffect(() => {
		if (payload?.sessionId) window.dispatchEvent(new CustomEvent("glitchgrab:open-report"));
	}, [payload?.sessionId]);

	const captureScreenshot = useCallback(async (): Promise<string | null> => {
		if (!initialShotUsed.current) {
			initialShotUsed.current = true;
			if (payload?.screenshotDataUrl) return payload.screenshotDataUrl;
		}
		return (await gg()?.recaptureScreen()) ?? null;
	}, [payload?.screenshotDataUrl]);

	const report: ReportFn = useCallback(
		async (
			type: ReportType,
			description: string,
			metadata?: Record<string, string>,
		): Promise<ReportResult | null> => {
			const api = gg();
			if (!api) return { success: false, message: "Bridge unavailable" };
			if (!repoId) return { success: false, message: "Pick a repo first" };

			const result = await api.submitReport({ repoId, type, description, metadata });
			if (!result.ok) return { success: false, message: result.error };
			// Give the success state a beat to render before the window goes away.
			setTimeout(() => void api.closeReport(), 2500);
			return {
				success: true,
				issueUrl: result.issueUrl,
				issueNumber: result.issueNumber,
				title: result.title,
				intent: "create",
			};
		},
		[repoId],
	);

	if (error) {
		return <div className="gg-report-msg gg-report-msg--error">{error}</div>;
	}

	if (!payload) {
		return <div className="gg-report-msg">Loading…</div>;
	}

	if (payload.repos.length === 0) {
		return (
			<div className="gg-report-msg gg-report-msg--error">
				No repos assigned to you yet — ask the org owner to add you as a tester or connect a
				repo.
			</div>
		);
	}

	return (
		<div className="gg-report-window">
			<header className="gg-report-header">
				<div className="gg-report-title">Report a bug</div>
				{payload.reporterName && (
					<div className="gg-report-reporter">as {payload.reporterName}</div>
				)}
			</header>

			<label className="gg-report-field">
				Repo
				<select
					value={repoId}
					onChange={(e) => {
						setRepoId(e.target.value);
						localStorage.setItem(LAST_REPO_KEY, e.target.value);
					}}
				>
					{payload.repos.map((r) => (
						<option key={r.id} value={r.id}>
							{r.fullName}
						</option>
					))}
				</select>
			</label>

			<ReportDialog report={report} captureScreenshot={captureScreenshot} />
		</div>
	);
}
