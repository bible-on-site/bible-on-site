/** Install changed dependencies and refresh a current local flip-book build. */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	copyLocalFlipBook,
	getLocalSnapshotDirectory,
	resolveLocalFlipBook,
} from "./copy-local-flip-book.mjs";

export function prepareDevDependencies(
	projectRoot,
	{ env = process.env, run = execSync } = {},
) {
	const local = resolveLocalFlipBook(projectRoot, env, true);
	const dep = JSON.parse(
		readFileSync(path.join(projectRoot, "package.json"), "utf8"),
	).dependencies?.["html-flip-book-react"];
	const stampPath = path.join(
		projectRoot,
		"node_modules",
		".predev-deps-stamp",
	);
	function inputsDigest() {
		const hash = createHash("sha256");
		for (const name of ["package.json", "bun.lock"]) {
			const file = path.join(projectRoot, name);
			hash.update(existsSync(file) ? readFileSync(file) : "");
		}
		return hash.digest("hex");
	}
	const installedPackage = path.join(
		projectRoot,
		"node_modules",
		"html-flip-book-react",
		"package.json",
	);
	const restoreRegistry =
		!local &&
		(lstatSync(path.dirname(installedPackage), {
			throwIfNoEntry: false,
		})?.isSymbolicLink() ||
			(existsSync(installedPackage) &&
				(existsSync(
					path.join(path.dirname(installedPackage), ".local-flip-book"),
				) ||
					JSON.parse(readFileSync(installedPackage, "utf8")).version !== dep)));
	const installed =
		!restoreRegistry &&
		existsSync(installedPackage) &&
		existsSync(path.join(projectRoot, "node_modules", ".bin")) &&
		existsSync(stampPath) &&
		readFileSync(stampPath, "utf8") === inputsDigest();
	if (!installed) {
		console.log(
			"predev-deps: dependencies not installed or changed — running bun install",
		);
		// Extract the registry package into an empty destination, since an
		// overwrite-only install can retain copied files and the local marker.
		const target = path.resolve(path.dirname(installedPackage));
		const modules = path.resolve(projectRoot, "node_modules");
		const previousSnapshot = restoreRegistry
			? getLocalSnapshotDirectory(target)
			: null;
		const backup = restoreRegistry
			? mkdtempSync(path.join(modules, ".flip-book-registry-"))
			: null;
		if (backup && path.dirname(backup) !== modules)
			throw new Error("Unexpected registry backup path");
		if (backup) renameSync(target, path.join(backup, "previous"));
		let installedRegistry = false;
		let retainBackup = false;
		try {
			// Refresh local code once below, after the website dependency install.
			run("bun install --prefer-offline", {
				cwd: projectRoot,
				stdio: "inherit",
				env: { ...env, USE_LOCAL_FLIP_BOOK: "0" },
			});
			installedRegistry = true;
		} catch (error) {
			if (backup) {
				try {
					rmSync(target, { recursive: true, force: true });
					renameSync(path.join(backup, "previous"), target);
				} catch (rollbackError) {
					retainBackup = true;
					throw new AggregateError(
						[error, rollbackError],
						`Registry flip-book rollback failed; previous package retained at ${path.join(backup, "previous")}`,
					);
				}
			}
			throw error;
		} finally {
			if (backup && !retainBackup) {
				rmSync(backup, { recursive: true, force: true });
				if (installedRegistry && previousSnapshot)
					rmSync(previousSnapshot, { recursive: true, force: true });
			}
		}
	}
	if (local) copyLocalFlipBook(projectRoot, { local, env, run });
	else if (installed)
		console.log(
			"predev-deps: dependencies unchanged — using published flip-book",
		);
	writeFileSync(stampPath, inputsDigest());
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	prepareDevDependencies(
		path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
	);
}
