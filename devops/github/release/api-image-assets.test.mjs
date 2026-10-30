import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, verifyAPIImageAssets } from "./api-image-assets.mjs";
import { apiImageArtifacts } from "./release-provenance.mjs";

const sourceRef = "a".repeat(40);
function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "api-release-assets-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const payload = {
		module_name: "api",
		module_version: "1.2.3",
		ref: sourceRef,
		ci_run_id: 10,
		released_artifact_name: "bible-on-site-api-docker-10",
		released_arm64_artifact_name: "bible-on-site-api-docker-10-arm64",
	};
	const assets = [
		"bible-on-site-api-v1.2.3.tar.gz",
		"bible-on-site-api-v1.2.3-arm64.tar.gz",
	].map((name, index) => {
		const bytes = Buffer.from(`platform-archive-${index}`);
		writeFileSync(join(directory, name), bytes);
		return {
			name,
			state: "uploaded",
			size: bytes.length,
			digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
		};
	});
	const release = {
		tag_name: "api-v1.2.3",
		draft: false,
		prerelease: false,
		body: `<!-- release-delivery:${JSON.stringify(payload)} -->`,
		assets,
	};
	return {
		directory,
		payload,
		release,
		options: { version: "1.2.3", sourceRef, directory },
	};
}

test("both downloaded platform archives match published source, lengths and digests", (t) => {
	const { release, options } = fixture(t);
	assert.deepEqual(
		verifyAPIImageAssets(release, options),
		release.assets.map((asset) => asset.name),
	);
});

test("the CLI entry binds lookup to the canonical API version", (t) => {
	const { release, options } = fixture(t);
	const result = main(
		{
			MODULE_VERSION: "1.2.3",
			GITHUB_REPOSITORY: "test/repo",
			API_RELEASE_SOURCE: sourceRef,
			DOCKER_IMAGE_OUTPUT_DIR: options.directory,
		},
		(repo, tag) => {
			assert.equal(repo, "test/repo");
			assert.equal(tag, "api-v1.2.3");
			return release;
		},
	);
	assert.equal(result.length, 2);
	assert.throws(
		() =>
			main({ MODULE_VERSION: "bad" }, () =>
				assert.fail("invalid version must not look up a release"),
			),
		/Invalid API/,
	);
});

for (const field of ["draft", "prerelease"]) {
	test(`a ${field} release cannot feed API publication`, (t) => {
		const { release, options } = fixture(t);
		assert.throws(
			() => verifyAPIImageAssets({ ...release, [field]: true }, options),
			/published canonical/,
		);
	});
}

test("missing releases, invalid source inputs and foreign sources fail closed", (t) => {
	const { release, options } = fixture(t);
	assert.throws(
		() => verifyAPIImageAssets(null, options),
		/published canonical/,
	);
	assert.throws(
		() =>
			verifyAPIImageAssets(release, { ...options, sourceRef: "b".repeat(40) }),
		/source differs/,
	);
	for (const change of [
		{ version: "../bad" },
		{ sourceRef: "master" },
		{ directory: "" },
	]) {
		assert.throws(
			() => verifyAPIImageAssets(release, { ...options, ...change }),
			/requires a version/,
		);
	}
	assert.throws(
		() => verifyAPIImageAssets({ ...release, body: "legacy release" }, options),
		/source differs/,
	);
});

for (const platform of [0, 1]) {
	for (const defect of [
		"missing",
		"duplicate",
		"digest",
		"size",
		"pending",
		"bytes",
	]) {
		test(`platform ${platform} ${defect} cannot be published`, (t) => {
			const { release, options, directory } = fixture(t);
			const name = release.assets[platform].name;
			if (defect === "missing") release.assets.splice(platform, 1);
			if (defect === "duplicate")
				release.assets.push({ ...release.assets[platform] });
			if (defect === "digest") delete release.assets[platform].digest;
			if (defect === "size") release.assets[platform].size++;
			if (defect === "pending") release.assets[platform].state = "new";
			if (defect === "bytes")
				writeFileSync(join(directory, name), "corrupt same-size!!");
			assert.throws(
				() => verifyAPIImageAssets(release, options),
				/API archive|release asset/,
			);
		});
	}
}

test("platform artifact names require the exact recorded CI run and module", (t) => {
	const { payload } = fixture(t);
	assert.deepEqual(apiImageArtifacts(payload), {
		amd64: payload.released_artifact_name,
		arm64: payload.released_arm64_artifact_name,
	});
	assert.equal(apiImageArtifacts(undefined), undefined);
	assert.equal(
		apiImageArtifacts({ ...payload, released_arm64_artifact_name: undefined }),
		undefined,
	);
	for (const change of [
		{ ci_run_id: "other" },
		{ module_name: "website" },
		{ released_artifact_name: "another-run" },
		{ released_arm64_artifact_name: "" },
		{ released_arm64_artifact_name: null },
	]) {
		assert.throws(
			() => apiImageArtifacts({ ...payload, ...change }),
			/published CI provenance/,
		);
	}
});
