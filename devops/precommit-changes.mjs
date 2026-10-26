/**
 * Staged-file set for module hooks.
 *
 * During a branch sync, changes are computed relative to the incoming target
 * (MERGE_HEAD) so incoming — already published — changes don't trigger module
 * checks; see test_precommit_merge.py.
 */
import { spawn, spawnSync } from "node:child_process";

/** @returns {string[]} staged, non-deleted paths with forward slashes */
export function getStagedChanges() {
	const mergeHead = spawnSync(
		"git",
		["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
		{ encoding: "utf8" },
	);
	const comparisonRef =
		mergeHead.status === 0 ? mergeHead.stdout.trim() : "HEAD";

	const diff = spawnSync(
		"git",
		["diff", "--cached", "--name-only", "--diff-filter=ACM", comparisonRef],
		{ encoding: "utf8" },
	);
	if (diff.status !== 0) {
		process.stderr.write(diff.stderr ?? "");
		process.exit(diff.status ?? 1);
	}
	return (diff.stdout ?? "").split("\n").filter(Boolean);
}

/** Run argv command inside dir, inheriting stdio. @returns {number} exit code */
export function runIn(dir, argv) {
	return (
		// shell stays enabled on Windows in case an entry ever resolves to a
		// .cmd shim; argv is fully static — no user input is shelled.
		spawnSync(argv[0], argv.slice(1), { // nosemgrep
			cwd: dir,
			shell: process.platform === "win32",
			stdio: "inherit",
		}).status ?? 1
	);
}

/**
 * Run argv inside dir like runIn, but keep a copy of stdout+stderr while still
 * streaming it live — callers inspect the output after exit.
 * @returns {Promise<{status: number, output: string}>}
 */
export function runInCapturing(dir, argv) {
	return new Promise((resolvePromise) => {
		// same shell rationale as runIn — argv stays repo-controlled.
		const child = spawn(argv[0], argv.slice(1), { // nosemgrep
			cwd: dir,
			shell: process.platform === "win32",
			stdio: ["inherit", "pipe", "pipe"],
		});
		let output = "";
		child.stdout?.on("data", (chunk) => {
			output += chunk;
			process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			output += chunk;
			process.stderr.write(chunk);
		});
		child.on("error", () => resolvePromise({ status: 1, output }));
		child.on("close", (status) =>
			resolvePromise({ status: status ?? 1, output }),
		);
	});
}
