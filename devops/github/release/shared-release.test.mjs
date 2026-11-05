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
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const ciWorkflow = readFileSync(
	new URL("../../../.github/workflows/ci.yml", import.meta.url),
	"utf8",
).replace(/\r/g, "");
function job(name) {
	return ciWorkflow
		.split(`  ${name}:\n`)[1]
		.split(/\n {2}[a-z][a-z0-9_]*:\n/)[0];
}

test("manual recovery defaults off and only the two selected services may release", () => {
	assert.match(
		ciWorkflow,
		/release_recovery:\n[\s\S]*?options: \["none", "admin", "bulletin", "admin-and-bulletin"\]\n {8}default: "none"/,
	);
	const determine = job("determine_changes");
	assert.ok(
		determine.indexOf("--preflight") <
			determine.indexOf("Determine module changes"),
	);
	assert.match(determine, /actions: read/);
	for (const module of ["admin", "bulletin"]) {
		const release = job(`release_${module}`);
		assert.match(release, /cross_module_ci.result == 'success'/);
		assert.ok(release.includes(`needs.package_${module}.result == 'success'`));
		assert.match(release, /is_master_branch == 'true'/);
		assert.match(release, /github.event_name == 'workflow_dispatch'/);
		assert.ok(release.includes(`${module}_release_recovery == 'true'`));
		assert.match(release, /release_recovery_requested == 'true'/);
		assert.match(release, /normal_master_ci_json:/);
		assert.ok(
			job(`package_${module}`).includes(`${module}_release_recovery == 'true'`),
		);
	}
	for (const module of ["website", "api", "app", "data"]) {
		const release = job(`release_${module}`);
		assert.match(release, /github.event_name == 'push'/);
		assert.doesNotMatch(release, /workflow_dispatch|release_recovery/);
	}
});

test("recovery forces full admin E2E without globally forcing native or other suites", () => {
	assert.match(
		job("admin_ci"),
		/FORCE_FULL_SUITE:.*admin_release_recovery == 'true'/,
	);
	assert.doesNotMatch(job("app_mobile_e2e"), /release_recovery/);
	const globalFullSuite = ciWorkflow
		.split("\n")
		.find((line) => /^ {2}FORCE_FULL_SUITE:/.test(line));
	assert.doesNotMatch(globalFullSuite, /release_recovery/);
	assert.match(
		job("bump_versions"),
		/workflow_dispatch.*release_recovery_requested == 'true'/,
	);
});

test("publication binds a separate receipt after archive verification and rechecks master before exposing it", () => {
	assert.ok(
		workflow.indexOf("sha256sum --check --status") <
			workflow.indexOf("name: Create explicit recovery receipt"),
	);
	assert.ok(
		workflow.indexOf("name: Create explicit recovery receipt") <
			workflow.indexOf("name: Prepare Release"),
	);
	assert.match(workflow, /release-pinned-artifacts\.jsonl/);
	assert.match(
		workflow,
		/steps.recovery_receipt.outputs.ARTIFACTS_JSON \|\| inputs.artifacts_json/,
	);
	assert.match(
		workflow,
		/NEW_PAYLOAD:.*steps.recovery_receipt.outputs.CD_PAYLOAD/,
	);
	assert.ok(
		stepScript("Push Tag").indexOf("--assert-current") <
			stepScript("Push Tag").indexOf("git push"),
	);
	assert.ok(
		stepScript("Verify and publish complete release").indexOf(
			"--assert-current",
		) <
			stepScript("Verify and publish complete release").indexOf(
				"-F draft=false",
			),
	);
});

