import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	findMissingIgnoreRule,
	findRootEvidencePaths,
	guardRepo,
	listTrackedPaths,
} from "./root-evidence-guard.mjs";

const script = fileURLToPath(
	new URL("./root-evidence-guard.mjs", import.meta.url),
);

function runGuard(root) {
	return spawnSync(process.execPath, [script], {
		encoding: "utf8",
		env: { ...process.env, ROOT_EVIDENCE_GUARD_ROOT: root },
	});
}

function git(dir, args) {
	const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
}

/** A temp git repo whose index mirrors the requested tracked paths. */
function fixtureRepo(trackedPaths, { gitignore = "/evidence/\n" } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "root-evidence-guard-"));
	const init = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
	assert.equal(init.status, 0, init.stderr);
	if (gitignore !== null) writeFileSync(join(dir, ".gitignore"), gitignore);
	for (const path of trackedPaths) {
		const full = join(dir, path);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, `fixture ${path}\n`);
	}
	// `-f` mirrors how root evidence actually gets tracked: a force-add or a
	// commit that predates the ignore rule — plain `add -A` would skip it.
	if (trackedPaths.length || gitignore !== null) git(dir, ["add", "-fA"]);
	return dir;
}

test("path matching is anchored to the repository root only", () => {
	assert.deepEqual(
		findRootEvidencePaths([
			"AGENTS.md",
			"docs/evidence/issue-1/shot.png",
			"app/coverage-evidence/x.json",
			"evidence-note.md",
			"x-evidence/shot.png",
			"devops/evidence2.ts",
			// Git paths may carry leading whitespace — this is not a root
			// `evidence/` path and must never be flagged as one.
			" evidence/shot.png",
			"evidence /shot.png",
		]),
		[],
	);
	assert.deepEqual(
		findRootEvidencePaths([
			"evidence",
			"evidence/shot.png",
			"evidence/issue-1/.hidden",
			"evidence/deep/nested/file.any",
			"docs/evidence/allowed.png",
		]),
		[
			"evidence",
			"evidence/deep/nested/file.any",
			"evidence/issue-1/.hidden",
			"evidence/shot.png",
		],
	);
});

test("clean tree passes; root evidence in any shape fails", () => {
	const clean = fixtureRepo(["AGENTS.md", "docs/evidence/keep.png"]);
	try {
		assert.deepEqual(guardRepo(clean).findings, []);
		assert.equal(runGuard(clean).status, 0);
	} finally {
		rmSync(clean, { recursive: true, force: true });
	}

	const dirty = fixtureRepo([
		"evidence/issue-9/a.png",
		"evidence/issue-9/nested/deep/b.bin",
		"evidence/.hidden",
		"docs/evidence/allowed.png",
	]);
	try {
		const findings = guardRepo(dirty).findings;
		assert.equal(findings.length, 3);
		assert.ok(findings.every((f) => f.startsWith("tracked path evidence/")));
		const result = runGuard(dirty);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /evidence\/\.hidden/);
		assert.match(result.stderr, /git rm -r evidence/);
	} finally {
		rmSync(dirty, { recursive: true, force: true });
	}
});

test("a force-added file behind the ignore rule is still tracked and fails", () => {
	const dir = fixtureRepo(["AGENTS.md"]);
	try {
		const staged = join(dir, "evidence", "sneaky.png");
		mkdirSync(join(staged, ".."), { recursive: true });
		writeFileSync(staged, "x\n");
		// Ignored by /evidence/ — plain `git add -A` must not stage it.
		git(dir, ["add", "-A"]);
		assert.deepEqual(
			listTrackedPaths(dir).filter((p) => p.startsWith("evidence/")),
			[],
		);
		// Forcing it past .gitignore is exactly the bypass the gate exists for.
		git(dir, ["add", "-f", "evidence/sneaky.png"]);
		const findings = guardRepo(dir).findings;
		assert.deepEqual(findings, ["tracked path evidence/sneaky.png"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a root file and a root symlink named evidence cannot evade the check", () => {
	const withFile = fixtureRepo(["evidence", "docs/evidence/ok.png"]);
	try {
		assert.deepEqual(guardRepo(withFile).findings, ["tracked path evidence"]);
	} finally {
		rmSync(withFile, { recursive: true, force: true });
	}

	const withLink = fixtureRepo(["target.txt"]);
	try {
		symlinkSync("target.txt", join(withLink, "evidence"));
		git(withLink, ["add", "-f", "evidence"]);
		assert.deepEqual(guardRepo(withLink).findings, [
			"tracked path evidence",
		]);
	} catch (error) {
		// Local Windows shells may lack symlink privilege; the exact-path
		// match is already covered by the file case above and in CI.
		if (error.code !== "EPERM" && error.code !== "ENOTSUP") throw error;
	} finally {
		rmSync(withLink, { recursive: true, force: true });
	}
});

test("removing the /evidence/ .gitignore anchor is a finding on its own", () => {
	const dir = fixtureRepo(["AGENTS.md"], { gitignore: "node_modules/\n" });
	try {
		assert.match(findMissingIgnoreRule(dir), /anchors `\/evidence\/`/);
		assert.deepEqual(guardRepo(dir).findings, [
			findMissingIgnoreRule(dir),
		]);
		assert.equal(runGuard(dir).status, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gitignore whitespace semantics — leading space is inert, trailing is fine", () => {
	// ` /evidence/` never matches `evidence/` in gitignore terms, so the
	// anchor check must not accept it.
	const inert = fixtureRepo(["AGENTS.md"], { gitignore: " /evidence/\n" });
	try {
		assert.match(findMissingIgnoreRule(inert), /anchors `\/evidence\/`/);
	} finally {
		rmSync(inert, { recursive: true, force: true });
	}
	// Trailing whitespace is stripped by gitignore, so `/evidence/ \t` is
	// still a live anchor and must pass.
	const live = fixtureRepo(["AGENTS.md"], { gitignore: "/evidence/ \t\n" });
	try {
		assert.equal(findMissingIgnoreRule(live), null);
	} finally {
		rmSync(live, { recursive: true, force: true });
	}
});

test("the repository itself carries no tracked root evidence path", () => {
	// The delivered tree state the #3319 gate enforces on every CI run.
	const root = fileURLToPath(new URL("../../..", import.meta.url));
	assert.deepEqual(guardRepo(root).findings, []);
	const result = spawnSync(process.execPath, [script], {
		encoding: "utf8",
		env: { ...process.env, ROOT_EVIDENCE_GUARD_ROOT: root },
	});
	assert.equal(result.status, 0, result.stderr);
});
