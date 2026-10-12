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
const read = () => Promise.resolve(appResponse());

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
	withArchives(["recitation_2.aar", "perushim_notes.aar", "notes.txt"], (dir) => {
		assert.deepEqual(listArchives(dir), [
			path.join(dir, "perushim_notes.aar"),
			path.join(dir, "recitation_2.aar"),
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
			read,
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
				read,
			),
			/No \.aar asset packs found/,
		);
	}));
