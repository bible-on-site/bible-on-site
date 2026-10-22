import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	listArchives,
	uploadArguments,
	uploadAssetPacks,
} from "./asset-pack-upload.mjs";

const credentials = { key_id: "TESTKEY", issuer_id: "test-issuer" };
const appResponse = (id = "1045128150") => ({
	data: [
		{ type: "apps", id, attributes: { bundleId: "com.tanah.daily929" } },
	],
});
const packsResponse = (identifiers) => ({
	data: identifiers.map((identifier) => ({
		type: "backgroundAssets",
		id: `pack-${identifier}`,
		attributes: { assetPackIdentifier: identifier },
	})),
});
const read =
	(packs = []) =>
	(path) =>
		Promise.resolve(
			path.includes("backgroundAssets") ? packsResponse(packs) : appResponse(),
		);

function withArchives(names, fn) {
	const directory = mkdtempSync(path.join(tmpdir(), "asset-packs-"));
	try {
		for (const name of names)
			writeFileSync(path.join(directory, name), `${name} bytes`);
		return fn(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("listArchives returns sorted .aar files only", () =>
	withArchives(["recitation-2.aar", "perushim-notes.aar", "notes.txt"], (dir) => {
		assert.deepEqual(listArchives(dir), [
			path.join(dir, "perushim-notes.aar"),
			path.join(dir, "recitation-2.aar"),
		]);
	}));

test("uploadArguments invoke altool with the app and API key", () => {
	assert.deepEqual(
		uploadArguments("/tmp/pack.aar", "1045128150", credentials),
		[
			"altool",
			"--upload-asset-pack",
			"/tmp/pack.aar",
			"--apple-id",
			"1045128150",
			"--api-key",
			"TESTKEY",
			"--api-issuer",
			"test-issuer",
		],
	);
});

test("uploadAssetPacks uploads every archive once and returns the count", async () =>
	withArchives(["a.aar", "b.aar"], async (dir) => {
		const uploaded = [];
		const count = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				exec: (command, args) => uploaded.push([command, ...args]),
			},
			read(["a", "b"]),
		);
		assert.equal(count, 2);
		assert.equal(uploaded.length, 2);
		assert.equal(uploaded[0][0], "xcrun");
		assert.equal(uploaded[0][2], "--upload-asset-pack");
		assert.equal(uploaded[0][3], path.join(dir, "a.aar"));
		assert.equal(uploaded[1][3], path.join(dir, "b.aar"));
	}));

test("uploadAssetPacks fails fast when no archives exist", async () =>
	withArchives(["not-an-archive.zip"], async (dir) => {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					exec: () => {
						throw new Error("exec must not run");
					},
				},
				read(),
			),
			/No \.aar asset packs found/,
		);
	}));

// #2420: altool reports upload failures yet exits 0; the job must still fail.
test("uploadAssetPacks fails when altool prints a failure and exits 0", async () =>
	withArchives(["perushim-notes.aar"], async (dir) => {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					exec: () => ({
						status: 0,
						stdout: "2026-10-19 ERROR: [altool] Failed to upload asset pack at 'perushim-notes.aar' with 2 errors, 0 warnings, 0 info messages.\nFailed to get the list of asset packs for Apple ID '1045128150'. (-19243)",
					}),
				},
				read(["perushim-notes"]),
			),
			/perushim-notes/,
		);
	}));

test("uploadAssetPacks names only the failed pack among successes", async () =>
	withArchives(["good.aar", "bad.aar"], async (dir) => {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					exec: (command, args) =>
						args[2].endsWith("bad.aar")
							? {
									status: 0,
									stdout: "Failed to upload asset pack at 'bad.aar' with 2 errors",
								}
							: { status: 0, stdout: "Asset pack uploaded" },
				},
				read(["good", "bad"]),
			),
			(error) =>
				/bad/.test(error.message) &&
				!/failed.*good|good.*failed/i.test(error.message),
		);
	}));

test("uploadAssetPacks fails when a non-zero altool exit reports nothing", async () =>
	withArchives(["pack.aar"], async (dir) => {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					exec: () => ({ status: 1, stdout: "", stderr: "xcrun: error" }),
				},
				read(["pack"]),
			),
			/pack/,
		);
	}));

test("uploadAssetPacks verifies every uploaded pack exists on App Store Connect", async () =>
	withArchives(["recitation-1.aar", "recitation-2.aar"], async (dir) => {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					exec: () => ({ status: 0, stdout: "Asset pack uploaded" }),
				},
				read(["recitation-1"]),
			),
			/recitation-2/,
		);
	}));
