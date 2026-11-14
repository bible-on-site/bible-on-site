import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	classify,
	isBenignDirty,
	isCheckoutRemnant,
	isRegenerableIgnored,
	parseWorktrees,
	splitStatus,
	sweepableContainer,
	trackedFiles,
} from "./worktree-cleanup.mts";

const PORCELAIN = `worktree C:/repo/main
HEAD aaa111
branch refs/heads/master

worktree C:/repo/wt/feature
HEAD bbb222
branch refs/heads/feat/x

worktree C:/repo/wt/det
HEAD ccc333
detached

`;

describe("parseWorktrees", () => {
	it("parses path, branch and detached entries", () => {
		const wts = parseWorktrees(PORCELAIN);
		assert.equal(wts.length, 3);
		assert.equal(wts[0].path, "C:/repo/main");
		assert.equal(wts[0].branch, "master");
		assert.equal(wts[1].branch, "feat/x");
		assert.equal(wts[2].branch, null);
		assert.equal(wts[2].head, "ccc333");
	});
});

const benignRe = /^ M app[/\\]\.nuke[/\\]build\.schema\.json$/;
const base = {
	isMain: false,
	isProtected: false,
	openPr: false,
	remoteDone: true,
	mergedIntoDefault: false,
	idleBeyondThreshold: false,
	statusLines: [] as string[],
	benignDirtyRe: benignRe,
};
const wt = (branch: string | null) => ({ path: "/x", branch, head: "h" });

describe("classify", () => {
	it("keeps main and protected worktrees", () => {
		assert.equal(classify({ ...base, wt: wt("master"), isMain: true }), "protected");
		assert.equal(classify({ ...base, wt: wt("b"), isProtected: true }), "protected");
	});
	it("keeps branches with open PRs", () => {
		assert.equal(classify({ ...base, wt: wt("feat/x"), openPr: true }), "open-pr");
	});
	it("removes clean worktrees whose remote work is done", () => {
		assert.equal(classify({ ...base, wt: wt("gone") }), "remove");
	});
	it("removes worktrees merged into default or past idle threshold", () => {
		assert.equal(
			classify({ ...base, wt: wt("b"), remoteDone: false, mergedIntoDefault: true }),
			"remove",
		);
		assert.equal(
			classify({ ...base, wt: wt("b"), remoteDone: false, idleBeyondThreshold: true }),
			"remove",
		);
	});
	it("keeps fresh clean worktrees on live un-PR'd branches", () => {
		assert.equal(
			classify({ ...base, wt: wt("new-work"), remoteDone: false }),
			"stale-fresh",
		);
	});
	it("removes benign-dirty worktrees", () => {
		assert.equal(
			classify({
				...base,
				wt: wt("gone"),
				statusLines: [" D docs/a.md", " M app/.nuke/build.schema.json"],
			}),
			"remove",
		);
	});
	it("keeps real-dirty worktrees", () => {
		assert.equal(
			classify({ ...base, wt: wt("b"), statusLines: [" M src/x.ts"] }),
			"real-dirty",
		);
	});
	it("keeps detached worktrees that are not reachable from default", () => {
		assert.equal(classify({ ...base, wt: wt(null) }), "detached-unmerged");
	});
	it("removes merged detached worktrees", () => {
		assert.equal(
			classify({ ...base, wt: wt(null), mergedIntoDefault: true }),
			"remove",
		);
	});
});

describe("isBenignDirty", () => {
	it("accepts only deletions and generated churn", () => {
		assert.ok(isBenignDirty([" D a.md", " D b.md"], benignRe));
		assert.ok(isBenignDirty([" M app/.nuke/build.schema.json"], benignRe));
		assert.ok(!isBenignDirty(["?? new-file"], benignRe));
		assert.ok(!isBenignDirty([" M src/x.ts"], benignRe));
		assert.ok(!isBenignDirty([], benignRe));
	});
});

describe("sweepableContainer", () => {
	it("rejects containers that are worktrees themselves", () => {
		assert.equal(sweepableContainer("/repo", new Set(["/repo"]), true), false);
	});
	it("accepts buckets holding 2+ worktrees or named like one", () => {
		const reg = new Set(["/w/a", "/w/b"]);
		assert.equal(sweepableContainer("/w", reg, false), true);
		assert.equal(sweepableContainer("/x/bos-wt", new Set(["/x/bos-wt/a"]), false), true);
		assert.equal(sweepableContainer("/tmp", new Set(["/tmp/one-wt"]), false), false);
	});
});

describe("splitStatus", () => {
	it("separates changes from ignored entries", () => {
		const { changes, ignored } = splitStatus(
			" M src/x.ts\n D docs/a.md\n?? new\n!! node_modules/\n!! .env\n",
		);
		assert.deepEqual(changes, [" M src/x.ts", " D docs/a.md", "?? new"]);
		assert.deepEqual(ignored, ["node_modules/", ".env"]);
	});
});

describe("isRegenerableIgnored", () => {
	it("accepts build output, caches and generated files", () => {
		for (const p of [
			"node_modules/",
			"app/node_modules/",
			"website/.next/",
			"api/target/",
			"devops/.venv/",
			"a/b/__pycache__/",
			"tsconfig.tsbuildinfo",
			"debug.log",
		])
			assert.ok(isRegenerableIgnored(p), p);
	});
	it("rejects secrets, dumps and user files", () => {
		for (const p of [".env", "website/.env.local", "data/mysql/dump.sql", "notes.md", ".idea/"])
			assert.ok(!isRegenerableIgnored(p), p);
	});
});

describe("isCheckoutRemnant", () => {
	it("requires a hash-verified tracked file and zero foreign files", () => {
		const repo = mkdtempSync(join(tmpdir(), "wt-repo-"));
		const root = mkdtempSync(join(tmpdir(), "wt-debris-"));
		const git = (args: string[]) =>
			execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
		try {
			git(["init", "-q"]);
			mkdirSync(join(repo, "data"), { recursive: true });
			writeFileSync(join(repo, "data", "a.sql"), "tracked-content");
			writeFileSync(join(repo, ".gitignore"), "*.log\n");
			git(["add", "."]);
			git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"]);
			const tracked = trackedFiles(repo, "HEAD");
			assert.ok(tracked !== null && tracked.size === 2);

			// A remnant holding an identical tracked file is debris.
			mkdirSync(join(root, "data"), { recursive: true });
			writeFileSync(join(root, "data", "a.sql"), "tracked-content");
			assert.equal(isCheckoutRemnant(repo, root, tracked), true);

			// Verified content plus an unrelated file is not debris — the
			// unexplained file would be lost.
			mkdirSync(join(root, "notes"), { recursive: true });
			writeFileSync(join(root, "notes", "mine.md"), "x");
			assert.equal(isCheckoutRemnant(repo, root, tracked), false);
			rmSync(join(root, "notes"), { recursive: true });

			// Same path, different content (a name collision) is not evidence.
			writeFileSync(join(root, "data", "a.sql"), "user-edited");
			assert.equal(isCheckoutRemnant(repo, root, tracked), false);

			// A .git anywhere inside means foreign repo / live worktree.
			mkdirSync(join(root, "sub", ".git"), { recursive: true });
			assert.equal(isCheckoutRemnant(repo, root, tracked), false);
		} finally {
			rmSync(repo, { recursive: true, force: true });
			rmSync(root, { recursive: true, force: true });
		}
	});
});
