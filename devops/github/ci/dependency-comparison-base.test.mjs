import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workflow = readFileSync(
	new URL(
		"../../../.github/workflows/dependency-submission.yml",
		import.meta.url,
	),
	"utf8",
).replace(/\r\n/g, "\n");
const step = workflow
	.split("      - name: 'Resolve dependency comparison base'\n")[1]
	?.split("      - name: ")[0];
assert.ok(step);
const script = step
	.split("        run: |\n")[1]
	.split("\n")
	.map((line) => {
		assert.ok(!line.trim() || line.startsWith("          "));
		return line.slice(10);
	})
	.join("\n");
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function fixture(run) {
	const directory = mkdtempSync(join(tmpdir(), "dependency-base-"));
	const git = (cwd, ...args) => {
		const result = spawnSync("git", args, { cwd, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	try {
		git(directory, "init", "--initial-branch=master", "source");
		const source = join(directory, "source"),
			remote = join(directory, "remote.git"),
			checkout = join(directory, "checkout");
		git(source, "config", "user.email", "fixture@example.invalid");
		git(source, "config", "user.name", "Dependency fixture");
		writeFileSync(join(source, "common.txt"), "ancestor");
		git(source, "add", ".");
		git(source, "commit", "-m", "ancestor");
		const ancestor = git(source, "rev-parse", "HEAD");
		git(source, "switch", "-c", "pr-source");
		writeFileSync(join(source, "head.txt"), "PR only");
		git(source, "add", ".");
		git(source, "commit", "-m", "head");
		const head = git(source, "rev-parse", "HEAD");
		git(source, "update-ref", "refs/pull/7/head", head);
		git(source, "switch", "master");
		writeFileSync(join(source, "master.txt"), "later base");
		git(source, "add", ".");
		git(source, "commit", "-m", "base tip");
		const base = git(source, "rev-parse", "HEAD");
		git(source, "branch", "-D", "pr-source");
		git(directory, "clone", "--bare", source, remote);
		git(
			directory,
			"clone",
			"--single-branch",
			"--branch",
			"master",
			pathToFileURL(remote).href,
			checkout,
		);
		const output = join(directory, "github-env");
		run({ git, checkout, ancestor, head, base, output });
	} finally {
		assert.ok(directory.startsWith(join(tmpdir(), "dependency-base-")));
		rmSync(directory, { recursive: true, force: true });
	}
}

function resolve(f) {
	return spawnSync(shell, ["-e", "-o", "pipefail", "-c", script], {
		cwd: f.checkout,
		encoding: "utf8",
		env: {
			...process.env,
			SNAPSHOT_SHA: f.base,
			PR_HEAD_SHA: f.head,
			GITHUB_ENV: f.output.replace(/\\/g, "/"),
		},
	});
}

test("the real comparison step fetches the immutable head after branch deletion", () =>
	fixture((f) => {
		assert.notEqual(
			spawnSync("git", ["merge-base", f.base, f.head], { cwd: f.checkout })
				.status,
			0,
			"Reproduce the missing PR commit",
		);
		const result = resolve(f);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.ancestor);
		assert.equal(
			readFileSync(f.output, "utf8").trim(),
			`SNAPSHOT_SHA=${f.ancestor}`,
		);
	}));

test("an unavailable immutable head fails without publishing a substitute base", () =>
	fixture((f) => {
		const result = resolve({ ...f, head: "9".repeat(40) });
		assert.notEqual(result.status, 0);
		assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.base);
		assert.equal(existsSync(f.output), false);
	}));
