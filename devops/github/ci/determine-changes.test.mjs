import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/shared-ci.yml", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const runBlock = workflow.split("        run: |\n")[1];
assert.ok(
	runBlock,
	"The actual shared change-detection step must be exercised",
);
const script = runBlock
	.split("\n")
	.map((line) => {
		assert.ok(!line.trim() || line.startsWith("          "));
		return line.slice(10);
	})
	.join("\n");
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function changes(path, module, event = "pull_request") {
	const directory = mkdtempSync(join(tmpdir(), "bible-on-site-ci-routing-"));
	try {
		const git = (...args) =>
			execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
		git("init", "--quiet");
		git("config", "user.name", "CI fixture");
		git("config", "user.email", "ci-fixture@example.invalid");
		git("config", "core.autocrlf", "false");
		writeFileSync(join(directory, "README.md"), "Baseline\n");
		git("add", ".");
		git("commit", "--quiet", "-m", "Baseline");
		const base = git("rev-parse", "HEAD");
		mkdirSync(dirname(join(directory, path)), { recursive: true });
		writeFileSync(join(directory, path), "Changed\n");
		git("add", ".");
		git("commit", "--quiet", "-m", "Change");
		const expressions = {
			"github.event_name": event,
			"github.event.pull_request.base.sha": base,
			"github.event.before": base,
			"github.event.merge_group.base_sha": base,
			"inputs.module_name": module,
			"inputs.module_directory": module,
			"inputs.ci_path":
				".github/workflows/ci.yml,.github/workflows/shared-ci.yml",
		};
		const rendered = script.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
			assert.ok(Object.hasOwn(expressions, key), `Unknown expression: ${key}`);
			return expressions[key];
		});
		const scriptPath = join(directory, "detect.sh");
		const outputPath = join(directory, "github-output.txt");
		writeFileSync(scriptPath, rendered);
		execFileSync(
			shell,
			["-e", "-o", "pipefail", scriptPath.replaceAll("\\", "/")],
			{
				cwd: directory,
				env: {
					...process.env,
					GITHUB_OUTPUT: outputPath.replaceAll("\\", "/"),
				},
			},
		);
		return Object.fromEntries(
			readFileSync(outputPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => line.split("=")),
		);
	} finally {
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
		assert.ok(basename(directory).startsWith("bible-on-site-ci-routing-"));
		rmSync(directory, { recursive: true, force: true });
	}
}

for (const event of ["pull_request", "push", "merge_group"]) {
	for (const path of [
		"web/bible-on-site/package.json",
		"web/bible-on-site/package-lock.json",
		"web/bible-on-site/src/lib/recitation-audio.ts",
	]) {
		test(`${event}: ${path} checks the decoder without releasing the app`, () => {
			assert.deepEqual(changes(path, "app", event), {
				module_changed: "false",
				ci_changed: "true",
			});
		});
	}
}

test("approved timings release the website without releasing the app", () => {
	assert.deepEqual(
		changes("data/recitation/recitation.sqlite", "web/bible-on-site"),
		{
			module_changed: "true",
			ci_changed: "false",
		},
	);
	assert.deepEqual(changes("data/recitation/recitation.sqlite", "app"), {
		module_changed: "false",
		ci_changed: "false",
	});
});

test("a packaged decoder change releases the app", () => {
	assert.deepEqual(
		changes("app/BibleOnSite/Resources/Raw/recitation-mpeg.min.js", "app"),
		{
			module_changed: "true",
			ci_changed: "false",
		},
	);
});

test("native audio bridge changes release both dependent modules", () => {
	const path = "app/BibleOnSite/Resources/Raw/recitation-audio.html";
	for (const module of ["app", "web/bible-on-site"]) {
		assert.deepEqual(changes(path, module), {
			module_changed: "true",
			ci_changed: "false",
		});
	}
});

test("unrelated website UI does not run app checks", () => {
	assert.deepEqual(changes("web/bible-on-site/src/app/page.tsx", "app"), {
		module_changed: "false",
		ci_changed: "false",
	});
});

test("shared workflow changes validate the app without releasing it", () => {
	assert.deepEqual(changes(".github/workflows/shared-ci.yml", "app"), {
		module_changed: "false",
		ci_changed: "true",
	});
});
