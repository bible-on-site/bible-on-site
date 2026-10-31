import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assetMirrorDirectory, localAssetEnvironment, syncLocalAssetMirror } from "./asset-mirror.mjs";

function fixture(t) {
	const cacheRoot = mkdtempSync(path.join(tmpdir(), "asset-mirror-"));
	t.after(() => rmSync(cacheRoot, { recursive: true, force: true }));
	return { sourceBucket: "prod-assets", region: "il-central-1", targetBucket: "local-assets-dev", endpoint: "http://localhost:4566", cacheRoot };
}

test("separate worktrees reuse a persistent incremental download and still refresh changed objects", (t) => {
	const options = fixture(t);
	let source = "original recording";
	let downloads = 0;
	const uploaded = [];
	const run = (command, args) => {
		assert.equal(command, "aws");
		assert.ok(args.includes("--delete"));
		if (args[2] === "s3://prod-assets") {
			const file = path.join(args[3], "recording.mp3");
			if (!existsSync(file) || readFileSync(file, "utf8") !== source) {
				downloads++;
				writeFileSync(file, source);
			}
		} else {
			uploaded.push(readFileSync(path.join(args[2], "recording.mp3"), "utf8"));
		}
		return { status: 0 };
	};
	const first = syncLocalAssetMirror(options, { run });
	const second = syncLocalAssetMirror({ ...options }, { run });
	assert.equal(first, second);
	assert.equal(downloads, 1);
	assert.ok(existsSync(path.join(first, "recording.mp3")));
	source = "replacement recording";
	syncLocalAssetMirror(options, { run });
	assert.equal(downloads, 2);
	assert.deepEqual(uploaded, ["original recording", "original recording", "replacement recording"]);
});

test("download failures preserve the cache, skip upload and release the lock", (t) => {
	const options = fixture(t);
	const directory = assetMirrorDirectory(options.sourceBucket, options.region, options.cacheRoot);
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, "old.mp3"), "retained");
	let calls = 0;
	assert.throws(() => syncLocalAssetMirror(options, { run: () => { calls++; return { status: 1, stderr: "sensitive endpoint" }; } }), /Production asset download failed/);
	assert.equal(calls, 1);
	assert.equal(readFileSync(path.join(directory, "old.mp3"), "utf8"), "retained");
	assert.equal(existsSync(`${directory}.lock`), false);
});

test("upload or launch failures release the lock without discarding downloaded bytes", (t) => {
	for (const failed of [{ status: 2 }, { status: null, error: new Error("missing aws") }]) {
		const options = fixture(t);
		let calls = 0;
		const directory = assetMirrorDirectory(options.sourceBucket, options.region, options.cacheRoot);
		assert.throws(() => syncLocalAssetMirror(options, { run: () => {
			if (++calls === 1) { writeFileSync(path.join(directory, "new.mp3"), "cached"); return { status: 0 }; }
			return failed;
		} }), /Local asset upload failed/);
		assert.equal(existsSync(`${directory}.lock`), false);
		assert.equal(readFileSync(path.join(directory, "new.mp3"), "utf8"), "cached");
	}
});

test("concurrent mirror fails before download and leaves the other lock intact", (t) => {
	const options = fixture(t);
	const directory = assetMirrorDirectory(options.sourceBucket, options.region, options.cacheRoot);
	mkdirSync(directory, { recursive: true });
	mkdirSync(`${directory}.lock`);
	assert.throws(() => syncLocalAssetMirror(options, { run: () => assert.fail("No AWS call while locked") }), /Another asset mirror is active/);
	assert.ok(existsSync(`${directory}.lock`));
});

test("production reads retain the current identity; local writes cannot receive its session token", (t) => {
	const options = fixture(t);
	const environments = [];
	syncLocalAssetMirror(options, { env: { AWS_PROFILE: "existing-sso", AWS_SESSION_TOKEN: "session", S3_ACCESS_KEY_ID: "local", S3_SECRET_ACCESS_KEY: "local-secret" }, run: (_command, _args, config) => { environments.push(config.env); return { status: 0 }; } });
	assert.equal(environments[0].AWS_SESSION_TOKEN, "session");
	assert.equal(environments[1].AWS_SESSION_TOKEN, "");
	assert.equal(environments[1].AWS_ACCESS_KEY_ID, "local");
	const fallback = localAssetEnvironment({ AWS_SECURITY_TOKEN: "legacy-token" });
	assert.equal(fallback.AWS_SECURITY_TOKEN, "");
	assert.equal(fallback.AWS_ACCESS_KEY_ID, "test");
	assert.equal(fallback.AWS_SECRET_ACCESS_KEY, "test_1234");
});

test("unsafe endpoints, bucket names and traversal are rejected before any AWS call", (t) => {
	const options = fixture(t);
	for (const endpoint of ["https://bucket.s3.amazonaws.com", "http://example.com", "http://localhost:4566/path", "http://user:password@localhost:4566", "http://localhost/?x=1", "http://localhost/#x"]) {
		assert.throws(() => syncLocalAssetMirror({ ...options, endpoint }), /local HTTP/);
	}
	for (const sourceBucket of ["../assets", "prod/child", "prod..assets", "a"]) assert.throws(() => assetMirrorDirectory(sourceBucket, options.region), /source asset bucket/);
	for (const region of ["../region", "il/central", ""]) assert.throws(() => assetMirrorDirectory("prod-assets", region), /source region/);
	for (const targetBucket of [options.sourceBucket, "../dev", "dev..assets"]) assert.throws(() => syncLocalAssetMirror({ ...options, targetBucket }), /distinct development bucket/);
	assert.notEqual(assetMirrorDirectory("prod-assets", options.region, options.cacheRoot), assetMirrorDirectory("other-assets", options.region, options.cacheRoot));
});
