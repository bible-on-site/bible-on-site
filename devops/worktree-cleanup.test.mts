import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classify,
	isBenignDirty,
	parseWorktrees,
	sweepableContainer,
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
	openPrBranches: new Set<string>(),
	remoteBranchGone: true,
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
		assert.equal(
			classify({ ...base, wt: wt("feat/x"), openPrBranches: new Set(["feat/x"]) }),
			"open-pr",
		);
	});
	it("removes clean worktrees whose remote branch is gone", () => {
		assert.equal(classify({ ...base, wt: wt("gone") }), "remove");
	});
	it("removes worktrees merged into default or past idle threshold", () => {
		assert.equal(
			classify({ ...base, wt: wt("b"), remoteBranchGone: false, mergedIntoDefault: true }),
			"remove",
		);
		assert.equal(
			classify({ ...base, wt: wt("b"), remoteBranchGone: false, idleBeyondThreshold: true }),
			"remove",
		);
	});
	it("keeps fresh clean worktrees on live un-PR'd branches", () => {
		assert.equal(
			classify({ ...base, wt: wt("new-work"), remoteBranchGone: false }),
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
