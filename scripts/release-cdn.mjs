// Publish a GlitchRecord build to https://cdn.glitchgrab.dev/glitchrecord/.
//
//   bun run release:cdn                   Mac here + Windows/Linux on CI
//   bun run release:cdn -- --mac-only     skip the CI builds
//   bun run release:cdn -- --skip-build   upload what is already in release/
//
// S3 keys come from the monorepo root .env (dotenvx, see package.json), so no
// AWS secret lives in GitHub. CDN layout:
//   glitchrecord/<version>/<installers + blockmaps>      immutable
//   glitchrecord/latest/<installer>                       stable team download links
//   glitchrecord/latest-mac.yml, latest.yml, latest-linux.yml   auto-update feed
// Feed files go up last, so no app ever reads a feed pointing at missing files.
// Full flow: RELEASING.md.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const REPO = "Navibyte-Innovations-Pvt-Ltd/glitchgrab";
const WORKFLOW = "glitchrecord-build.yml";
const PREFIX = "glitchrecord";
const CDN_BASE = `https://cdn.glitchgrab.dev/${PREFIX}`;

const appRoot = process.cwd();
const monorepoRoot = path.resolve(appRoot, "..", "..");
const releaseDir = path.join(appRoot, "release");
const ciDir = path.join(releaseDir, "ci");
const flags = new Set(process.argv.slice(2));
const macOnly = flags.has("--mac-only");
const skipBuild = flags.has("--skip-build");
const { version } = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));

const INSTALLER = /\.(dmg|zip|exe|AppImage)$/;
const BLOCKMAP = /\.blockmap$/;
const FEED = /^latest(-mac|-linux)?\.yml$/;
const CONTENT_TYPES = {
	".dmg": "application/x-apple-diskimage",
	".zip": "application/zip",
	".exe": "application/vnd.microsoft.portable-executable",
	".AppImage": "application/octet-stream",
	".blockmap": "application/octet-stream",
	".yml": "text/yaml; charset=utf-8",
};

function run(cmd, args, options = {}) {
	console.log(`\n$ ${cmd} ${args.join(" ")}`);
	const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
	if (result.status !== 0) throw new Error(`${cmd} ${args[0]} exited with ${result.status}`);
}

function read(cmd, args) {
	return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function requireEnv(...names) {
	for (const name of names) {
		if (process.env[name]) return process.env[name];
	}
	throw new Error(`${names[0]} is not set — run through \`bun run release:cdn\` so the root .env is loaded.`);
}

async function dispatchCiBuild() {
	const ref = read("git", ["-C", monorepoRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
	const dirty = read("git", ["-C", monorepoRoot, "status", "--porcelain", "--", "apps/glitchrecord"]);
	if (dirty) {
		console.warn(`\n⚠ Uncommitted changes under apps/glitchrecord — CI builds what is pushed to ${ref}.`);
	}

	const startedAt = Date.now();
	run("gh", ["workflow", "run", WORKFLOW, "--repo", REPO, "--ref", ref]);

	for (let attempt = 0; attempt < 20; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 3000));
		const runs = JSON.parse(
			read("gh", [
				"run", "list", "--repo", REPO, "--workflow", WORKFLOW, "--branch", ref,
				"--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,createdAt",
			]),
		);
		const fresh = runs.find((r) => Date.parse(r.createdAt) >= startedAt - 60_000);
		if (fresh) return String(fresh.databaseId);
	}
	throw new Error(`Dispatched ${WORKFLOW} but could not find its run.`);
}

function collectCiArtifacts(runId) {
	run("gh", ["run", "watch", runId, "--repo", REPO, "--exit-status"]);
	fs.rmSync(ciDir, { recursive: true, force: true });
	run("gh", ["run", "download", runId, "--repo", REPO, "--dir", ciDir]);
}

function buildMac() {
	if (process.platform !== "darwin") throw new Error("The Mac build has to run on macOS.");
	fs.rmSync(releaseDir, { recursive: true, force: true });
	run("npm", ["run", "build:mac", "--", "--publish", "never"], {
		env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
	});
}

function filesIn(dir, recursive) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return recursive ? filesIn(full, true) : [];
		return [full];
	});
}

