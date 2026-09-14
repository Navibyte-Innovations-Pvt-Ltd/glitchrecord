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
 * Report Bug inside the GlitchRecord window you are in — for bugs in GlitchRecord itself.
 *
 * Mounted in Home and the editor. The Report Bug button or ⌘⇧G (File menu) slides the
 * shared report dialog in as a right-side sheet over the page (`layout="sheet"`) — the
 * same dialog the npm SDK renders inside a web app, synced into src/vendor by
 * scripts/sync-report-ui.mjs. It used to open a separate window, which took the
 * reporter away from the screen they were describing.
 *
 *  - always files into the GlitchRecord repo, no repo picker. Bugs in a web app being
 *    tested are filed from Chrome with ⌘⇧G instead.
 *  - the screenshot is this window, taken before the sheet shows; a Retake hides the
 *    sheet for a frame first. From the recording HUD, main opens it in Home with the
 *    HUD's screenshot attached.
 *  - submission goes through the main process, which holds the reporter session.
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
	/** The saved GlitchRecord sign-in was rejected and has been cleared. */
	authExpired?: boolean;
	/** Version, platform and which GlitchRecord window the bug was in. */
	app?: { version: string; platform: string; window: string | null };
}

/** From main, when ⌘⇧G was pressed in a window that can't hold a sheet (the HUD). */
interface OpenRequest {
	screenshot?: string | null;
	source?: string | null;
}

interface GlitchgrabReportAPI {
	reportPayload: () => Promise<ReportPayload>;
	captureSelf: () => Promise<string | null>;
	takePendingReport: () => Promise<OpenRequest | null>;
	onOpenReport: (cb: (request: OpenRequest) => void) => () => void;
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
	login: () => Promise<{ ok: boolean }>;
	onAuthChanged?: (cb: (status: { loggedIn: boolean }) => void) => () => void;
}

function gg(): GlitchgrabReportAPI | null {
	return (window as unknown as { glitchgrab?: GlitchgrabReportAPI }).glitchgrab ?? null;
}

/** Where every GlitchRecord bug goes. Matched case-insensitively against the session's repos. */
const GLITCHRECORD_REPO = "Navibyte-Innovations-Pvt-Ltd/glitchrecord";

/** Home's Report Bug button dispatches this; ⌘⇧G arrives over IPC instead. */
export const OPEN_REPORT_EVENT = "gg:report-bug";

type Phase =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "gate"; message: string; signedOut: boolean }
	| { kind: "open" };

