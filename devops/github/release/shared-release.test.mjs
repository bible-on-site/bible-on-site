import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
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
	.replace(/\$\{\{ github.sha \}\}/g, "a".repeat(40));
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
for (const [status, bump, skip, releaseState, exit = 0] of [
	["identical", false, false, "missing"],
	["identical", false, true, "published"],
	["identical", false, false, "draft"],
	["identical", false, true, "published-original"],
	["identical", false, false, "draft-original"],
	["identical", false, false, "denied", 1],
	["behind", false, true],
	["ahead", true, true],
	["diverged", true, true],
]) {
	test(`existing tag ${status}/${releaseState ?? "unused"}: recovery or collision is explicit`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "release-tag-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const output = join(root, "output");
		mkdirSync(join(root, "devops/github/release"), { recursive: true });
		copyFileSync(
			new URL("./release-assets.mjs", import.meta.url),
			join(root, "devops/github/release/release-assets.mjs"),
		);
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
  elif [ "$RELEASE_STATE" = draft ]; then echo '{"draft":true}';
  elif [[ "$RELEASE_STATE" == *-original ]]; then echo "$RELEASE_JSON";
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
					RELEASE_JSON: JSON.stringify({
						tag_name: "website-v1.0.0",
						draft: releaseState === "draft-original",
						body: `<!-- release-delivery:${JSON.stringify({ module_name: "website", module_version: "1.0.0", ref: "a".repeat(40), ci_run_id: "9", released_artifact_name: "original-artifact" })} -->`,
					}),
					GITHUB_OUTPUT: output,
				},
			},
		);
		assert.equal(result.status, exit, result.stderr);
		if (exit) return;
		const values = readFileSync(output, "utf8");
		assert.match(values, new RegExp(`NEEDS_BUMP=${bump}`));
		assert.match(values, new RegExp(`SKIP_RELEASE=${skip}`));
		if (releaseState?.endsWith("-original")) {
			const payload = JSON.parse(
				values
					.split("\n")
					.find((line) => line.startsWith("CD_PAYLOAD="))
					.slice("CD_PAYLOAD=".length),
			);
			assert.equal(payload.ci_run_id, "9");
			assert.equal(payload.released_artifact_name, "original-artifact");
		}
	});
}
test("release artifact failures remain fatal and queues retain pending releases", () => {
	assert.match(workflow, /cancel-in-progress: false\n {6}queue: max/);
	assert.match(workflow, /fail_on_unmatched_files: true/);
	assert.doesNotMatch(workflow, /gh run download[^\n]+\|\|/);
});

test("publication stays draft until asset verification, and completed reruns replay original provenance", () => {
	assert.match(workflow, /draft: true/);
	assert.ok(
		workflow.indexOf("release-assets.mjs --verify") <
			workflow.indexOf("--draft=false"),
	);
	assert.match(workflow, /CD_PAYLOAD=\$ORIGINAL_PAYLOAD/);
	assert.match(workflow, /gh run download "\$SOURCE_RUN"/);
	assert.match(workflow, /steps.check_tag.outputs.ANCESTOR != 'true'/);
});