for (const module of ["admin", "bulletin"]) {
	test(`recovery receipt shell hashes the extracted ${module} package separately from the pinned ZIP and keeps one nested dispatch field`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "recovery-workflow-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		mkdirSync(join(root, "devops/github/release"), { recursive: true });
		for (const file of ["recovery-request.mjs", "gh-api.mjs"])
			copyFileSync(
				new URL(`./${file}`, import.meta.url),
				join(root, "devops/github/release", file),
			);
		mkdirSync(join(root, "assets"));
		const name =
			module === "admin"
				? "bible-on-site-admin-v1.0.0.tar.gz"
				: "bulletin-lambda-v1.0.0.zip";
		const packageBytes = Buffer.from(`current-run ${module} package`);
		writeFileSync(join(root, "assets", name), packageBytes);
		const archive = {
			id: 44,
			name: `package-${module}`,
			digest: `sha256:${"c".repeat(64)}`,
		};
		writeFileSync(
			join(root, "release-pinned-artifacts.jsonl"),
			`${JSON.stringify(archive)}\n`,
		);
		// Only API validation is substituted: the actual receipt writer streams
		// and hashes the real package fixture, with no provider/network requests.
		writeFileSync(
			join(root, "pure-receipt.mjs"),
			'import {readFileSync} from "node:fs"; import {writeRecoveryReceipt} from "./devops/github/release/recovery-request.mjs"; const args=process.argv.slice(2); console.log(JSON.stringify(await writeRecoveryReceipt(JSON.parse(readFileSync(args[args.indexOf("--input")+1],"utf8")),args[args.indexOf("--out")+1])));',
		);
		const source = "a".repeat(40);
		const normal = {
			runId: 9,
			runAttempt: 1,
			workflowId: 5,
			workflowPath: ".github/workflows/ci.yml",
			sha: source,
		};
		const payload = {
			ref: source,
			module_name: module,
			module_directory: `web/${module}`,
			module_version: "1.0.0",
			ci_run_id: "10",
			ci_run_attempt: "1",
			released_artifact_name: archive.name,
		};
		const result = spawnSync(
			shell,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`gh() { printf '%s\\n' '{"runId":10,"runAttempt":1,"workflowId":5}'; }\nnode() { command node pure-receipt.mjs "$@"; }\n${stepScript("Create explicit recovery receipt")}`,
			],
			{
				cwd: root,
				encoding: "utf8",
				env: {
					...process.env,
					RUNNER_TEMP: root.replace(/\\/g, "/"),
					GITHUB_OUTPUT: join(root, "output").replace(/\\/g, "/"),
					GITHUB_REPOSITORY: "test/repo",
					GITHUB_SHA: source,
					GITHUB_RUN_ID: "10",
					RELEASE_MODULE: module,
					RELEASE_RECOVERY_MODULES: JSON.stringify([module]),
					NORMAL_MASTER_CI: JSON.stringify(normal),
					MODULE_DIRECTORY: `web/${module}`,
					MODULE_VERSION: "1.0.0",
					BASE_PAYLOAD: JSON.stringify(payload),
					RELEASE_ARTIFACTS: JSON.stringify([
						{
							name: archive.name,
							path: "assets",
							glob: module === "admin" ? "*.tar.gz" : "*.zip",
						},
					]),
				},
			},
		);
		assert.equal(result.status, 0, result.stderr);
		const receipt = JSON.parse(
			readFileSync(join(root, `release-recovery-${module}.json`), "utf8"),
		);
		assert.deepEqual(receipt.artifact, archive);
		assert.equal(receipt.releaseFile.name, name);
		assert.equal(receipt.releaseFile.size, packageBytes.length);
		assert.equal(
			receipt.releaseFile.digest,
			`sha256:${createHash("sha256").update(packageBytes).digest("hex")}`,
		);
		assert.notEqual(receipt.releaseFile.digest, archive.digest);
		const outputs = Object.fromEntries(
			readFileSync(join(root, "output"), "utf8")
				.trim()
				.split("\n")
				.map((line) => {
					const equals = line.indexOf("=");
					return [line.slice(0, equals), line.slice(equals + 1)];
				}),
		);
		const dispatch = JSON.parse(outputs.CD_PAYLOAD);
		assert.equal(Object.keys(dispatch).length, 8);
		assert.deepEqual(Object.keys(dispatch.recovery).sort(), [
			"artifact",
			"receipt",
			"schemaVersion",
		]);
		assert.equal(dispatch.released_artifact_name, archive.name);
		assert.equal(
			JSON.parse(outputs.ARTIFACTS_JSON).at(-1).glob,
			`release-recovery-${module}.json`,
		);
	});
}
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
		for (const file of [
			"release-assets.mjs",
			"release-provenance.mjs",
			"recovery-request.mjs",
			"gh-api.mjs",
		])
			copyFileSync(
				new URL(`./${file}`, import.meta.url),
				join(root, "devops/github/release", file),
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
		assert.ok(
			values.includes(`NEEDS_BUMP=${bump}`),
			`expected NEEDS_BUMP=${bump}`,
		);
		assert.ok(
			values.includes(`SKIP_RELEASE=${skip}`),
			`expected SKIP_RELEASE=${skip}`,
		);
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
		for (const file of [
			"release-assets.mjs",
			"release-provenance.mjs",
			"recovery-request.mjs",
			"gh-api.mjs",
		])
			copyFileSync(
				new URL(`./${file}`, import.meta.url),
				join(root, "devops/github/release", file),
			);
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "assets/app.ipa"), "signed original binary");
		writeFileSync(join(root, "event.json"), "{}");
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
					GITHUB_EVENT_PATH: join(root, "event.json"),
					GITHUB_EVENT_NAME: "push",
					RELEASE_MODULE: "app",
					RELEASE_RECOVERY_MODULES: "[]",
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

