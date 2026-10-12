/**
 * Staged-file set for module hooks.
 *
 * During a branch sync, changes are computed relative to the incoming target
 * (MERGE_HEAD) so incoming — already published — changes don't trigger module
 * checks; see test_precommit_merge.py.
 */
import { spawnSync } from "node:child_process";

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
		// shell is required only on Windows to spawn .cmd shims (npm);
		// argv is fully static — no user input is shelled.
		spawnSync(argv[0], argv.slice(1), { // nosemgrep
			cwd: dir,
			shell: process.platform === "win32",
			stdio: "inherit",
		}).status ?? 1
	);
}
