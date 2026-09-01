// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run `npm run sync:report-ui`.
import type { DialogTile } from "./types";

/**
 * The human name of a tile.
 *
 * Lives here rather than inside `report-dialog` because the AI sheet now shows
 * the same tiles as its first turn (#330 follow-up). Two copies of this list
 * would drift the moment a type is added, and the reporter would see one name
 * in the dialog and a different one in the chat.
 */
export function getTypeLabel(type: DialogTile): string {
  switch (type) {
    case "RATING":
      return "Rating";
    case "BUG":
      return "Bug Report";
    case "FEATURE_REQUEST":
      return "Feature Request";
    case "UI_IMPROVEMENT":
      return "UI Improvement";
    case "PERFORMANCE":
      return "Performance";
    case "SECURITY":
      return "Security";
    case "QUESTION":
      return "Question";
    case "OTHER":
      return "Other";
  }
}