function feedVersion(file) {
	return fs.readFileSync(file, "utf8").match(/^version:\s*(\S+)\s*$/m)?.[1];
}

// Installers live under <version>/, the feed one level up — prefix the bare
// file names electron-builder writes so the updater resolves them.
function rewriteFeed(text) {
	return text
		.split("\n")
		.map((line) =>
			line.replace(/^(\s*(?:-\s*)?(?:url|path):\s*)(\S+)\s*$/, (match, head, value) =>
				value.includes("/") ? match : `${head}${version}/${value}`,
			),
		)
		.join("\n");
}

function contentType(file) {
	const ext = file.endsWith(".AppImage") ? ".AppImage" : path.extname(file);
	return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function main() {
	// Fail before a 15-minute build, not after it.
	const region = requireEnv("NEXT_AWS_S3_REGION", "AWS_S3_REGION");
	const bucket = requireEnv("NEXT_AWS_BUCKET_NAME", "AWS_S3_BUCKET_NAME");
	const accessKeyId = requireEnv("NEXT_AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
	const secretAccessKey = requireEnv("NEXT_AWS_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");

	if (!skipBuild) {
		const runId = macOnly ? null : await dispatchCiBuild();
		buildMac();
		if (runId) collectCiArtifacts(runId);
	}

	const files = [...filesIn(releaseDir, false), ...(macOnly ? [] : filesIn(ciDir, true))];
	const binaries = files.filter((f) => INSTALLER.test(f) || BLOCKMAP.test(f));
	const feeds = files.filter((f) => FEED.test(path.basename(f)));

	const names = new Set();
	for (const file of [...binaries, ...feeds]) {
		const name = path.basename(file);
		if (names.has(name)) throw new Error(`Two release files are both named ${name}.`);
		names.add(name);
	}

	const requiredFeeds = macOnly ? ["latest-mac.yml"] : ["latest-mac.yml", "latest.yml", "latest-linux.yml"];
	for (const name of requiredFeeds) {
		const feed = feeds.find((f) => path.basename(f) === name);
		if (!feed) throw new Error(`${name} is missing from release/ — did the build finish?`);
		const built = feedVersion(feed);
		if (built !== version) {
			throw new Error(`${name} is version ${built}, package.json says ${version}. Rebuild.`);
		}
	}

	const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
	const put = async (key, file, body, cacheControl) => {
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: body ?? fs.createReadStream(file),
				ContentLength: body ? Buffer.byteLength(body) : fs.statSync(file).size,
				ContentType: contentType(file),
				CacheControl: cacheControl,
			}),
		);
		console.log(`  ↑ ${key}`);
	};

	console.log(`\nUploading GlitchRecord ${version} to s3://${bucket}/${PREFIX}/`);
	for (const file of binaries) {
		await put(`${PREFIX}/${version}/${path.basename(file)}`, file, null, "public, max-age=31536000, immutable");
	}
	for (const file of binaries.filter((f) => /\.(dmg|exe|AppImage)$/.test(f))) {
		await put(`${PREFIX}/latest/${path.basename(file)}`, file, null, "no-cache");
	}
	for (const file of feeds) {
		await put(`${PREFIX}/${path.basename(file)}`, file, rewriteFeed(fs.readFileSync(file, "utf8")), "no-cache");
	}

	// cdn.glitchgrab.dev was only ever proven to serve screenshots/ — check
	// the feed actually comes back through it before calling this a release.
	const check = await fetch(`${CDN_BASE}/latest-mac.yml`, { cache: "no-store" });
	const body = check.ok ? await check.text() : "";
	if (!check.ok || !body.includes(version)) {
		throw new Error(
			`Uploaded, but ${CDN_BASE}/latest-mac.yml answered ${check.status}. ` +
				`Allow ${PREFIX}/* on the CDN (bucket policy / CloudFront behavior, same as screenshots/*), ` +
				"then rerun with --skip-build. See RELEASING.md.",
		);
	}

	console.log(`\n✓ GlitchRecord ${version} is live. Team download links:`);
	for (const file of binaries.filter((f) => /\.(dmg|exe|AppImage)$/.test(f))) {
		console.log(`  ${CDN_BASE}/latest/${path.basename(file)}`);
	}
}

main().catch((error) => {
	console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
