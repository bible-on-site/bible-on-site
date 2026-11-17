import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import stringify from "fast-json-stable-stringify";
import { parse } from "yaml";
import {
	describeChanges,
	openPullRequest,
	pushTarget,
	targetIssues,
} from "./auto-open-pr.mjs";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const push = (head = "codex/new-work", overrides = {}) => ({
	repository: { full_name: "owner/repo", default_branch: "master" },
	ref: `refs/heads/${head}`,
	after: headSha,
	...overrides,
});
function harness(options = {}) {
	const calls = [];
	let histories = 0;
	let branches = 0;
	const gh = (args, input) => {
		calls.push({ args, input });
		if (args[0] === "pr" && args[1] === "list") {
			if (options.historyError) throw options.historyError;
			return stringify(
				options.histories?.[histories++] ?? options.history ?? [],
			);
		}
		if (args[0] === "pr" && args[1] === "create") {
			if (options.createError) throw options.createError;
			return "https://github.com/owner/repo/pull/1";
		}
		if (args[1].includes("/branches/")) {
			if (options.branchError) throw options.branchError;
			return stringify({
				commit: { sha: options.branchHeads?.[branches++] ?? headSha },
			});
		}
		if (args[1].includes("/issues/"))
			return stringify(
				options.issue ?? { state: "open", labels: [{ name: "Devin Backlog" }] },
			);
		throw new Error(`Unexpected GitHub request ${JSON.stringify(args)}`);
	};
	const git = (args) => {
		calls.push({ git: args });
		if (args[0] === "fetch") return "";
		if (args[0] === "rev-parse") return baseSha;
		if (args[0] === "diff") return options.paths ?? "src/feature.mjs\n";
		if (args[0] === "log" && args.includes("--reverse"))
			return (
				options.subjects ?? "feat: complete feature\ntest: cover feature\n"
			);
		if (args[0] === "log") return "Evidence with `literal` and $(unexecuted)\n";
		throw new Error(`Unexpected Git request ${JSON.stringify(args)}`);
	};
	return { calls, dependencies: { gh, git, log() {} } };
}

describe("automatic PR eligibility", () => {
	for (const [name, event] of [
		["forced history rewrite", push("codex/new-work", { forced: true })],
		["deleted branch", push("codex/new-work", { deleted: true })],
		["default branch", push("master")],
		["temporary screenshots", push("artifacts/pr-3171-screenshots")],
		["temporary evidence", push("codex/issue-2396-accessibility-evidence")],
		["dependency bot", push("renovate/bun-minor-patch")],
	])
		it(`skips ${name} without accessing GitHub`, () => {
			const h = harness();
			assert.equal(openPullRequest(event, h.dependencies).created, false);
			assert.equal(h.calls.length, 0);
		});
	it("rejects malformed event identities", () => {
		assert.throws(() => pushTarget(push("codex/new", { after: "master" })));
		assert.throws(() => pushTarget(push("codex/new", { repository: {} })));
	});
	it("does not resurrect a delivered branch after its SHA changes, including a burst", () => {
		for (let i = 0; i < 100; i++) {
			const h = harness({ history: [{ number: 1000 + i }] });
			const result = openPullRequest(
				push(`codex/old-${i}`, { after: i.toString(16).padStart(40, "0") }),
				h.dependencies,
			);
			assert.match(result.reason, /PR history/);
			assert.equal(h.calls.length, 1);
			assert.ok(h.calls[0].args.includes("all"));
		}
	});
	it("requires a current, existing branch", () => {
		assert.match(
			openPullRequest(push(), harness({ branchHeads: [baseSha] }).dependencies)
				.reason,
			/head changed/,
		);
		const error = Object.assign(new Error("missing"), {
			stderr: "gh: HTTP 404",
		});
		assert.equal(
			openPullRequest(push(), harness({ branchError: error }).dependencies)
				.created,
			false,
		);
	});
	it("propagates access errors and invalid API responses", () => {
		const error = new Error("HTTP 403");
		assert.throws(
			() =>
				openPullRequest(push(), harness({ branchError: error }).dependencies),
			(e) => e === error,
		);
		assert.throws(
			() => openPullRequest(push(), harness({ history: {} }).dependencies),
			/history response/,
		);
		assert.throws(
			() =>
				openPullRequest(
					push(),
					harness({ branchHeads: ["invalid"] }).dependencies,
				),
			/branch response/,
		);
	});
	it("rejects a completed issue or PR before fetching source", () => {
		for (const issue of [
			{ state: "closed" },
			{ state: "open", pull_request: {} },
		]) {
			const h = harness({ issue });
			assert.match(
				openPullRequest(push("feat/2573-unify-readers"), h.dependencies).reason,
				/not an open issue/,
			);
			assert.ok(h.calls.every((c) => !c.git));
		}
	});
	it("requires a known open Devin Backlog issue for Devin branches", () => {
		assert.match(
			openPullRequest(
				push("devin/1793295877-issue-2249-ben-edition"),
				harness({ issue: { state: "open", labels: [] } }).dependencies,
			).reason,
			/outside Devin Backlog/,
		);
		assert.match(
			openPullRequest(push("devin/unscoped-work"), harness().dependencies)
				.reason,
			/does not identify/,
		);
		assert.equal(
			openPullRequest(push("devin/back-video-2117"), harness().dependencies)
				.created,
			true,
		);
	});
	it("allows human feature issues without a Devin label", () => {
		assert.equal(
			openPullRequest(
				push("feat/1234-new-feature"),
				harness({ issue: { state: "open", labels: [] } }).dependencies,
			).created,
			true,
		);
	});
	it("does not mistake a Devin timestamp for an issue identifier", () => {
		assert.deepEqual(targetIssues("devin/1793295877-issue-2249-ben-edition"), {
			devin: true,
			numbers: [2249],
		});
		assert.deepEqual(targetIssues("issue/2766-windows"), {
			devin: false,
			numbers: [2766],
		});
	});
	it("checks the target issue without treating numeric revisions as issues", () => {
		for (const branch of [
			"devin/1793295877-issue-2249-ben-edition-2",
			"devin/2249-ben-edition-2",
			"devin/back-video-2117-2",
		]) {
			const h = harness();
			assert.equal(openPullRequest(push(branch), h.dependencies).created, true);
			const queries = h.calls.filter((c) => c.args?.[1]?.includes("/issues/"));
			assert.equal(queries.length, 1);
			assert.match(queries[0].args[1], /\/(2249|2117)$/);
		}
	});
});

