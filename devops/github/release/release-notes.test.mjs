import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MODULES } from "../ci/determine-changes.ts";

import {
	MAX_COMMITS,
	associatedPull,
	categorize,
	collectEntries,
	generateNotes,
	moduleTags,
	previousTag,
	rangeCommits,
	renderNotes,
	renderTestFlightNotes,
} from "./release-notes.mjs";

const repo = "test/repo";
const sha = (char) => char.repeat(40);
const commit = (char, subject = "change") => ({ sha: sha(char), subject });
const pr = (number, title, labels = [], login = "devin") => ({
	number,
	title,
	merged_at: "2026-01-01T00:00:00Z",
	user: { login },
	labels: labels.map((name) => ({ name })),
});

test("moduleTags lists newest-first module tags only", () => {
	const calls = [];
	const git = (args) => {
		calls.push(args);
		return "app-v1.2.4\napp-v1.2.3\n";
	};
	assert.deepEqual(moduleTags("app-v", git), ["app-v1.2.4", "app-v1.2.3"]);
	assert.deepEqual(calls[0], [
		"tag",
		"-l",
		"app-v*",
		"--sort=-v:refname",
	]);
	assert.deepEqual(moduleTags("app-v", () => ""), []);
});

test("previousTag picks the newest tag other than the current one", () => {
	const tags = ["app-v1.2.4", "app-v1.2.3", "app-v1.2.0"];
	assert.equal(previousTag(tags, "app-v1.2.4"), "app-v1.2.3");
	// Rerun before the new tag exists locally: same answer.
	assert.equal(previousTag(["app-v1.2.3"], "app-v1.2.4"), "app-v1.2.3");
	assert.equal(previousTag([], "app-v1.0.0"), null);
	// Skipped versions: the range still starts at the latest older tag.
	assert.equal(previousTag(["app-v1.0.140"], "app-v1.0.146"), "app-v1.0.140");
});

test("rangeCommits scopes the log to the module paths", () => {
	const calls = [];
	const git = (args) => {
		calls.push(args);
		return `${sha("a")}\x1ffeat: one\n${sha("b")}\x1ffix: two`;
	};
	const commits = rangeCommits(
		"website-v1.0.0",
		["web/bible-on-site", "data/recitation/recitation.sqlite"],
		git,
	);
	assert.deepEqual(calls[0], [
		"log",
		"--no-merges",
		"--format=%H%x1f%s",
		"website-v1.0.0..HEAD",
		"--",
		"web/bible-on-site",
		"data/recitation/recitation.sqlite",
	]);
	assert.deepEqual(commits, [
		{ sha: sha("a"), subject: "feat: one" },
		{ sha: sha("b"), subject: "fix: two" },
	]);
	assert.deepEqual(rangeCommits(null, ["app"], () => ""), []);
});

test("associatedPull prefers the merged pull request", () => {
	const api = () => [
		{ number: 9, merged_at: null },
		{ number: 7, merged_at: "2026-01-01T00:00:00Z" },
	];
	assert.equal(associatedPull(repo, sha("a"), api).number, 7);
	assert.equal(associatedPull(repo, sha("a"), () => []), null);
	assert.equal(
		associatedPull(repo, sha("a"), () => {
			throw new Error("rate limited");
		}),
		null,
	);
});

test("categorize uses labels first, then conventional prefixes", () => {
	assert.equal(
		categorize(pr(1, "feat: x", ["dependencies"])),
		"dependencies",
	);
	assert.equal(categorize(pr(2, "feat(app): x")), "features");
	assert.equal(categorize(pr(3, "fix(website): y")), "fixes");
	assert.equal(categorize(pr(4, "chore(deps): bump")), "maintenance");
	assert.equal(categorize(pr(5, "no prefix title")), "other");
	assert.equal(categorize({ subject: "docs: readme" }), "documentation");
});

test("collectEntries dedupes pull requests and caps the commit scan", () => {
	const api = (endpoint) => {
		const shaArg = endpoint.match(/commits\/(\w+)\/pulls/)[1];
		return shaArg === sha("a") || shaArg === sha("b")
			? [pr(1, "feat: shared pr")]
			: [];
	};
	const commits = [commit("a"), commit("b"), commit("c", "fix: direct")];
	const { entries } = collectEntries({ repo, commits, api });
	assert.equal(entries.length, 2);
	assert.equal(entries[0].kind, "pr");
	assert.deepEqual(entries[1], {
		kind: "commit",
		section: "fixes",
		sha: sha("c"),
		subject: "fix: direct",
	});

	const overflow = collectEntries({
		repo,
		commits: Array.from({ length: MAX_COMMITS + 5 }, (_, i) =>
			commit(String(i % 16), "x"),
		),
		api: () => [],
	});
	assert.equal(overflow.overflow, 5);
	assert.equal(overflow.entries.length, MAX_COMMITS);
});

