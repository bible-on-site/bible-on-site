import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compactDispatchPayload } from "./dispatch-payload.mjs";

const native = Object.freeze({
	ref: "e742f9967e677fd1b0ee87f6fb95d2d4deb21c1d",
	module_name: "app",
	module_directory: "app",
	module_version: "5.0.164",
	ci_run_id: "38504114758",
	ci_run_attempt: "1",
	windows_artifact_name: "app-windows-v5.0.164",
	android_artifact_name: "app-android-v5.0.164",
	ios_artifact_name: "app-ios-v5.0.164",
	ios_assetpacks_artifact_name: "app-ios-v5.0.164",
	ios_payloads_artifact_name: "app-ios-v5.0.164",
});

test("the five-artifact native release fits dispatch without losing any binding", () => {
	assert.equal(Object.keys(native).length, 11);
	const payload = compactDispatchPayload(native);
	assert.equal(Object.keys(payload).length, 7);
	const { artifacts, ...provenance } = payload;
	assert.deepEqual({ ...provenance, ...artifacts }, native);
	assert.equal(Object.keys(native).length, 11);
});

test("existing flat payloads, including the ten-property limit, are unchanged", () => {
	const { ios_payloads_artifact_name, ...ten } = native;
	assert.equal(ios_payloads_artifact_name, native.ios_artifact_name);
	assert.equal(Object.keys(ten).length, 10);
	assert.deepEqual(compactDispatchPayload(ten), ten);
	const website = {
		ref: native.ref,
		module_name: "website",
		ci_run_id: "12",
		released_artifact_name: "website-docker-v1.0.0",
	};
	assert.deepEqual(compactDispatchPayload(website), website);
});

test("already compact payloads replay without changing immutable provenance", () => {
	const payload = compactDispatchPayload(native);
	assert.deepEqual(compactDispatchPayload(payload), payload);
});

test("non-artifact overflow and conflicting envelopes fail instead of dropping metadata", () => {
	assert.throws(
		() => compactDispatchPayload({ ...native, artifacts: { old: "kept" } }),
		/already exists/,
	);
	assert.throws(
		() => compactDispatchPayload(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`source${i}`, i]))),
		/still exceeds/,
	);
	for (const payload of [null, [], "value"])
		assert.throws(() => compactDispatchPayload(payload), /must be an object/);
});

test("the dispatch step transports the original payload, while native jobs read both formats", (t) => {
	const root = mkdtempSync(join(tmpdir(), "dispatch-payload-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const output = join(root, "output");
	const result = spawnSync(process.execPath, [fileURLToPath(new URL("./dispatch-payload.mjs", import.meta.url))], {
		encoding: "utf8",
		env: { ...process.env, RELEASE_PAYLOAD: JSON.stringify(native), GITHUB_OUTPUT: output },
	});
	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(readFileSync(output, "utf8").trim().slice("client_payload=".length));
	assert.deepEqual(payload, compactDispatchPayload(native));
	const release = readFileSync(new URL("../../../.github/workflows/shared-release.yml", import.meta.url), "utf8");
	assert.match(release, /RELEASE_PAYLOAD: \$\{\{ needs.release.outputs.cd_payload \}\}/);
	assert.match(release, /run: node devops\/github\/release\/dispatch-payload\.mjs/);
	assert.match(release, /client-payload: \$\{\{ steps.dispatch_payload.outputs.client_payload \}\}/);
	const app = readFileSync(new URL("../../../.github/workflows/cd-app.yml", import.meta.url), "utf8");
	for (const platform of ["android", "windows", "ios"])
		assert.ok(app.includes(`github.event.client_payload.artifacts.${platform}_artifact_name || github.event.client_payload.${platform}_artifact_name`));
});
