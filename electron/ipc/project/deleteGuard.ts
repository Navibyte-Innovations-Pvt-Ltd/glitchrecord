import path from "node:path";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";

// Extensions a delete is allowed to touch (current + legacy project files).
const DELETABLE_EXTS = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS].map(
	(e) => `.${e.toLowerCase()}`,
);

// Guard for `delete-project`: only a project file INSIDE the projects directory
// may be deleted. Mirrors the recording guard — resolves both paths and checks
// containment so directory-traversal ("../../etc/passwd") and stray extensions
// can't slip through. Returns the resolved absolute path, or null if not allowed.
export function isDeletableProjectPath(
	filePath: unknown,
	projectsDir: unknown,
): string | null {
	if (typeof filePath !== "string" || !filePath) return null;
	if (typeof projectsDir !== "string" || !projectsDir) return null;
	const resolved = path.resolve(filePath);
	const dir = path.resolve(projectsDir) + path.sep;
	if (!resolved.startsWith(dir)) return null;
	const ext = path.extname(resolved).toLowerCase();
	return DELETABLE_EXTS.includes(ext) ? resolved : null;
}