// One real Actions ZIP contains every iOS release output type. Re-extracting
// it reproduces the production overwrite prompt without mocking unzip itself.
const iosArtifactZip = Buffer.from(
	"UEsDBBQAAAAAAASsVV2gsmEUEgAAABIAAAAPAAAAQmlibGVPblNpdGUuaXBhc2lnbmVkIGlwYSBmaXh0dXJlUEsDBBQAAAAAAASsVV1dhNurFQAAABUAAAAbAAAAYXNzZXRwYWNrcy9yZWNpdGF0aW9uLTEuYWFyYXBwbGUgYXJjaGl2ZSBmaXh0dXJlUEsDBBQAAAAAAASsVV0WPgX8FQAAABUAAAAZAAAAcGF5bG9hZHMvcmVjaXRhdGlvbi0xLnppcGF1ZGlvIHBheWxvYWQgZml4dHVyZVBLAQIUABQAAAAAAASsVV2gsmEUEgAAABIAAAAPAAAAAAAAAAAAAACAAQAAAABCaWJsZU9uU2l0ZS5pcGFQSwECFAAUAAAAAAAErFVdXYTbqxUAAAAVAAAAGwAAAAAAAAAAAAAAgAE/AAAAYXNzZXRwYWNrcy9yZWNpdGF0aW9uLTEuYWFyUEsBAhQAFAAAAAAABKxVXRY+BfwVAAAAFQAAABkAAAAAAAAAAAAAAIABjQAAAHBheWxvYWRzL3JlY2l0YXRpb24tMS56aXBQSwUGAAAAAAMAAwDNAAAA2QAAAAAA",
	"base64",
);
for (const scenario of [
	"repeated-ios",
	"different-targets",
	"stale-target",
	"bad-digest",
	"download-failed",
]) {
	test(`artifact extraction is complete and noninteractive: ${scenario}`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "release-download-"));
		t.after(() => {
			assert.ok(root.startsWith(join(tmpdir(), "release-download-")));
			rmSync(root, { recursive: true, force: true });
		});
		const zip = join(root, "fixture.zip");
		const metadata = join(root, "metadata.jsonl");
		const calls = join(root, "downloads");
		writeFileSync(zip, iosArtifactZip);
		writeFileSync(
			metadata,
			`${JSON.stringify({
				id: 7,
				name: "app-ios-v1.0.0",
				expired: false,
				digest: `sha256:${scenario === "bad-digest" ? "0".repeat(64) : createHash("sha256").update(iosArtifactZip).digest("hex")}`,
				workflow_run: { id: 9, head_sha: "a".repeat(40) },
			})}\n`,
		);
		let artifacts = [
			{ name: "app-ios-v1.0.0", path: "stage/ios", glob: "*.ipa" },
		];
		if (scenario === "repeated-ios")
			artifacts = [
				...artifacts,
				{ ...artifacts[0], glob: "**/*.aar" },
				{ ...artifacts[0], glob: "payloads/*" },
			];
		if (scenario === "different-targets")
			artifacts.push({ ...artifacts[0], path: "other/ios" });
		if (scenario === "stale-target") {
			mkdirSync(join(root, "stage/ios"), { recursive: true });
			writeFileSync(join(root, "stage/ios/BibleOnSite.ipa"), "stale binary");
		}
		const download = stepScript("Download Artifacts")
			.replace(/\$\{\{ inputs\.artifacts_json \}\}/, JSON.stringify(artifacts))
			.replace(
				/\$\{\{ steps\.check_tag\.outputs\.CD_PAYLOAD \|\| steps\.build_payload\.outputs\.CD_PAYLOAD \}\}/,
				JSON.stringify({ ci_run_id: "9", ci_run_attempt: 1 }),
			);
		const result = spawnSync(
			shell,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`gh() {
  if [[ "$2" == */actions/runs/9/artifacts ]]; then cat "$ARTIFACT_METADATA";
  elif [[ "$2" == */actions/runs/9 ]]; then printf '1\\n';
  elif [[ "$2" == */actions/artifacts/7/zip ]]; then
    printf 'download\\n' >> "$DOWNLOAD_CALLS"
    if [ "$DOWNLOAD_SCENARIO" = download-failed ]; then return 1; fi
    cat "$ZIP_FIXTURE"
  else echo "Unexpected artifact request" >&2; return 1; fi
}\n${download}`,
			],
			{
				cwd: root,
				encoding: "utf8",
				windowsHide: true,
				timeout: 15000,
				env: {
					...process.env,
					RUNNER_TEMP: root.replace(/\\/g, "/"),
					ZIP_FIXTURE: zip.replace(/\\/g, "/"),
					ARTIFACT_METADATA: metadata.replace(/\\/g, "/"),
					DOWNLOAD_CALLS: calls.replace(/\\/g, "/"),
					DOWNLOAD_SCENARIO: scenario,
				},
			},
		);
		if (scenario === "bad-digest" || scenario === "download-failed") {
			assert.notEqual(result.status, 0);
			assert.ok(!existsSync(join(root, "stage/ios/BibleOnSite.ipa")));
			return;
		}
		assert.equal(result.status, 0, result.stderr || result.error?.message);
		const downloads = readFileSync(calls, "utf8").trim().split("\n");
		assert.equal(downloads.length, scenario === "different-targets" ? 2 : 1);
		for (const target of scenario === "different-targets"
			? ["stage/ios", "other/ios"]
			: ["stage/ios"]) {
			assert.equal(
				readFileSync(join(root, target, "BibleOnSite.ipa"), "utf8"),
				"signed ipa fixture",
			);
			assert.equal(
				readFileSync(join(root, target, "assetpacks/recitation-1.aar"), "utf8"),
				"apple archive fixture",
			);
			assert.equal(
				readFileSync(join(root, target, "payloads/recitation-1.zip"), "utf8"),
				"audio payload fixture",
			);
		}
	});
}
