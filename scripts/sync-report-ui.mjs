// Copies the shared bug-report dialog (packages/report-ui) into
// src/vendor/report-ui so GlitchRecord's "Report Bug" window renders the EXACT
// same UI as the npm SDK's ReportButton. Update the SDK dialog once, both
// surfaces change.
//
// Why a copy instead of a dependency: apps/glitchrecord is a separate git
// submodule with its own package.json and its own `npm ci` CI job. It is not
// part of the bun workspace, so `"@glitchgrab/report-ui": "workspace:*"` can't
// resolve, and a `file:../../packages/report-ui` path breaks the moment the
// submodule is cloned on its own (which .github/workflows/build.yml does).
// So: sync from source when the monorepo is present, and fall back to the
// committed copy when it isn't.
//
// Bonus: copying *source* (not the built dist) means the dialog compiles
// against GlitchRecord's own React 18, which sidesteps the duplicate-React
// "Cannot read properties of null (reading 'useState')" crash the Chrome
// extension hit when it bundled report-ui's own nested React.
//
// The output is committed. Do not hand-edit it — edit packages/report-ui and
// re-run this.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../../packages/report-ui/src");
const DEST = path.resolve(here, "../src/vendor/report-ui");

const BANNER = `// GENERATED FILE — do not edit.
// Synced from packages/report-ui/src by scripts/sync-report-ui.mjs.
// Edit the source there and re-run \`npm run sync:report-ui\`.
`;

if (!fs.existsSync(SRC)) {
	// Standalone clone of the GlitchRecord repo — the monorepo isn't around.
	// The committed copy in src/vendor/report-ui is what builds.
	console.log("[sync-report-ui] packages/report-ui not found — using committed copy.");
	process.exit(0);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

let copied = 0;
for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
	// Tests stay in the source package — they'd only add a vitest surface here.
	if (!entry.isFile()) continue;
	if (!/\.(ts|tsx)$/.test(entry.name)) continue;

	const body = fs.readFileSync(path.join(SRC, entry.name), "utf8");
	fs.writeFileSync(path.join(DEST, entry.name), BANNER + body, "utf8");
	copied++;
}

console.log(`[sync-report-ui] synced ${copied} file(s) → src/vendor/report-ui`);