describe("automatic PR creation", () => {
	it("passes literal metadata as arguments/stdin and titles the feature commit", () => {
		const h = harness();
		assert.equal(
			openPullRequest(push("codex/test-$literal"), h.dependencies).created,
			true,
		);
		const create = h.calls.find((c) => c.args?.[1] === "create");
		assert.deepEqual(create.args, [
			"pr",
			"create",
			"--repo",
			"owner/repo",
			"--base",
			"master",
			"--head",
			"codex/test-$literal",
			"--title",
			"feat: complete feature",
			"--body-file",
			"-",
		]);
		assert.match(create.input, /`literal` and \$\(unexecuted\)/);
		assert.match(
			create.input,
			/- feat: complete feature\n- test: cover feature/,
		);
	});
	for (const options of [{ paths: "" }, { subjects: "" }])
		it("skips branches without new file patches", () => {
			const h = harness(options);
			assert.equal(openPullRequest(push(), h.dependencies).created, false);
			assert.ok(!h.calls.some((c) => c.args?.[1] === "create"));
		});
	it("rechecks live branch and ownership after fetching", () => {
		assert.match(
			openPullRequest(
				push(),
				harness({ branchHeads: [headSha, baseSha] }).dependencies,
			).reason,
			/superseded/,
		);
		assert.match(
			openPullRequest(
				push(),
				harness({ histories: [[], [{ number: 2 }]] }).dependencies,
			).reason,
			/superseded/,
		);
	});
	it("accepts a concurrent creation and preserves real failures", () => {
		const error = new Error("create failed");
		assert.match(
			openPullRequest(
				push(),
				harness({ createError: error, histories: [[], [], [{ number: 3 }]] })
					.dependencies,
			).reason,
			/another run/,
		);
		assert.throws(
			() =>
				openPullRequest(push(), harness({ createError: error }).dependencies),
			(e) => e === error,
		);
		assert.throws(
			() =>
				openPullRequest(push(), harness({ historyError: error }).dependencies),
			(e) => e === error,
		);
	});
});

describe("Git patch inspection", () => {
	it("recognizes equivalent patches after history rewrites and no-op work", () => {
		const prefix = join(tmpdir(), "auto-pr-git-");
		const directory = mkdtempSync(prefix);
		const git = (args) =>
			execFileSync("git", args, { cwd: directory, encoding: "utf8" });
		try {
			git(["init", "--initial-branch=master"]);
			git(["config", "user.name", "Fixture"]);
			git(["config", "user.email", "fixture@example.test"]);
			git(["config", "core.autocrlf", "false"]);
			writeFileSync(join(directory, "feature"), "before\n");
			git(["add", "."]);
			git(["commit", "-m", "base"]);
			const root = git(["rev-parse", "HEAD"]).trim();
			git(["checkout", "-b", "feature"]);
			writeFileSync(join(directory, "feature"), "after\n");
			git(["commit", "-am", "feat: actual feature"]);
			const original = git(["rev-parse", "HEAD"]).trim();
			assert.equal(
				describeChanges(root, original, git).title,
				"feat: actual feature",
			);
			git(["checkout", "master"]);
			git(["cherry-pick", "--no-commit", original]);
			git(["commit", "-m", "same patch after history rewrite"]);
			const rewritten = git(["rev-parse", "HEAD"]).trim();
			assert.equal(describeChanges(rewritten, original, git), null);
			assert.equal(describeChanges(rewritten, rewritten, git), null);
		} finally {
			assert.ok(directory.startsWith(prefix));
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe("workflow rollout", () => {
	it("retains a manual-only legacy identity without PR-writing permissions", () => {
		const legacy = parse(
			readFileSync(
				new URL(
					"../../../.github/workflows/auto-create-pr.yml",
					import.meta.url,
				),
				"utf8",
			),
		);
		assert.deepEqual(Object.keys(legacy.on), ["workflow_dispatch"]);
		assert.deepEqual(legacy.permissions, {});
		assert.ok(!Object.values(legacy.jobs).some((job) => job.permissions));
	});
	it("uses default-branch code under a new workflow identity", () => {
		const workflow = readFileSync(
			new URL("../../../.github/workflows/auto-open-pr.yml", import.meta.url),
			"utf8",
		);
		assert.match(
			workflow,
			/ref: \$\{\{ github.event.repository.default_branch \}\}/,
		);
		assert.match(workflow, /persist-credentials: false/);
		assert.match(workflow, /!github.event.deleted && !github.event.forced/);
		assert.match(workflow, /node devops\/github\/ci\/auto-open-pr.mjs/);
	});
});
