import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

// Replays the "Restore website dependency cache" step from shared-dockerize.yml
// against stubbed gh/unzip shell functions (#3682). The step must tolerate a
// missing baseline, a failed lookup/download/extraction and a payload without
// a BuildKit index — each leaves src empty so the deps stage builds cold.
const workflow = parse(
	readFileSync(
		new URL("../../../.github/workflows/shared-dockerize.yml", import.meta.url),
		"utf8",
	),
);
const step = workflow.jobs.package.steps.find(
	(entry) => entry.name === "Restore website dependency cache",
);
assert.ok(step, "the restore step must exist in the shared package job");
const script = step.run
	.replace(/\$\{\{ github\.repository \}\}/g, "test/repo")
	.replace(/\$\{\{ github\.repository_id \}\}/g, "123456");
assert.ok(!script.includes("${{"), "replay needs every expression bound");
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function restore({
	listId = "null",
	listFails = false,
	zipFails = false,
	unzip = "index",
} = {}) {
	const dir = mkdtempSync(join(tmpdir(), "deps-cache-"));
	const gh = `gh() {
		if [ "$1" = "api" ] && [ "$\{2##*/}" = "zip" ]; then
			${zipFails ? "return 1" : "printf zip-bytes"}
		else
			${listFails ? "return 1" : `printf '%s\\n' '${listId}'`}
		fi
	}`;
	const unzipBody = {
		index: 'mkdir -p "$dest" && printf "{}" > "$dest/index.json"',
		empty: 'mkdir -p "$dest"',
		fail: "return 1",
	}[unzip];
	const unzipFn = `unzip() {
		dest=""; prev=""; for arg in "$@"; do if [ "$prev" = "-d" ]; then dest="$arg"; fi; prev="$arg"; done
		${unzipBody}
	}`;
	const output = join(dir, "github-output");
	const runnerTemp = join(dir, "runner-temp");
	mkdirSync(runnerTemp);
	const result = spawnSync(
		shell,
		["--noprofile", "--norc", "-e", "-c", `${gh}\n${unzipFn}\n${script}`],
		{
			encoding: "utf8",
			env: {
				...process.env,
				RUNNER_TEMP: runnerTemp,
				IMAGE_ARCH: "amd64",
				GITHUB_OUTPUT: output,
				GH_TOKEN: "stub",
			},
		},
	);
	assert.equal(result.status, 0, result.stderr);
	return {
		src: /^src=(.*)$/m.exec(readFileSync(output, "utf8"))?.[1] ?? null,
		stdout: result.stdout,
	};
}

test("a missing baseline artifact builds cold", () => {
	const { src, stdout } = restore({ listId: "null" });
	assert.equal(src, "");
	assert.match(stdout, /No usable website-deps-cache\.master\.amd64 artifact/);
});

test("a failed baseline lookup builds cold", () => {
	const { src } = restore({ listFails: true });
	assert.equal(src, "");
});

test("a failed artifact download builds cold", () => {
	const { src } = restore({ listId: "42", zipFails: true });
	assert.equal(src, "");
});

test("a payload without a BuildKit cache index warns and builds cold", () => {
	const { src, stdout } = restore({ listId: "42", unzip: "empty" });
	assert.equal(src, "");
	assert.match(stdout, /held no BuildKit cache index/);
});

test("a failed extraction builds cold", () => {
	const { src } = restore({ listId: "42", unzip: "fail" });
	assert.equal(src, "");
});

test("a valid baseline artifact resolves its BuildKit cache directory", () => {
	const { src, stdout } = restore({ listId: "42" });
	assert.ok(src.endsWith("website-deps-cache"), src);
	assert.match(stdout, /Restored dependency cache/);
});

// Artifact names are attacker-controlled (a fork run may upload a same-named
// payload), so selection must verify the producing run's provenance: a run on
// this repository's master branch — never by name alone.
test("only artifacts from this repository's master runs are eligible", () => {
	assert.match(script, /head_branch == "master"/);
	assert.match(script, /workflow_run\.repository_id == 123456/);
	assert.match(script, /workflow_run\.head_repository_id == 123456/);
});
