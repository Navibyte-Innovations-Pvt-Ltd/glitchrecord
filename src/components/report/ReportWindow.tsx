import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AssistFn,
	FindSimilarIssuesFn,
	ReportFn,
	ReportReporter,
	ReportResult,
	ReportType,
} from "../../vendor/report-ui";
import { ReportDialog } from "../../vendor/report-ui";

/**
 * The desktop "Report Bug" window — for bugs in GlitchRecord itself.
 *
 * Renders the SAME dialog component the npm SDK ships (packages/report-ui,
 * synced into src/vendor by scripts/sync-report-ui.mjs), so the bug-reporting
 * UI is identical everywhere and only has to be changed once.
 *
 * What's different from the SDK/extension hosts:
 *  - it always files into the GlitchRecord repo — no repo picker. Bugs in a
 *    web app being tested are filed from Chrome with ⌘⇧G instead.
 *  - the screenshot is the GlitchRecord window the reporter was in (main
 *    process, `capturePage`), and the dialog fills this window (`layout="fill"`).
 *  - submission goes through the main process, which holds the reporter
 *    session (a QA tester's, or the signed-in owner's) and the repo scope.
 */

interface RepoOption {
	id: string;
	fullName: string;
	/** Owner's AI report assistant switch (#330), per repo. */
	aiAssistEnabled?: boolean;
}

interface ReportPayload {
	sessionId: string | null;
	reporterName: string | null;
	repos: RepoOption[];
	screenshotDataUrl: string | null;
	/** The saved GlitchRecord sign-in was rejected and has been cleared. */
	authExpired?: boolean;
	/** Version, platform and which GlitchRecord window the bug was in. */
	app?: { version: string; platform: string; window: string | null };
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
	assistReport: (payload: {
		repoId: string;
		messages: Array<{ role: "user" | "assistant"; content: string }>;
		conversationId: string | null;
		screenshot?: string | null;
		context?: Record<string, unknown> | null;
	}) => Promise<{
		conversationId: string | null;
		question: string | null;
		report: string | null;
		degraded: string | null;
		retryable?: boolean;
	}>;
	findSimilarIssues: (payload: {
		repoId: string;
		text: string;
	}) => Promise<Array<{ number: number; title: string; url: string; status?: string }> | null>;
	closeReport: () => Promise<{ ok: boolean }>;
	login: () => Promise<{ ok: boolean }>;
	onAuthChanged?: (cb: (status: { loggedIn: boolean }) => void) => () => void;
}

function gg(): GlitchgrabReportAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabReportAPI }).glitchgrab ?? null;
}

/** Where every GlitchRecord bug goes. Matched case-insensitively against the session's repos. */
const GLITCHRECORD_REPO = "Navibyte-Innovations-Pvt-Ltd/glitchrecord";

export function ReportWindow() {
	const [payload, setPayload] = useState<ReportPayload | null>(null);
	const [repoId, setRepoId] = useState("");
	const [error, setError] = useState<string | null>(null);
	// The screenshot taken just before this window opened is what the reporter
	// actually saw, so it wins the first capture. "Retake" then goes live.
	const initialShotUsed = useRef(false);
	// Bumped when sign-in completes, so the window loads itself instead of
	// making the reporter close it and press ⌘⇧G again.
	const [loadKey, setLoadKey] = useState(0);

	useEffect(() => {
		return gg()?.onAuthChanged?.((status) => {
			if (status.loggedIn) setLoadKey((k) => k + 1);
		});
	}, []);

	useEffect(() => {
		const api = gg();
		if (!api) {
			setError("Bridge unavailable — restart GlitchRecord.");
			return;
		}
		let cancelled = false;
		setError(null);
		api.reportPayload()
			.then((p) => {
				if (cancelled) return;
				setPayload(p);
				if (!p.sessionId) {
					setError(
						p.authExpired
							? "Your GlitchRecord sign-in expired. Sign in again to file this report."
							: "Sign in to Glitchgrab to file a report — or open your QA link and press “Open in GlitchRecord”.",
					);
					return;
				}
				setRepoId(
					p.repos.find((r) => r.fullName.toLowerCase() === GLITCHRECORD_REPO.toLowerCase())?.id ??
						"",
				);
			})
			.catch(() => {
				if (!cancelled) setError("Couldn't load your repos — check your connection.");
			});
		return () => {
			cancelled = true;
		};
	}, [loadKey]);

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

	/**
	 * One turn of the AI report assistant (#330), routed through the main
	 * process so the reporter session stays out of the renderer. Wired only when
	 * the selected repo has it switched on; the server re-checks anyway.
	 */
	const assist: AssistFn = useCallback(
		async (params) => {
			const api = gg();
			const offline = {
				conversationId: null,
				question: null,
				report: null,
				degraded:
					"The assistant is unavailable — write your report below and send it as normal.",
			};
			if (!api || !repoId) return offline;
			try {
				return await api.assistReport({ repoId, ...params });
			} catch {
				return offline;
			}
		},
		[repoId],
	);

	/** Plain form's "is this already filed?" on Send, via main (session stays there). */
	const findSimilarIssues: FindSimilarIssuesFn = useCallback(
		async (description) => {
			const api = gg();
			if (!api || !repoId) return null;
			try {
				return await api.findSimilarIssues({ repoId, text: description });
			} catch {
				return null;
			}
		},
		[repoId],
	);

	if (error) {
		// Signed out is a step to take, not a failure — and it needs a way forward.
		const signedOut = !!payload && !payload.sessionId;
		return (
			<div className={`gg-report-msg gg-report-msg--gate${signedOut ? "" : " gg-report-msg--error"}`}>
				<p>{error}</p>
				<div className="gg-report-msg-actions">
					{signedOut && (
						<button
							type="button"
							className="gg-report-btn gg-report-btn--primary"
							onClick={() => void gg()?.login()}
						>
							Connect Glitchgrab
						</button>
					)}
					<button type="button" className="gg-report-btn" onClick={() => void gg()?.closeReport()}>
						Close
					</button>
				</div>
			</div>
		);
	}

	if (!payload) {
		return <div className="gg-report-msg">Loading…</div>;
	}

	const repo = payload.repos.find((r) => r.id === repoId);
	if (!repo) {
		return (
			<div className="gg-report-msg gg-report-msg--gate gg-report-msg--error">
				<p>
					GlitchRecord bugs go to {GLITCHRECORD_REPO}, and this Glitchgrab account can't file
					there yet. Ask the owner to add you to that repo.
				</p>
				<div className="gg-report-msg-actions">
					<button type="button" className="gg-report-btn" onClick={() => void gg()?.closeReport()}>
						Close
					</button>
				</div>
			</div>
		);
	}

	const reporter: ReportReporter | null = payload.reporterName
		? { name: payload.reporterName, email: null, role: null }
		: null;

	return (
		<ReportDialog
			layout="fill"
			types={["BUG"]}
			report={report}
			assist={repo.aiAssistEnabled ? assist : undefined}
			findSimilarIssues={repo.aiAssistEnabled ? findSimilarIssues : undefined}
			assistContext={{ product: "GlitchRecord desktop app", ...(payload.app ?? {}) }}
			reporter={reporter}
			captureScreenshot={captureScreenshot}
			onClose={() => void gg()?.closeReport()}
		/>
	);
}
