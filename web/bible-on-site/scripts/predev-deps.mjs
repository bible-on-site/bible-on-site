/**
 * Fast tail for `predev`: installs dependencies only when this checkout's
 * dependency inputs (package.json + package-lock.json) changed since the last
 * install, then refreshes the local html-flip-book build through the copy
 * script. Replaces the old "toggle to file: + npm install on every run" flow,
 * which rewrote package.json every session and paid a full dependency
 * resolution plus a nested npm install on each `npm run dev`.
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const flipRepoRoot = path.resolve(
	projectRoot,
	"..",
	"..",
	"..",
	"html-flip-book",
);

// The sibling html-flip-book repo renamed its package folders after the
// alpha.46 layout (react/, base/) — accept both.
function localReactDir() {
	for (const name of ["react", "html-flip-book-react"]) {
		if (existsSync(path.join(flipRepoRoot, name, "package.json"))) {
			return path.join(flipRepoRoot, name);
		}
	}
	return null;
}

const localFlipBook = localReactDir() !== null;

// package.json + lockfile are the install inputs; the stamp under node_modules
// records what the last install ran against, so a pulled dependency change
// re-installs while an unchanged checkout skips it.
const stampPath = path.join(projectRoot, "node_modules", ".predev-deps-stamp");
function inputsDigest() {
	const hash = createHash("sha256");
	for (const name of ["package.json", "package-lock.json"]) {
		const file = path.join(projectRoot, name);
		hash.update(existsSync(file) ? readFileSync(file) : "");
	}
	return hash.digest("hex");
}
const installed =
	existsSync(path.join(projectRoot, "node_modules", ".package-lock.json")) &&
	existsSync(stampPath) &&
	readFileSync(stampPath, "utf8") === inputsDigest();
const env = localFlipBook
	? { ...process.env, USE_LOCAL_FLIP_BOOK: "1" }
	: process.env;

const dep = JSON.parse(
	readFileSync(path.join(projectRoot, "package.json"), "utf8"),
).dependencies?.["html-flip-book-react"];
if (dep?.startsWith("file:") && !localFlipBook) {
	console.warn(
		"predev-deps: html-flip-book-react is a file: dependency but no local html-flip-book repo exists — run npm run flip-book:npm to restore the registry version",
	);
}

if (!installed) {
	console.log(
		"predev-deps: dependencies not installed or changed — running npm install",
	);
	execSync("npm install --prefer-offline", {
		cwd: projectRoot,
		stdio: "inherit",
		env,
	});
	writeFileSync(stampPath, inputsDigest());
} else if (localFlipBook) {
	// npm install is skipped when dependencies are unchanged; refresh just the
	// copied flip-book dist so local rebuilds still land in node_modules.
	console.log(
		"predev-deps: deps unchanged — refreshing local html-flip-book copy (skipping npm install)",
	);
	execFileSync(
		process.execPath,
		[path.join(projectRoot, "scripts", "copy-local-flip-book.mjs")],
		{ cwd: projectRoot, stdio: "inherit", env },
	);
} else {
	console.log(
		"predev-deps: deps unchanged and no local html-flip-book repo — skipping npm install",
	);
}
