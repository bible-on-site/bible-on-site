import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { releasePayload, verifyReleaseAssets } from "./release-assets.mjs";

const payload = {
	ref: "a".repeat(40),
	module_name: "app",
	module_version: "5.0.120",
	ci_run_id: "10",
	ios_artifact_name: "app-ios-v5.0.120",
};
const release = {
	tag_name: "app-v5.0.120",
	body: `Release notes\n<!-- release-delivery:${JSON.stringify(payload)} -->`,
};

test("reruns recover the original immutable source, CI run and artifact names", () => {
	assert.deepEqual(releasePayload(release), payload);
	assert.equal(releasePayload({ body: "Legacy notes" }), undefined);
});
test("invalid recovery metadata fails visibly", () => {
	assert.throws(
		() => releasePayload({ ...release, tag_name: "app-v5.0.121" }),
		/does not match/,
	);
	assert.throws(
		() =>
			releasePayload({
				...release,
				body: "<!-- release-delivery:{broken} -->",
			}),
		SyntaxError,
	);
});

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "release-assets-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "ipa"));
	writeFileSync(join(root, "ipa/app.ipa"), "signed original binary");
	const artifacts = [{ name: "app-ios-v5.0.120", path: "ipa", glob: "*.ipa" }];
	const asset = {
		name: "app.ipa",
		state: "uploaded",
		size: 22,
		digest: `sha256:${createHash("sha256").update("signed original binary").digest("hex")}`,
	};
	return { root, artifacts, asset };
}
test("complete uploads can be published", (t) => {
	const { root, artifacts, asset } = fixture(t);
	verifyReleaseAssets({ assets: [asset] }, artifacts, root);
});
test("interrupted, truncated and changed uploads cannot be published", (t) => {
	const { root, artifacts, asset } = fixture(t);
	for (const assets of [
		[],
		[{ ...asset, state: "new" }],
		[{ ...asset, size: 3 }],
		[{ ...asset, digest: "sha256:wrong" }],
	]) {
		assert.throws(
			() => verifyReleaseAssets({ assets }, artifacts, root),
			/Incomplete or mismatched/,
		);
	}
});
test("missing files and duplicate names fail before publication", (t) => {
	const { root, artifacts, asset } = fixture(t);
	assert.throws(
		() =>
			verifyReleaseAssets(
				{ assets: [asset] },
				[{ ...artifacts[0], glob: "*.aab" }],
				root,
			),
		/No release files/,
	);
	assert.throws(
		() =>
			verifyReleaseAssets(
				{ assets: [asset] },
				[...artifacts, ...artifacts],
				root,
			),
		/Duplicate release asset/,
	);
	assert.throws(
		() => verifyReleaseAssets({ assets: [] }, [], root),
		/at least one asset/,
	);
});
