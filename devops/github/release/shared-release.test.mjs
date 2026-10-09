import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/shared-release.yml", import.meta.url),
	"utf8",
).replace(/\r/g, "");
function stepScript(name) {
	const lines = workflow
		.split(`      - name: ${name}\n`)[1]
		.split("        run: |\n")[1]
		.split("\n");
	const end = lines.findIndex(
		(line) => line.trim() && !line.startsWith("          "),
	);
	return lines
		.slice(0, end === -1 ? lines.length : end)
		.map((line) => line.slice(10))
		.join("\n")
		.replace(/\$\{\{ inputs.module_name \}\}/g, "website")
		.replace(/\$\{\{ inputs.module_version \}\}/g, "1.0.0")
		.replace(/\$\{\{ github.repository \}\}/g, "test/repo")
		.replace(/\$\{\{ github.sha \}\}/g, "a".repeat(40));
}
const script = stepScript("Check Tag");
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
		copyFileSync(
			new URL("./release-provenance.mjs", import.meta.url),
			join(root, "devops/github/release/release-provenance.mjs"),
		);
		const result = spawnSync(
			shell,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`git() { printf 'sha refs/tags/website-v1.0.0\\n'; }\ngh() { echo "$STATUS"; }\nnode() {
  if [ "$2" != --lookup ]; then command node "$@"; return; fi
  if [ "$RELEASE_STATE" = published ]; then echo '{}';
  elif [ "$RELEASE_STATE" = draft ]; then echo '{"draft":true}';
  elif [[ "$RELEASE_STATE" == *-original ]]; then echo "$RELEASE_JSON";
  elif [ "$RELEASE_STATE" = denied ]; then echo 'gh: Forbidden (HTTP 403)' >&2; return 1;
  else echo 'null'; fi
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
		if (releaseState === "published-original") {
			const payload = JSON.parse(
				values
					.split("\n")
					.find((line) => line.startsWith("CD_PAYLOAD="))
					.slice("CD_PAYLOAD=".length),
			);
			assert.equal(payload.ci_run_id, "9");
			assert.equal(payload.released_artifact_name, "original-artifact");
		}
		if (releaseState === "draft-original")
			assert.doesNotMatch(values, /CD_PAYLOAD=/);
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
			workflow.indexOf("-F draft=false"),
	);
	assert.match(workflow, /CD_PAYLOAD=\$ORIGINAL_PAYLOAD/);
	assert.match(workflow, /actions\/artifacts\/\$ID\/zip/);
	assert.doesNotMatch(workflow, /gh run download/);
	assert.match(workflow, /steps.check_tag.outputs.ANCESTOR != 'true'/);
});

for (const state of ["complete", "truncated", "unavailable", "invalid-id"]) {
	test(`publication uses the returned draft ID and preserves verification failures: ${state}`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "release-publish-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		mkdirSync(join(root, "devops/github/release"), { recursive: true });
		for (const file of ["release-assets.mjs", "release-provenance.mjs"])
			copyFileSync(
				new URL(`./${file}`, import.meta.url),
				join(root, "devops/github/release", file),
			);
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "assets/app.ipa"), "signed original binary");
		const calls = join(root, "calls");
		const releaseJson = {
			id: 7,
			draft: true,
			assets: [
				{
					name: "app.ipa",
					state: "uploaded",
					size: state === "truncated" ? 3 : 22,
					digest: `sha256:${createHash("sha256").update("signed original binary").digest("hex")}`,
				},
			],
		};
		const result = spawnSync(
			shell,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`gh() {
  printf '%s\\n' "$*" >> "$GH_CALLS"
  if [[ "$2" == */releases/tags/* ]] || [ "$RELEASE_STATE" = unavailable ]; then echo 'gh: Not Found (HTTP 404)' >&2; return 1; fi
  if [ "$2" = --method ]; then echo '{"id":7,"draft":false}'; else echo "$RELEASE_JSON"; fi
}\n${stepScript("Verify and publish complete release")}`,
			],
			{
				cwd: root,
				encoding: "utf8",
				env: {
					...process.env,
					GH_CALLS: calls,
					RELEASE_STATE: state,
					RELEASE_ID: state === "invalid-id" ? "7/../tags/other" : "7",
					RELEASE_JSON: JSON.stringify(releaseJson),
					RELEASE_ARTIFACTS: JSON.stringify([
						{ name: "original", path: "assets", glob: "*.ipa" },
					]),
					RUNNER_TEMP: root,
				},
			},
		);
		assert.equal(result.status, state === "complete" ? 0 : 1, result.stderr);
		const requests = existsSync(calls) ? readFileSync(calls, "utf8") : "";
		assert.doesNotMatch(requests, /releases\/tags\//);
		if (state === "complete")
			assert.match(
				requests,
				/api --method PATCH repos\/test\/repo\/releases\/7 -F draft=false/,
			);
		else assert.doesNotMatch(requests, /PATCH/);
	});
}
