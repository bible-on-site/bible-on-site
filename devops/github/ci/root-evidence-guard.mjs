#!/usr/bin/env node
/**
 * Repository-root evidence gate —
 * https://github.com/bible-on-site/bible-on-site/issues/3319
 *
 * Session and pull-request validation evidence (screenshots, captures,
 * recordings) does not belong in the tracked repository. It is published
 * through pull-request descriptions/comments, issue attachments, CI
 * artifacts and immutable commit permalinks. The repository-root
 * `evidence/` directory was removed once already (#2917, cleanup #3055)
 * and kept regrowing because deletion alone cannot stop the next
 * `git add -f` past the `.gitignore` rule.
 *
 * This gate inspects the git index of the checked-out tree — not the
 * filesystem — so it catches every tracked path named `evidence` at the
 * repository root regardless of extension, depth, hidden filename or
 * ignore-rule bypass, while staged-but-uncommitted additions are caught
 * locally before they ever reach a branch.
 *
 * Scope is the root entry only: module-scoped locations such as
 * `docs/evidence/` and per-suite coverage/e2e evidence remain allowed
 * (#3319 scope boundary).
 *
 * A second check keeps the supporting `.gitignore` `/evidence/` anchor in
 * place — the path rule stays as cheap first-line protection even though
 * the index scan is the real gate.
 *
 * Run: `node devops/github/ci/root-evidence-guard.mjs` — audit mode,
 * wired as the unconditional `root_evidence_guard` CI job (pull_request,
 * push to master, merge_group). Exit code 1 on any finding.
 * ROOT_EVIDENCE_GUARD_ROOT overrides the repo root — unit tests point it
 * at fixture repositories in a temp dir.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ISSUE_URL =
	"https://github.com/bible-on-site/bible-on-site/issues/3319";
export const FORBIDDEN_ROOT = "evidence";

function runGit(root, args) {
	const result = spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error)
		throw new Error(`could not run git ${args[0]} under ${root}: ${result.error.message}`);
	if (result.status !== 0)
		throw new Error(
			`git ${args[0]} under ${root} exited ${result.status}: ${result.stderr.trim()}`,
		);
	return result.stdout;
}

/** Resolve the worktree top-level that contains `root` (defaults to cwd). */
export function repoTopLevel(root) {
	return runGit(root, ["rev-parse", "--show-toplevel"]).trim();
}

/** Every path in the git index — tracked, staged or force-added. */
export function listTrackedPaths(root) {
	return runGit(root, ["ls-files", "-z"])
		.split("\0")
		.map((p) => p.trim())
		.filter(Boolean);
}

/**
 * Index paths that violate the root evidence ban: exactly `evidence`
 * (file, symlink or gitlink) or anything under `evidence/`. Nested
 * `evidence/` directories elsewhere in the tree are out of scope.
 */
export function findRootEvidencePaths(trackedPaths) {
	return trackedPaths
		.filter((p) => p === FORBIDDEN_ROOT || p.startsWith(`${FORBIDDEN_ROOT}/`))
		.sort();
}

/** The root `.gitignore` must keep anchoring `/evidence/` — cheap first-line protection. */
export function findMissingIgnoreRule(root) {
	const file = join(root, ".gitignore");
	if (!existsSync(file)) return "root .gitignore is missing entirely";
	const anchored = readFileSync(file, "utf8")
		.split("\n")
		.some((line) => line.trim() === `/${FORBIDDEN_ROOT}/`);
	return anchored
		? null
		: "root .gitignore no longer anchors `/evidence/` — restore the ignore entry as first-line protection";
}

/** Run the gate against the repository worktree containing `root`. */
export function guardRepo(root) {
	const topLevel = repoTopLevel(root);
	const findings = [];
	for (const path of findRootEvidencePaths(listTrackedPaths(topLevel)))
		findings.push(`tracked path ${path}`);
	const missingIgnore = findMissingIgnoreRule(topLevel);
	if (missingIgnore) findings.push(missingIgnore);
	return { topLevel, findings };
}

export function printFindings(findings) {
	for (const finding of findings)
		console.error(`[root-evidence-guard] FAIL: ${finding}`);
	console.error(
		`[root-evidence-guard] Remove tracked root evidence from the index — ` +
			"`git rm -r evidence` (add `-r --cached` to keep local copies) — and publish " +
			"validation evidence through PR descriptions/comments, issue attachments, " +
			"CI artifacts or commit permalinks. Module-scoped paths such as " +
			`docs/evidence/ remain allowed (${ISSUE_URL}).`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const root =
		process.env.ROOT_EVIDENCE_GUARD_ROOT ?? resolve(scriptDir, "..", "..", "..");
	try {
		const { findings } = guardRepo(root);
		if (findings.length) {
			printFindings(findings);
			process.exitCode = 1;
		} else {
			console.log(
				"[root-evidence-guard] OK — no tracked repository-root evidence path; " +
					"the /evidence/ .gitignore anchor is intact",
			);
		}
	} catch (error) {
		console.error(`[root-evidence-guard] FAIL: ${error.message}`);
		process.exitCode = 1;
	}
}