test("renderNotes groups sections, links pulls and commits", () => {
	const notes = renderNotes({
		repo,
		tag: "app-v1.2.4",
		prevTag: "app-v1.2.3",
		entries: [
			{
				kind: "pr",
				section: "features",
				number: 10,
				title: "feat(app): reader menu",
				author: "devin",
			},
			{
				kind: "commit",
				section: "fixes",
				sha: sha("c"),
				subject: "fix: crash on rotate",
			},
		],
	});
	assert.ok(notes.indexOf("### New Features") < notes.indexOf("### Bug Fixes"));
	assert.ok(
		notes.includes(
			"* feat(app): reader menu by @devin in https://github.com/test/repo/pull/10",
		),
	);
	assert.ok(
		notes.includes(
			`* fix: crash on rotate in https://github.com/test/repo/commit/${sha("c")}`,
		),
	);
	assert.ok(
		notes.endsWith(
			"**Full Changelog**: https://github.com/test/repo/compare/app-v1.2.3...app-v1.2.4",
		),
	);
});

test("renderNotes handles first and empty releases", () => {
	const first = renderNotes({ repo, tag: "api-v1.0.0", prevTag: null, entries: [] });
	assert.ok(first.includes("* No changes scoped to this module."));
	assert.ok(first.includes("/commits/api-v1.0.0"));
	assert.ok(!first.includes("/compare/"));
	const empty = renderNotes({
		repo,
		tag: "app-v2.0.0",
		prevTag: "app-v1.9.0",
		entries: [],
		overflow: 12,
	});
	assert.ok(empty.includes("* ...and 12 earlier commits"));
	assert.ok(empty.includes("since app-v1.9.0"));
});

test("generateNotes wires tags, commits and pulls together", () => {
	const git = (args) => {
		if (args[0] === "tag") return "app-v1.2.4\napp-v1.2.3";
		return `${sha("a")}\x1ffeat(app): menu`;
	};
	const api = () => [pr(10, "feat(app): menu")];
	const notes = generateNotes({
		repo,
		moduleName: "app",
		tag: "app-v1.2.4",
		directory: "app",
		git,
		api,
	});
	assert.ok(notes.includes("### New Features"));
	assert.ok(notes.includes("/pull/10"));
});

const releasedBody = [
	"Automated release for App version 5.0.147.",
	"",
	"## Downloads",
	"- **iOS (IPA)**",
	"",
	"## What's Changed",
	"",
	"### Bug Fixes",
	"",
	"* fix(app): safe-area menu by @devin in https://github.com/test/repo/pull/2095",
	"* fix: direct commit in https://github.com/test/repo/commit/" + sha("d"),
	"",
	"### Other Changes",
	"",
	"* tweak in https://github.com/test/repo/commit/" + sha("e"),
	"",
	"**Full Changelog**: https://github.com/test/repo/compare/app-v5.0.146...app-v5.0.147",
	"",
	"<!-- release-delivery:{\"ref\":\"x\"} -->",
].join("\n");

test("renderTestFlightNotes flattens the release body to plain text", () => {
	const notes = renderTestFlightNotes(releasedBody, "app-v5.0.147");
	assert.ok(notes.includes("Bug Fixes:"));
	assert.ok(notes.includes("• fix(app): safe-area menu"));
	assert.ok(notes.includes("• fix: direct commit"));
	assert.ok(!notes.includes("https://"));
	assert.ok(!notes.includes("release-delivery"));
	assert.ok(!notes.includes("Downloads"));
});

test("renderTestFlightNotes falls back and truncates", () => {
	assert.equal(
		renderTestFlightNotes("Automated release for App version 5.0.1.", "app-v5.0.1"),
		"Automated build v5.0.1",
	);
	const huge = "## What's Changed\n\n" + "* " + "x".repeat(100) + "\n".padEnd(0) +
		Array.from({ length: 200 }, () => `* ${"y".repeat(100)} in https://x`).join("\n");
	const truncated = renderTestFlightNotes(huge, "app-v1.0.0", 4000);
	assert.ok(truncated.length <= 4000);
	assert.ok(truncated.endsWith("…"));
});

test("each shared release passes its own external module paths to the changelog", () => {
	const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
	const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
	const jobs = ci.split(/(?=^  [A-Za-z0-9_]+:\s*$)/m);
	const releaseModules = [];
	for (const job of jobs.filter((block) => /uses: \.\/\.github\/workflows\/shared-release\.yml/.test(block))) {
		const module = job.match(/^      module_name:\s*(\w+)\s*$/m)?.[1];
		assert.ok(module && Object.hasOwn(MODULES, module), "shared release must identify a known module");
		releaseModules.push(module);
		const extras = job.match(/^      extra_module_paths:\s*'(\[[^\]]*\])'\s*$/m)?.[1];
		assert.deepEqual(
			(extras ? JSON.parse(extras) : []).sort(),
			[...(MODULES[module].extraModulePaths ?? [])].sort(),
			`${module} release changelog must match its own determine-changes paths`,
		);
	}
	assert.ok(releaseModules.includes("website") && releaseModules.includes("app"));
	// perushim_pipeline regenerates the delivered index; it has no shared
	// release/changelog job and must not be mistaken for a release module.
	assert.ok(!releaseModules.includes("perushim_pipeline"));
});
