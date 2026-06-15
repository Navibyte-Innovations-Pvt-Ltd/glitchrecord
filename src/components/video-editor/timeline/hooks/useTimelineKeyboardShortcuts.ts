import { type RefObject, useEffect } from "react";
import { matchesShortcut } from "@/lib/shortcuts";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import { resolveDeleteSelectionTarget } from "./utils/timelineSelectionUtils";

interface UseTimelineKeyboardShortcutsParams {
	isMac: boolean;
	keyShortcuts: TimelineShortcutBindings;
	isTimelineFocusedRef: RefObject<boolean>;
	hasAnyZoomBlocks: boolean;
	activateSelectAllZooms: () => void;
	annotationCount: number;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectAllBlocksActive: boolean;
	addKeyframe: () => void;
	handleAddZoom: () => void;
	handleSplitClip: () => void;
	handleTrimToEnd: () => void;
	handleAddAnnotation: () => void;
	deleteSelectedKeyframe: () => void;
	deleteSelectedZoom: () => void;
	deleteSelectedClip: () => void;
	deleteSelectedAnnotation: () => void;
	deleteSelectedAudio: () => void;
	cycleAnnotationsAtCurrentTime: (backward?: boolean) => boolean;
}

export function useTimelineKeyboardShortcuts({
	isMac,
	keyShortcuts,
	isTimelineFocusedRef,
	hasAnyZoomBlocks,
	activateSelectAllZooms,
	annotationCount,
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectAllBlocksActive,
	addKeyframe,
	handleAddZoom,
	handleSplitClip,
	handleTrimToEnd,
	handleAddAnnotation,
	deleteSelectedKeyframe,
	deleteSelectedZoom,
	deleteSelectedClip,
	deleteSelectedAnnotation,
	deleteSelectedAudio,
	cycleAnnotationsAtCurrentTime,
}: UseTimelineKeyboardShortcutsParams) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const eventTarget = e.target;
			if (
				eventTarget instanceof HTMLInputElement ||
				eventTarget instanceof HTMLTextAreaElement ||
				eventTarget instanceof HTMLSelectElement ||
				(eventTarget instanceof HTMLElement && eventTarget.isContentEditable)
			) {
				// [GG-DEL-DEBUG] remove once delete-key flow is confirmed
				if (e.key === "Delete" || e.key === "Backspace") {
					console.debug("[GG-DEL] blocked by input-target guard", {
						key: e.key,
						targetTag: (eventTarget as HTMLElement)?.tagName,
					});
				}
				return;
			}

			if (!isTimelineFocusedRef.current) {
				// Allow Delete/Backspace to act on a selected timeline item even when
				// focus has moved off the timeline (e.g. to the clip settings panel
				// after selecting a clip). The text-input guards above already prevent
				// hijacking Delete while typing. Other shortcuts still require focus.
				const isDeleteKey =
					e.key === "Delete" ||
					e.key === "Backspace" ||
					matchesShortcut(e, keyShortcuts.deleteSelected, isMac);
				const hasSelection = Boolean(
					selectAllBlocksActive ||
						selectedKeyframeId ||
						selectedZoomId ||
						selectedClipId ||
						selectedAnnotationId ||
						selectedAudioId,
				);
				if (isDeleteKey) {
					// [GG-DEL-DEBUG] remove once delete-key flow is confirmed
					console.debug("[GG-DEL] not-focused gate", {
						key: e.key,
						hasSelection,
						willProceed: isDeleteKey && hasSelection,
					});
				}
				if (!(isDeleteKey && hasSelection)) {
					return;
				}
			}

			if (matchesShortcut(e, { key: "a", ctrl: true }, isMac)) {
				if (!hasAnyZoomBlocks) {
					return;
				}
				e.preventDefault();
				activateSelectAllZooms();
				return;
			}

			if (matchesShortcut(e, keyShortcuts.addKeyframe, isMac)) addKeyframe();
			if (matchesShortcut(e, keyShortcuts.addZoom, isMac)) handleAddZoom();
			if (matchesShortcut(e, keyShortcuts.splitClip, isMac)) handleSplitClip();
			if (matchesShortcut(e, keyShortcuts.trimToEnd, isMac)) handleTrimToEnd();
			if (matchesShortcut(e, keyShortcuts.addAnnotation, isMac)) {
				handleAddAnnotation();
			}

			if (e.key === "Tab" && annotationCount > 0) {
				if (cycleAnnotationsAtCurrentTime(e.shiftKey)) {
					e.preventDefault();
				}
			}

			if (
				e.key === "Delete" ||
				e.key === "Backspace" ||
				matchesShortcut(e, keyShortcuts.deleteSelected, isMac)
			) {
				const target = resolveDeleteSelectionTarget({
					selectAllBlocksActive,
					selectedKeyframeId,
					selectedZoomId,
					selectedClipId,
					selectedAnnotationId,
					selectedAudioId,
				});
				// [GG-DEL-DEBUG] remove once delete-key flow is confirmed
				console.debug("[GG-DEL] keydown", {
					key: e.key,
					timelineFocused: isTimelineFocusedRef.current,
					target,
					selectedClipId,
					selectedZoomId,
					selectedKeyframeId,
					selectedAnnotationId,
					selectedAudioId,
					activeEl:
						typeof document !== "undefined"
							? document.activeElement?.tagName
							: undefined,
				});
				if (target !== "none") {
					e.preventDefault();
				}
				if (target === "keyframe") {
					deleteSelectedKeyframe();
				} else if (target === "zoom") {
					deleteSelectedZoom();
				} else if (target === "clip") {
					deleteSelectedClip();
				} else if (target === "annotation") {
					deleteSelectedAnnotation();
				} else if (target === "audio") {
					deleteSelectedAudio();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		activateSelectAllZooms,
		addKeyframe,
		annotationCount,
		cycleAnnotationsAtCurrentTime,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedClip,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		handleAddAnnotation,
		handleAddZoom,
		handleSplitClip,
		handleTrimToEnd,
		hasAnyZoomBlocks,
		isMac,
		isTimelineFocusedRef,
		keyShortcuts,
		selectAllBlocksActive,
		selectedAnnotationId,
		selectedAudioId,
		selectedClipId,
		selectedKeyframeId,
		selectedZoomId,
	]);
}
