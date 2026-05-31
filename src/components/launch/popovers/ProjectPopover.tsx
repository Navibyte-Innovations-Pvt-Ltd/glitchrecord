import type { ReactElement } from "react";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { HudPopover } from "./PopoverScaffold";
import ProjectBrowserDialog from "../../video-editor/ProjectBrowserDialog";
import type { ProjectLibraryEntry, RecordingEntry } from "../../video-editor/ProjectBrowserDialog";

const POPOVER_ID = "projects";

export function ProjectPopover({
	trigger,
	entries,
	onOpenProject,
	recordings,
	onOpenRecording,
	onOpen,
}: {
	trigger: ReactElement;
	entries: ProjectLibraryEntry[];
	onOpenProject: (projectPath: string) => void;
	recordings?: RecordingEntry[];
	onOpenRecording?: (recordingPath: string) => void;
	onOpen?: () => void;
}) {
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				onOpen?.();
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="center"
		>
			<ProjectBrowserDialog
				open={open}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) requestClose(POPOVER_ID);
				}}
				entries={entries}
				recordings={recordings}
				onOpenRecording={
					onOpenRecording
						? (path) => {
								onOpenRecording(path);
								requestClose(POPOVER_ID);
							}
						: undefined
				}
				renderMode="inline"
				onOpenProject={(path) => {
					onOpenProject(path);
					requestClose(POPOVER_ID);
				}}
			/>
		</HudPopover>
	);
}
