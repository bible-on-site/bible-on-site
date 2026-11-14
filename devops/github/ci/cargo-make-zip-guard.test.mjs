import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import {
	ALLOWLIST_REL,
	analyzeMakefile,
	checkArchiveTasks,
	checkCargoGraphs,
	checkRenovate,
	checkWorkflowPins,
	findArchiveInvocations,
	guardRepo,
} from "./cargo-make-zip-guard.mjs";

// ---------------------------------------------------------------------------
// Fixture helpers — every test builds the repo slice it needs under a temp
// root; nothing here touches the real repository.
// ---------------------------------------------------------------------------

const roots = [];
function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), "cargo-make-zip-guard-"));
	roots.push(root);
	for (const [path, content] of Object.entries(files)) {
		const abs = join(root, path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	}
	return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const WORKFLOW = (version) => ({
	".github/workflows/ci.yml": `      - uses: taiki-e/install-action@v2\n        with:\n          tool: cargo-make@${version}\n`,
});
const RENOVATE_OK = {
	"renovate.json": JSON.stringify({
		customManagers: [{ matchStrings: ["cargo-make@(?<currentValue>[0-9.]+)"] }],
		packageRules: [{ matchPackageNames: ["cargo-make"], automerge: false }],
	}),
};
const CLEAN_MAKEFILE = {
	"web/api/Makefile.toml": '[tasks.lint]\ncommand = "cargo"\nargs = ["clippy"]\n',
};
const base = (extra = {}) => ({ ...WORKFLOW("0.37.24"), ...RENOVATE_OK, ...CLEAN_MAKEFILE, ...extra });

const checks = (findings, name) => findings.filter((f) => f.check === name);

// ---------------------------------------------------------------------------
// findArchiveInvocations — duckscript command-position detection.
// ---------------------------------------------------------------------------

describe("findArchiveInvocations", () => {
	it("flags bare and namespaced archive commands in command position", () => {
		for (const script of [
			"unzip a b",
			"x = unzip a b",
			"if unzip a b",
			"fs::zip::Unzip a b",
			"std::fs::zip::Zip a b",
			"zip out.zip dir",
			"ok = unzip src dst\n",
		])
			assert.equal(findArchiveInvocations(script).length, 1, script);
	});

	it("detects names rebound through alias", () => {
		const hits = findArchiveInvocations("alias extract unzip\nextract a b");
		assert.equal(hits.length, 1);
		assert.equal(hits[0].command, "extract");
		assert.equal(hits[0].line, 2);
	});

	it("checks every command-position token on a line, not just the first", () => {
		const hits = findArchiveInvocations("echo ok; unzip input.zip output");
		assert.equal(hits.length, 1);
		assert.equal(hits[0].command, "unzip");
		assert.equal(findArchiveInvocations("x = set a; y = zip out.zip d").length, 1);
	});

	it("tracks namespaced alias commands and unalias removals", () => {
		assert.equal(
			findArchiveInvocations("lib::alias::Set extract unzip\nextract a b").length,
			1,
		);
		assert.equal(
			findArchiveInvocations("alias extract unzip\nunalias extract\nextract a b").length,
			0,
		);
	});

	it("ignores comments, string contents, arguments and assignment targets", () => {
		for (const script of [
			"# unzip a b",
			'echo "unzip a b"',
			"my_unzip a b",
			"unzipper a b",
			"zipfile = read a",
			"cp a zip",
			"echo unzip",
			"target = ./zip_dir",
		])
			assert.equal(findArchiveInvocations(script).length, 0, script);
	});
});

// ---------------------------------------------------------------------------
// analyzeMakefile — which scripts execute as duckscript.
// ---------------------------------------------------------------------------

describe("analyzeMakefile", () => {
	it("collects inline, condition, env and file duckscript sources", () => {
		const { sources, fileScripts, tasks } = analyzeMakefile(`
[env]
DL = { script = "unzip a b" }
[tasks.a]
script = '''
echo hi
'''
[tasks.b]
script_runner = "@shell"
script = '''
unzip a b
'''
[tasks.c]
condition = { script = "zip a b" }
[tasks.d]
condition.script = "unzip x y"
[tasks.e.env]
OUT = { script = "unzip e f" }
[tasks.f.script]
file = "extract.ds"
[tasks.g]
script.file = "other.ds"
script.runner = "duckscript"
`);
		const byTask = Object.fromEntries(sources.map((s) => [s.task, s.script]));
		assert.equal(byTask["(env)"], "unzip a b");
		assert.match(byTask.a, /echo hi/);
		assert.equal(byTask.b, undefined, "@shell runner is not duckscript");
		assert.equal(byTask.c, "zip a b");
		assert.equal(byTask.d, "unzip x y");
		assert.equal(byTask.e, "unzip e f");
		assert.deepEqual(
			fileScripts.map((f) => [f.task, f.file]),
			[
				["f", "extract.ds"],
				["g", "other.ds"],
			],
		);
		assert.ok(tasks.includes("g"));
	});

	it("treats script arrays as duckscript bodies", () => {
		const { sources } = analyzeMakefile('[tasks.a]\nscript = ["unzip a b", "echo x"]\n');
		assert.equal(sources.length, 1);
		assert.equal(sources[0].script, "unzip a b\necho x");
	});

	it("applies the task script_runner to file scripts", () => {
		const { fileScripts } = analyzeMakefile(
			'[tasks.a]\nscript_runner = "@shell"\nscript = { file = "x.ds" }\n',
		);
		assert.equal(fileScripts[0].runner, "@shell");
	});

	it("resolves root-level extend but not task-level extend", () => {
		const { extends: ext } = analyzeMakefile(`
extend = [{ path = "shared.toml", optional = true }, "base.toml"]
[tasks.a]
extend = "tasks.b"
`);
		assert.deepEqual(
			ext.map((e) => e.path).sort(),
			["base.toml", "shared.toml"],
		);
	});
});

// ---------------------------------------------------------------------------
// Check functions against fixture repos.
// ---------------------------------------------------------------------------

describe("checkWorkflowPins", () => {
	it("passes when all pins agree on one version", () => {
		const root = fixture(WORKFLOW("0.37.24"));
		assert.equal(checkWorkflowPins(root).findings.length, 0);
	});
	it("ignores pins mentioned in YAML comments", () => {
		const root = fixture({
			".github/workflows/a.yml": "tool: cargo-make@0.37.24 # pinned; was cargo-make@0.37.23\n",
		});
		assert.equal(checkWorkflowPins(root).findings.length, 0);
	});
	it("fails on disagreeing pins and on missing pins", () => {
		const mixed = fixture({
			".github/workflows/a.yml": "tool: cargo-make@0.37.24\n",
			".github/workflows/b.yml": "run: cargo install --locked cargo-make@0.38.0\n",
		});
		assert.equal(checkWorkflowPins(mixed).findings.length, 1);
		assert.match(checkWorkflowPins(mixed).findings[0].message, /0\.38\.0/);
		assert.equal(checkWorkflowPins(fixture({})).findings.length, 1);
	});
});

describe("checkRenovate", () => {
	it("requires the custom manager and the manual-review rule", () => {
		assert.equal(checkRenovate(fixture(RENOVATE_OK)).length, 0);
		const noManager = fixture({
			"renovate.json": JSON.stringify({
				customManagers: [],
				packageRules: [{ matchPackageNames: ["cargo-make"], automerge: false }],
			}),
		});
		assert.equal(checkRenovate(noManager).length, 1);
		const automerging = fixture({
			"renovate.json": JSON.stringify({
				customManagers: [{ matchStrings: ["cargo-make@(?<v>[0-9.]+)"] }],
				packageRules: [{ matchPackageNames: ["cargo-make"], automerge: true }],
			}),
		});
		assert.equal(checkRenovate(automerging).length, 1);
	});
});

describe("checkCargoGraphs", () => {
	it("fails when a Cargo.toml re-declares cargo-make", () => {
		const root = fixture({ "web/api/Cargo.toml": '[dev-dependencies]\ncargo-make = "0.37"\n' });
		assert.equal(checkCargoGraphs(root).length, 1);
		assert.equal(checkCargoGraphs(fixture({ "web/api/Cargo.toml": "[package]\nname = \"x\"\n" })).length, 0);
	});
});

describe("checkArchiveTasks", () => {
	it("flags unassessed archive commands in duckscript tasks", () => {
		const root = fixture({
			"data/Makefile.toml": '[tasks.fetch]\nscript = """\nwget x\nunzip a b\n"""\n',
		});
		const { findings } = checkArchiveTasks(root, { assessed: [] });
		assert.equal(findings.length, 1);
		assert.match(findings[0].message, /fetch.*unzip/);
	});
	it("passes assessed tasks and rejects stale or reason-less entries", () => {
		const makefile = '[tasks.fetch]\nscript = "unzip a b"\n';
		const allowlist = {
			assessed: [{ makefile: "data/Makefile.toml", task: "fetch", reason: "trusted feed archives only" }],
		};
		const root = fixture({
			"data/Makefile.toml": makefile,
			[ALLOWLIST_REL]: JSON.stringify(allowlist),
		});
		assert.equal(checkArchiveTasks(root, allowlist).findings.length, 0);
		const stale = fixture({
			"data/Makefile.toml": '[tasks.lint]\ncommand = "cargo"\n',
			[ALLOWLIST_REL]: JSON.stringify({
				assessed: [{ makefile: "data/Makefile.toml", task: "lint", reason: "x" }],
			}),
		});
		assert.equal(checkArchiveTasks(stale, { assessed: [{ makefile: "data/Makefile.toml", task: "lint", reason: "x" }] }).findings.length, 1);
		const noReason = fixture({
			"data/Makefile.toml": makefile,
			[ALLOWLIST_REL]: JSON.stringify({
				assessed: [{ makefile: "data/Makefile.toml", task: "fetch", reason: " " }],
			}),
		});
		const res = checkArchiveTasks(noReason, {
			assessed: [{ makefile: "data/Makefile.toml", task: "fetch", reason: " " }],
		});
		assert.equal(res.findings.length, 1);
		assert.match(res.findings[0].message, /non-empty reason/);
	});
	it("audits .ds file scripts and extended makefiles", () => {
		const root = fixture({
			"data/Makefile.toml": 'extend = "shared.toml"\n[tasks.e]\nscript = { file = "x.ds" }\n',
			"data/shared.toml": '[tasks.s]\nscript = "unzip a b"\n',
			"data/x.ds": "unzip a b\n",
		});
		const { findings, scanned } = checkArchiveTasks(root, { assessed: [] });
		assert.equal(scanned.length, 2);
		assert.equal(findings.length, 2);
	});
	it("skips external runners and non-.ds script files", () => {
		const root = fixture({
			"data/Makefile.toml":
				'[tasks.a]\nscript_runner = "@shell"\nscript = "unzip a b"\n[tasks.b]\nscript = { file = "x.sh" }\n[tasks.c]\ncommand = "unzip"\nargs = ["a"]\n[tasks.d]\nscript_runner = "@shell"\nscript = { file = "y.ds" }\n',
			"data/x.sh": "unzip a b\n",
			"data/y.ds": "unzip a b\n",
		});
		assert.equal(checkArchiveTasks(root, { assessed: [] }).findings.length, 0);
	});
	it("audits a non-.ds file when the runner is explicitly duckscript", () => {
		const root = fixture({
			"data/Makefile.toml": '[tasks.a]\nscript = { file = "x.sh", runner = "duckscript" }\n',
			"data/x.sh": "unzip a b\n",
		});
		assert.equal(checkArchiveTasks(root, { assessed: [] }).findings.length, 1);
	});
	it("fails on missing non-optional extends and missing .ds files", () => {
		const root = fixture({
			"data/Makefile.toml": 'extend = "gone.toml"\n[tasks.a]\nscript = { file = "gone.ds" }\n',
		});
		assert.equal(checkArchiveTasks(root, { assessed: [] }).findings.length, 2);
		const optional = fixture({ "data/Makefile.toml": 'extend = [{ path = "gone.toml", optional = true }]\n' });
		assert.equal(checkArchiveTasks(optional, { assessed: [] }).findings.length, 0);
	});
});

describe("guardRepo", () => {
	it("passes a clean fixture repository", () => {
		assert.equal(guardRepo(fixture(base())).findings.length, 0);
	});
	it("reports every violated gate", () => {
		const root = fixture(
			base({
				".github/workflows/extra.yml": "run: cargo install cargo-make@0.38.0\n",
				"web/api/Makefile.toml": '[tasks.x]\nscript = "unzip a b"\n',
				"web/api/Cargo.toml": '[dev-dependencies]\ncargo-make = "0.37.24"\n',
			}),
		);
		const findings = guardRepo(root).findings;
		assert.ok(checks(findings, "pins").length >= 1);
		assert.ok(checks(findings, "archive-tasks").length >= 1);
		assert.ok(checks(findings, "cargo-graphs").length >= 1);
	});
});
