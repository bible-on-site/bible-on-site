import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/shared-release.yml", import.meta.url),
	"utf8",
).replace(/\r/g, "");
const script = workflow
	.split("      - name: Check Tag\n")[1]
	.split("        run: |\n")[1]
	.split("\n      - name:")[0]
	.split("\n")
	.map((line) => line.slice(10))
	.join("\n")
	.replace(/\$\{\{ inputs.module_name \}\}/g, "website")
	.replace(/\$\{\{ inputs.module_version \}\}/g, "1.0.0")
	.replace(/\$\{\{ github.repository \}\}/g, "test/repo")
	.replace(/\$\{\{ github.sha \}\}/g, "source");
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
for (const [status, bump, skip, releaseState, exit = 0] of [
	["identical", false, false, "missing"],
	["identical", false, true, "published"],
	["identical", false, false, "denied", 1],
	["behind", false, true],
	["ahead", true, true],
	["diverged", true, true],
]) {
	test(`existing tag ${status}/${releaseState ?? "unused"}: recovery or collision is explicit`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "release-tag-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const output = join(root, "output");
		const result = spawnSync(
			shell,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`git() { printf 'sha refs/tags/website-v1.0.0\\n'; }\ngh() {
  if [[ "$2" == */compare/* ]]; then echo "$STATUS";
  elif [ "$RELEASE_STATE" = published ]; then echo '{}';
  elif [ "$RELEASE_STATE" = denied ]; then echo 'gh: Forbidden (HTTP 403)' >&2; return 1;
  else echo 'gh: Not Found (HTTP 404)' >&2; return 1; fi
}\n${script}`,
			],
			{
				encoding: "utf8",
				cwd: root,
				env: {
					...process.env,
					STATUS: status,
					RELEASE_STATE: releaseState,
					GITHUB_OUTPUT: output,
				},
			},
		);
		assert.equal(result.status, exit, result.stderr);
		if (exit) return;
		const values = readFileSync(output, "utf8");
		assert.match(values, new RegExp(`NEEDS_BUMP=${bump}`));
		assert.match(values, new RegExp(`SKIP_RELEASE=${skip}`));
	});
}
test("release artifact failures remain fatal and queues retain pending releases", () => {
	assert.match(workflow, /cancel-in-progress: false\n {6}queue: max/);
	assert.match(workflow, /fail_on_unmatched_files: true/);
	assert.doesNotMatch(workflow, /gh run download[^\n]+\|\|/);
});
