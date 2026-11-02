/** Toggle the flip-book dependency, safely restoring registry files for npm mode. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDevDependencies } from "./predev-deps.mjs";

const projectDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const LOCAL_REACT_DIRS = ["react", "html-flip-book-react"];
export const NPM_VERSION = "0.0.0-alpha.98"; // Update this when upgrading

function localReactRef(projectRoot) {
	const repoRoot = path.resolve(projectRoot, "..", "..");
	for (const dir of LOCAL_REACT_DIRS) {
		const pkgJson = path.join(
			repoRoot,
			"..",
			"html-flip-book",
			dir,
			"package.json",
		);
		// nosemgrep -- fixed local directory list, no user input
		if (fs.existsSync(pkgJson)) return `file:../../../html-flip-book/${dir}`;
	}
	return `file:../../../html-flip-book/${LOCAL_REACT_DIRS[0]}`;
}

export function toggleFlipBookDependency(
	mode,
	{ projectRoot = projectDirectory, env = process.env, run } = {},
) {
	if (!["local", "npm", "check"].includes(mode)) {
		throw new Error("Usage: node toggle-flip-book-dep.mjs <local|npm|check>");
	}
	const pkgPath = path.join(projectRoot, "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
	const current = pkg.dependencies?.["html-flip-book-react"];
	if (mode === "check") {
		if (current?.startsWith("file:")) {
			throw new Error(
				"❌ html-flip-book-react is set to local. Run: bun run flip-book:npm",
			);
		}
		return;
	}
	const target = mode === "local" ? localReactRef(projectRoot) : NPM_VERSION;
	if (current !== target) {
		pkg.dependencies["html-flip-book-react"] = target;
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
		console.log(`html-flip-book-react switched to ${mode}: ${target}`);
	} else {
		console.log(`html-flip-book-react already set to ${mode} (${target})`);
	}
	if (mode === "npm") {
		// A local copied build deliberately leaves package.json pinned to npm.
		// Restore its files even when that pin/version has not changed, and
		// override an inherited local opt-in for the install's postinstall hook.
		prepareDevDependencies(projectRoot, {
			env: { ...env, USE_LOCAL_FLIP_BOOK: "0" },
			run,
		});
	} else if (current !== target) {
		console.log("Run: bun install");
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		toggleFlipBookDependency(process.argv[2]);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