/** Lets the compositor drop anything just hidden before a window capture. */
const nextFrame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export function InlineReport() {
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [payload, setPayload] = useState<ReportPayload | null>(null);
	const [repo, setRepo] = useState<RepoOption | null>(null);
	const phaseRef = useRef<Phase["kind"]>("idle");
	const request = useRef<OpenRequest>({});
	const initialShotUsed = useRef(false);

	const go = useCallback((next: Phase) => {
		phaseRef.current = next.kind;
		setPhase(next);
	}, []);

	const close = useCallback(() => {
		request.current = {};
		go({ kind: "idle" });
	}, [go]);

	const start = useCallback(
		async (req: OpenRequest = {}) => {
			const api = gg();
			// A second ⌘⇧G while it is already up does nothing.
			if (!api || phaseRef.current === "loading" || phaseRef.current === "open") return;
			request.current = req;
			initialShotUsed.current = false;
			go({ kind: "loading" });
			try {
				const p = await api.reportPayload();
				setPayload(p);
				if (!p.sessionId) {
					go({
						kind: "gate",
						signedOut: true,
						message: p.authExpired
							? "Your GlitchRecord sign-in expired. Sign in again to file this report."
							: "Sign in to Glitchgrab to report a bug in GlitchRecord — or open your QA link and press “Open in GlitchRecord”.",
					});
					return;
				}
				const match = p.repos.find(
					(r) => r.fullName.toLowerCase() === GLITCHRECORD_REPO.toLowerCase(),
				);
				if (!match) {
					go({
						kind: "gate",
						signedOut: false,
						message: `GlitchRecord bugs go to ${GLITCHRECORD_REPO}, and this Glitchgrab account can't file there yet. Ask the owner to add you to that repo.`,
					});
					return;
				}
				setRepo(match);
				go({ kind: "open" });
			} catch {
				go({
					kind: "gate",
					signedOut: false,
					message: "Couldn't load your repos — check your connection.",
				});
			}
		},
		[go],
	);

	useEffect(() => {
		const api = gg();
		const onButton = () => void start();
		window.addEventListener(OPEN_REPORT_EVENT, onButton);
		const offIpc = api?.onOpenReport((req) => void start(req));
		// Opened from the HUD before this window existed or finished loading.
		void api?.takePendingReport().then((req) => {
			if (req) void start(req);
		});
		// Signed in from the gate — carry on instead of making them press it again.
		const offAuth = api?.onAuthChanged?.((status) => {
			if (status.loggedIn && phaseRef.current === "gate") {
				phaseRef.current = "idle";
				void start(request.current);
			}
		});
		return () => {
			window.removeEventListener(OPEN_REPORT_EVENT, onButton);
			offIpc?.();
			offAuth?.();
		};
	}, [start]);

	// ReportDialog renders nothing until it hears this; it mounts in the same commit.
	useEffect(() => {
		if (phase.kind === "open") window.dispatchEvent(new CustomEvent("glitchgrab:open-report"));
	}, [phase.kind]);

	const captureScreenshot = useCallback(async (): Promise<string | null> => {
		const api = gg();
		if (!api) return null;
		if (!initialShotUsed.current) {
			initialShotUsed.current = true;
			// From the HUD: main already photographed what was in front.
			if (request.current.screenshot) return request.current.screenshot;
		}
		// The dialog captures before it shows, but the loading panel may still be on
		// screen — and on Retake the sheet itself is. Step out of frame first.
		const layers = [
			...document.querySelectorAll<HTMLElement>("[data-glitchgrab-layer], .gg-inline-report-backdrop"),
		];
		for (const el of layers) el.style.visibility = "hidden";
		await nextFrame();
		try {
			return await api.captureSelf();
		} finally {
			for (const el of layers) el.style.visibility = "";
		}
	}, []);

	const report: ReportFn = useCallback(
		async (
			type: ReportType,
			description: string,
			metadata?: Record<string, string>,
		): Promise<ReportResult | null> => {
			const api = gg();
			if (!api) return { success: false, message: "Bridge unavailable" };
			if (!repo) return { success: false, message: "GlitchRecord's repo isn't available" };

			const result = await api.submitReport({ repoId: repo.id, type, description, metadata });
			if (!result.ok) return { success: false, message: result.error };
			// Give the success state a beat to render before the sheet goes away.
			setTimeout(close, 2500);
			return {
				success: true,
				issueUrl: result.issueUrl,
				issueNumber: result.issueNumber,
				title: result.title,
				intent: "create",
			};
		},
		[repo, close],
	);

	/**
	 * One turn of the AI report assistant (#330), routed through the main
	 * process so the reporter session stays out of the renderer. Wired only when
	 * the repo has it switched on; the server re-checks anyway.
	 */
	const assist: AssistFn = useCallback(
		async (params) => {
			const api = gg();
			const offline = {
				conversationId: null,
				question: null,
				report: null,
				degraded: "The assistant is unavailable — write your report below and send it as normal.",
			};
			if (!api || !repo) return offline;
			try {
				return await api.assistReport({ repoId: repo.id, ...params });
			} catch {
				return offline;
			}
		},
		[repo],
	);

	/** Plain form's "is this already filed?" on Send, via main (session stays there). */
	const findSimilarIssues: FindSimilarIssuesFn = useCallback(
		async (description) => {
			const api = gg();
			if (!api || !repo) return null;
			try {
				return await api.findSimilarIssues({ repoId: repo.id, text: description });
			} catch {
				return null;
			}
		},
		[repo],
	);

	if (phase.kind === "idle") return null;

	if (phase.kind === "loading" || phase.kind === "gate") {
		return (
			<div className="gg-inline-report-backdrop">
				<aside className="gg-inline-report-panel" aria-label="Report a bug">
					{phase.kind === "loading" ? (
						<p className="gg-inline-report-muted">Opening Report Bug…</p>
					) : (
						<>
							<p className={phase.signedOut ? undefined : "gg-inline-report-error"}>
								{phase.message}
							</p>
							<div className="gg-inline-report-actions">
								{phase.signedOut && (
									<button
										type="button"
										className="gg-report-btn gg-report-btn--primary"
										onClick={() => void gg()?.login()}
									>
										Connect Glitchgrab
									</button>
								)}
								<button type="button" className="gg-report-btn" onClick={close}>
									Close
								</button>
							</div>
						</>
					)}
				</aside>
			</div>
		);
	}

	if (!repo || !payload) return null;

	const reporter: ReportReporter | null = payload.reporterName
		? { name: payload.reporterName, email: null, role: null }
		: null;

	return (
		<ReportDialog
			layout="sheet"
			types={["BUG"]}
			// Already a bug — open on the chat; "how bad is it?" comes with the draft.
			severityTiming="with-draft"
			report={report}
			assist={repo.aiAssistEnabled ? assist : undefined}
			findSimilarIssues={repo.aiAssistEnabled ? findSimilarIssues : undefined}
			assistContext={{
				product: "GlitchRecord desktop app",
				...(payload.app ?? {}),
				...(request.current.source ? { window: request.current.source } : {}),
			}}
			reporter={reporter}
			captureScreenshot={captureScreenshot}
			onClose={close}
		/>
	);
}
