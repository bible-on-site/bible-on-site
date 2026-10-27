/**
 * Toggles html-flip-book-react dependency between local file and npm version.
 * Usage:
 *   node scripts/toggle-flip-book-dep.mjs local   # Switch to file:../../../html-flip-book/react
 *   node scripts/toggle-flip-book-dep.mjs npm     # Switch to npm version
 *   node scripts/toggle-flip-book-dep.mjs check   # Exit 1 if local, 0 if npm (for pre-commit)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "..", "package.json");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

// The sibling html-flip-book repo renamed its package folders after the
// alpha.46 layout (react/, base/) to coherent names — accept both.
const LOCAL_REACT_DIRS = ["react", "html-flip-book-react"];
const NPM_VERSION = "0.0.0-alpha.75"; // Update this when upgrading

function localReactRef() {
	for (const dir of LOCAL_REACT_DIRS) {
		const pkgJson = path.join(
			repoRoot,
			"..",
			"html-flip-book",
			dir,
			"package.json",
		);
		// nosemgrep -- fixed local directory list, no user input
		if (fs.existsSync(pkgJson)) {
			return `file:../../../html-flip-book/${dir}`;
		}
	}
	// Fall back to the alpha.46 layout so the ref matches the consumed version.
	return `file:../../../html-flip-book/${LOCAL_REACT_DIRS[0]}`;
}

const mode = process.argv[2];

if (!["local", "npm", "check"].includes(mode)) {
	console.error("Usage: node toggle-flip-book-dep.mjs <local|npm|check>");
	process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const current = pkg.dependencies?.["html-flip-book-react"];
const isLocal = current?.startsWith("file:");

if (mode === "check") {
	if (isLocal) {
		console.error(
			"❌ html-flip-book-react is set to local. Run: bun run flip-book:npm",
		);
		process.exit(1);
	}
	process.exit(0);
}

const target = mode === "local" ? localReactRef() : NPM_VERSION;

if (current === target) {
	console.log(`html-flip-book-react already set to ${mode} (${target})`);
	process.exit(0);
}

pkg.dependencies["html-flip-book-react"] = target;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);

if (mode === "npm") {
	const nodeModulesLink = path.resolve(
		__dirname,
		"..",
		"node_modules",
		"html-flip-book-react",
	);
	try {
		const stat = fs.lstatSync(nodeModulesLink);
		if (stat.isSymbolicLink()) {
			fs.unlinkSync(nodeModulesLink);
		}
	} catch {
		// doesn't exist — fine
	}

	// bun install reconciles the lockfile's importer entries from
	// package.json, so the stale file: link is dropped automatically.
}

console.log(`html-flip-book-react switched to ${mode}: ${target}`);

if (mode === "local") {
	console.log("Run: bun install");
}
