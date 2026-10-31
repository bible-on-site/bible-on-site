import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	listArchives,
	loadPackPlan,
	planPack,
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

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const md5 = (content) => createHash("md5").update(content).digest("hex");

function planEntry(id, archiveContent, { files = null, content = null } = {}) {
	const fileList = files ?? [{ name: `${id}.zip`, sha256: sha256("payload"), bytes: 7 }];
	return {
		id,
		archive: `${id}.aar`,
		archiveSha256: sha256(archiveContent),
		archiveBytes: archiveContent.length,
		manifest: { assetPackID: id, downloadPolicy: { onDemand: {} }, platforms: ["iOS"] },
		files: fileList,
		contentSha256: content ?? sha256(`content-${id}`),
	};
}

function packDir(entries, archives = null) {
	const directory = mkdtempSync(path.join(tmpdir(), "asset-packs-"));
	for (const [name, content] of archives ?? entries.map((e) => [e.archive, e.archiveContent ?? `${e.id} bytes`]))
		writeFileSync(path.join(directory, name), content);
	if (entries)
		writeFileSync(
			path.join(directory, "asset-packs.json"),
			JSON.stringify({ version: 1, packs: entries.map(({ archiveContent, ...entry }) => entry) }),
		);
	return directory;
}

const cleanup = (directory) => rmSync(directory, { recursive: true, force: true });

function appleVersion(id, number, state, { checksum = null, beta = "READY_FOR_TESTING", platforms = ["IOS"] } = {}) {
	const betaId = beta ? `beta-${id}` : null;
	return {
		id,
		number,
		state,
		platforms,
		releases: {
			internalBeta: betaId ? { id: betaId, state: beta } : null,
			externalBeta: null,
			appStore: null,
		},
		checksum,
	};
}

function remotePack(identifier, versions, { missing = false } = {}) {
	return {
		pack: missing ? null : { id: `pack-${identifier}` },
		versions,
	};
}

const checksumOf = (content, algorithm = "sha256") => ({
	algorithm,
	hash: algorithm === "sha256" ? sha256(content) : md5(content),
});

// ---------- listArchives / uploadArguments ----------

function withArchives(names, fn) {
	const directory = mkdtempSync(path.join(tmpdir(), "asset-packs-"));
	try {
		for (const name of names)
			writeFileSync(path.join(directory, name), `${name} bytes`);
		return fn(directory);
	} finally {
		cleanup(directory);
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

// ---------- loadPackPlan ----------

test("loadPackPlan returns null when the release predates the pack plan", async () =>
	withArchives(["a.aar"], async (dir) => {
		assert.equal(await loadPackPlan(dir), null);
	}));

test("loadPackPlan loads a verified plan and checks archive digests", async () => {
	const entry = { ...planEntry("recitation-1", "archive-bytes"), archiveContent: "archive-bytes" };
	const dir = packDir([entry]);
	try {
		const packs = await loadPackPlan(dir);
		assert.equal(packs.length, 1);
		assert.equal(packs[0].id, "recitation-1");
		assert.equal(packs[0].archiveSha256, sha256("archive-bytes"));
	} finally {
		cleanup(dir);
	}
});

test("loadPackPlan rejects a plan whose archive was swapped after verification", async () => {
	const entry = { ...planEntry("a", "signed-bytes"), archiveContent: "signed-bytes" };
	const dir = packDir([entry], [["a.aar", "tampered"]]);
	try {
		await assert.rejects(loadPackPlan(dir), /digest does not match/);
	} finally {
		cleanup(dir);
	}
});

test("loadPackPlan rejects archives missing from the plan and plan entries without archives", async () => {
	const entry = { ...planEntry("a", "bytes"), archiveContent: "bytes" };
	for (const archives of [[["a.aar", "bytes"], ["extra.aar", "rogue"]], [["other.aar", "bytes"]]]) {
		const dir = packDir([entry], archives);
		try {
			await assert.rejects(loadPackPlan(dir), /missing|plan/);
		} finally {
			cleanup(dir);
		}
	}
});

test("loadPackPlan rejects malformed, duplicate and wrong-version plans", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "asset-packs-"));
	try {
		writeFileSync(path.join(dir, "a.aar"), "bytes");
		const entry = planEntry("a", "bytes");
		for (const plan of [
			{ version: 2, packs: [entry] },
			{ version: 1, packs: [{ id: "a" }] },
			{ version: 1, packs: [entry, entry] },
			{ version: 1, packs: [{ ...entry, manifest: { assetPackID: "other" } }] },
		]) {
			writeFileSync(path.join(dir, "asset-packs.json"), JSON.stringify(plan));
			await assert.rejects(loadPackPlan(dir));
		}
	} finally {
		cleanup(dir);
	}
});

// ---------- planPack ----------

test("planPack uploads when the pack record does not exist yet", () => {
	const decision = planPack(
		{ id: "p", archiveSha256: "a".repeat(64), contentSha256: "b".repeat(64) },
		remotePack("p", [], { missing: true }),
		null,
	);
	assert.equal(decision.action, "upload");
});

test("planPack reuses the live version when Apple checksum matches", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("bytes") })]);
	const decision = planPack(pack, remote, null);
	assert.equal(decision.action, "reuse");
	assert.equal(decision.version.id, "v1");
});

test("planPack uploads when the live version carries different content", () => {
	const pack = { id: "p", archiveSha256: sha256("new"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("old") })]);
	assert.equal(planPack(pack, remote, null).action, "upload");
});

test("planPack settles an in-flight version carrying the same bytes", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [
		appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("old") }),
		appleVersion("v2", 2, "PROCESSING", { checksum: checksumOf("bytes") }),
	]);
	const decision = planPack(pack, remote, null);
	assert.equal(decision.action, "settle");
	assert.equal(decision.version.id, "v2");
});

test("planPack uploads past a foreign in-flight version instead of waiting on it", () => {
	const pack = { id: "p", archiveSha256: sha256("ours"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [
		appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("old") }),
		appleVersion("v2", 2, "PROCESSING", { checksum: checksumOf("theirs") }),
	]);
	assert.equal(planPack(pack, remote, null).action, "upload");
});

test("planPack reuses via receipt when the live version lacks upload metadata", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE")]);
	const receipt = { versionId: "v1", contentSha256: pack.contentSha256, archiveSha256: pack.archiveSha256 };
	assert.equal(planPack(pack, remote, receipt).action, "reuse");
});

test("planPack reuses via receipt when the rebuilt archive differs but content ties", () => {
	const pack = { id: "p", archiveSha256: sha256("repacked"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("original") })]);
	const receipt = { versionId: "v1", contentSha256: pack.contentSha256, archiveSha256: sha256("original") };
	assert.equal(planPack(pack, remote, receipt).action, "reuse");
});

test("planPack uploads when the receipt names a different live version", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v9", 9, "COMPLETE")]);
	const receipt = { versionId: "v3", contentSha256: pack.contentSha256, archiveSha256: sha256("bytes") };
	assert.equal(planPack(pack, remote, receipt).action, "upload");
});

test("planPack waits when the matching live version is not ready for internal testing", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("bytes"), beta: "SUPERSEDED" })]);
	assert.equal(planPack(pack, remote, null).action, "settle");
});

test("planPack ignores versions that cannot serve iOS", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("bytes"), platforms: ["MAC_OS"] })]);
	assert.equal(planPack(pack, remote, null).action, "upload");
});

test("planPack uploads when only a reserved upload exists", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "AWAITING_UPLOAD", { checksum: checksumOf("bytes") })]);
	const decision = planPack(pack, remote, null);
	assert.equal(decision.action, "upload");
});

test("planPack blocks on a remote version without a resource id", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("", 1, "COMPLETE", { checksum: checksumOf("bytes") })]);
	assert.equal(planPack(pack, remote, null).action, "blocked");
});

test("planPack supports MD5 remote checksums", () => {
	const pack = { id: "p", archiveSha256: sha256("bytes"), contentSha256: "c".repeat(64) };
	const remote = remotePack("p", [appleVersion("v1", 1, "COMPLETE", { checksum: checksumOf("bytes", "md5") })]);
	assert.equal(planPack(pack, remote, null, md5("bytes")).action, "reuse");
	assert.equal(planPack(pack, remote, null, md5("other")).action, "upload");
});

// ---------- uploadAssetPacks: legacy path ----------

test("uploadAssetPacks uploads every archive once and returns the count", async () =>
	withArchives(["a.aar", "b.aar"], async (dir) => {
		const uploaded = [];
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				exec: (command, args) => uploaded.push([command, ...args]),
				github: null,
			},
			read(["a", "b"]),
		);
		assert.equal(result.uploaded, 2);
		assert.equal(result.legacy, true);
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
					github: null,
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
					github: null,
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
					github: null,
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
					github: null,
				},
				read(["recitation-1"]),
			),
			/recitation-2/,
		);
	}));

// ---------- uploadAssetPacks: planned path ----------

function remoteReader(remote, { appId = "1045128150" } = {}) {
	return async (requestPath, parameters) => {
		if (requestPath === "apps") return appResponse(appId);
		const packs = Object.entries(remote).map(([id, state]) => state.pack ?? {
			type: "backgroundAssets",
			id: `apple-pack-${id}`,
			attributes: { assetPackIdentifier: id },
		});
		if (requestPath.includes("/backgroundAssets") && requestPath.startsWith("apps/")) {
			const filter = parameters?.["filter[assetPackIdentifier]"];
			return {
				data: filter
					? packs.filter((p) => p.attributes.assetPackIdentifier === filter)
					: packs,
			};
		}
		if (requestPath.endsWith("/versions")) {
			const packId = requestPath.split("/")[1];
			const state = Object.values(remote).find((s) => s.pack?.id === packId);
			const included = [];
			const data = (state?.versions ?? []).map((version) => {
				const relationships = {};
				if (version.beta != null) {
					const betaId = `beta-${version.id}`;
					relationships.internalBetaRelease = { data: { type: "backgroundAssetVersionInternalBetaReleases", id: betaId } };
					included.push({ type: "backgroundAssetVersionInternalBetaReleases", id: betaId, attributes: { state: version.beta } });
				}
				return {
					type: "backgroundAssetVersions",
					id: version.id,
					attributes: { version: String(version.number), state: version.state, platforms: version.platforms ?? ["IOS"] },
					relationships,
				};
			});
			return { data, included };
		}
		if (requestPath.endsWith("/backgroundAssetUploadFiles")) {
			const versionId = requestPath.split("/")[1];
			const state = Object.values(remote)
				.flatMap((s) => s.versions ?? [])
				.find((version) => version.id === versionId);
			return {
				data: state?.files ?? [],
			};
		}
		throw new Error(`unexpected read ${requestPath}`);
	};
}

const assetFile = (sha, algorithm = "SHA_256") => ({
	type: "backgroundAssetUploadFiles",
	id: "file-1",
	attributes: {
		assetType: "ASSET",
		fileName: "pack.aar",
		fileSize: 100,
		sourceFileChecksums: { file: { algorithm, hash: sha } },
	},
});

function plannedPack(id, archiveContent) {
	return { ...planEntry(id, archiveContent), archiveContent };
}

const noGithub = {
	findReceiptAsset: async () => null,
	downloadReceipt: async () => {
		throw new Error("unexpected");
	},
	uploadReceipt: async () => {
		throw new Error("unexpected");
	},
};

test("an app-only release reuses every pack without a single upload", async () => {
	const entries = [plannedPack("perushim-notes", "notes-archive"), plannedPack("recitation-1", "audio-archive")];
	const dir = packDir(entries);
	try {
		const remote = Object.fromEntries(
			entries.map((entry) => [
				entry.id,
				{
					pack: { type: "backgroundAssets", id: `apple-pack-${entry.id}`, attributes: { assetPackIdentifier: entry.id } },
					versions: [
						{
							id: `v-${entry.id}`,
							number: 3,
							state: "COMPLETE",
							beta: "READY_FOR_TESTING",
							files: [assetFile(entry.archiveSha256)],
						},
					],
				},
			]),
		);
		const calls = [];
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				releaseTag: "app-v9.9.9",
				repository: "o/r",
				github: {
					findReceiptAsset: async () => null,
					downloadReceipt: async () => {
						throw new Error("none");
					},
					uploadReceipt: async (repo, tag, file) => calls.push([repo, tag, file]),
				},
				exec: () => {
					throw new Error("altool must not run when everything is reused");
				},
				sleep: () => Promise.resolve(),
			},
			remoteReader(remote),
		);
		assert.equal(result.uploaded, 0);
		assert.equal(result.reused, 2);
		assert.equal(result.verified, 2);
		assert.deepEqual(calls.map((c) => c[1]), ["app-v9.9.9"]);
	} finally {
		cleanup(dir);
	}
});

test("only the changed pack uploads; identical packs are reused", async () => {
	const entries = [plannedPack("recitation-1", "same-archive"), plannedPack("recitation-2", "changed-archive")];
	const dir = packDir(entries);
	try {
		const remote = {
			"recitation-1": {
				pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
				versions: [{ id: "v1", number: 2, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(entries[0].archiveSha256)] }],
			},
			"recitation-2": {
				pack: { type: "backgroundAssets", id: "apple-pack-recitation-2", attributes: { assetPackIdentifier: "recitation-2" } },
				versions: [
					{ id: "v2", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(sha256("old-audio"))] },
				],
			},
		};
		const uploads = [];
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				repository: "o/r",
				github: noGithub,
				exec: (command, args) => {
					uploads.push(args[2]);
					// altool's commit lands a new live version carrying these bytes.
					remote["recitation-2"].versions.push({
						id: "v3",
						number: 2,
						state: "COMPLETE",
						beta: "READY_FOR_TESTING",
						files: [assetFile(entries[1].archiveSha256)],
					});
					return { status: 0, stdout: "Asset pack uploaded" };
				},
				sleep: () => Promise.resolve(),
			},
			remoteReader(remote),
		);
		assert.equal(result.uploaded, 1);
		assert.equal(result.reused, 1);
		assert.deepEqual(uploads, [path.join(dir, "recitation-2.aar")]);
	} finally {
		cleanup(dir);
	}
});

test("a fresh upload verifies by version monotonicity when Apple exposes no checksum", async () => {
	const entries = [plannedPack("recitation-1", "new-archive")];
	const dir = packDir(entries);
	try {
		const remote = {
			"recitation-1": {
				pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
				versions: [
					{ id: "v1", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [] },
				],
			},
		};
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				repository: "o/r",
				github: noGithub,
				exec: () => {
					// Our upload created a newer version; Apple reports its file
					// size but no checksum, so monotonicity + size prove delivery.
					remote["recitation-1"].versions.push({
						id: "v2",
						number: 2,
						state: "COMPLETE",
						beta: "READY_FOR_TESTING",
						files: [{ type: "backgroundAssetUploadFiles", id: "f", attributes: { assetType: "ASSET", fileSize: entries[0].archiveBytes } }],
					});
					return { status: 0, stdout: "Asset pack uploaded" };
				},
				sleep: () => Promise.resolve(),
			},
			remoteReader(remote),
		);
		assert.equal(result.uploaded, 1);
		assert.equal(result.verified, 1);
	} finally {
		cleanup(dir);
	}
});

test("a fresh upload is not verified by a foreign version with a conflicting checksum", async () => {
	const entries = [plannedPack("recitation-1", "new-archive")];
	const dir = packDir(entries);
	try {
		const remote = {
			"recitation-1": {
				pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
				versions: [
					{ id: "v1", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [] },
					// A concurrent process published foreign bytes after our
					// decision; they must never pass verification as our upload.
					{ id: "v9", number: 9, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(sha256("foreign"))] },
				],
			},
		};
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					attempts: 2,
					repository: "o/r",
					github: noGithub,
					exec: () => ({ status: 0, stdout: "Asset pack uploaded" }),
					sleep: () => Promise.resolve(),
				},
				remoteReader(remote),
			),
			/deliverable version matching the archive content/,
		);
	} finally {
		cleanup(dir);
	}
});

test("a prior interrupted upload is settled instead of duplicated", async () => {
	const entries = [plannedPack("recitation-1", "archive")];
	const dir = packDir(entries);
	try {
		const state = {
			versions: [
				{ id: "v1", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(sha256("old"))] },
				{ id: "v2", number: 2, state: "PROCESSING", beta: null, files: [assetFile(entries[0].archiveSha256)] },
			],
			pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
		};
		const remote = { "recitation-1": state };
		const completed = { v: false };
		const reader = async (requestPath, parameters) => {
			if (completed.v && requestPath.endsWith("/versions")) {
				const processing = state.versions[1];
				return remoteReader({
					"recitation-1": {
						pack: state.pack,
						versions: [
							state.versions[0],
							{ ...processing, state: "COMPLETE", beta: "READY_FOR_TESTING" },
						],
					},
				})(requestPath, parameters);
			}
			const response = await remoteReader(remote)(requestPath, parameters);
			if (requestPath.endsWith("/versions")) completed.v = true;
			return response;
		};
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				github: noGithub,
				exec: () => {
					throw new Error("must not upload again");
				},
				sleep: () => Promise.resolve(),
			},
			reader,
		);
		assert.equal(result.uploaded, 0);
		assert.equal(result.reconciled, 1);
	} finally {
		cleanup(dir);
	}
});

test("upload never runs when the restored archive differs from the verified plan", async () => {
	const entries = [plannedPack("recitation-1", "signed")];
	const dir = packDir(entries, [["recitation-1.aar", "tampered"]]);
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					github: noGithub,
					exec: () => {
						throw new Error("exec must not run");
					},
				},
				read(),
			),
			/digest does not match/,
		);
	} finally {
		cleanup(dir);
	}
});

test("a blocked pack halts the fleet before any upload", async () => {
	const entries = [plannedPack("perushim-notes", "notes"), plannedPack("recitation-1", "audio")];
	const dir = packDir(entries);
	try {
		const remote = {
			"perushim-notes": {
				pack: { type: "backgroundAssets", id: "apple-pack-perushim-notes", attributes: { assetPackIdentifier: "perushim-notes" } },
				versions: [{ id: "", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(entries[0].archiveSha256)] }],
			},
			"recitation-1": {
				pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
				versions: [{ id: "v1", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(sha256("different"))] }],
			},
		};
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					github: noGithub,
					exec: () => {
						throw new Error("altool must not run when a pack is blocked");
					},
				},
				remoteReader(remote),
			),
			/blocked.*perushim-notes/,
		);
	} finally {
		cleanup(dir);
	}
});

// ---------- #2842: receipt discovery ENOBUFS, completeness, bootstrap ----------

/**
 * Exec dispatcher exercising the REAL defaultGithub adapter: `gh api` answers
 * canned {count,tags} scan pages, `gh release download` writes a receipt file
 * into --dir, `gh release upload` is recorded, `xcrun` simulates altool.
 */
function releaseExec({
	pages = {},
	receipt = null,
	onUpload = null,
	calls = { api: [], download: [], upload: [], xcrun: [] },
}) {
	return (command, args) => {
		if (command === "xcrun") {
			calls.xcrun.push(args);
			if (onUpload) onUpload(args);
			return { status: 0, stdout: "Asset pack uploaded" };
		}
		assert.equal(command, "gh");
		if (args[0] === "api") {
			calls.api.push(args);
			const page = Number(
				new URLSearchParams(args[1].split("?")[1]).get("page"),
			);
			const scan = pages[page] ?? { count: 0, tags: [] };
			if (scan instanceof Error) throw scan;
			if (typeof scan === "object" && scan.status != null) return scan;
			return {
				status: 0,
				stdout: JSON.stringify(scan),
				stderr: scan.stderr ?? "",
			};
		}
		if (args[0] === "release" && args[1] === "download") {
			calls.download.push(args[2]);
			if (receipt != null)
				writeFileSync(
					path.join(
						args[args.indexOf("--dir") + 1],
						"asset-pack-publication.json",
					),
					receipt,
				);
			return { status: 0, stdout: "", stderr: "" };
		}
		if (args[0] === "release" && args[1] === "upload") {
			calls.upload.push(args[2]);
			return { status: 0, stdout: "", stderr: "" };
		}
		throw new Error(`unexpected gh args: ${args.join(" ")}`);
	};
}

function unverifiableRemote(id) {
	return {
		[id]: {
			pack: {
				type: "backgroundAssets",
				id: `apple-pack-${id}`,
				attributes: { assetPackIdentifier: id },
			},
			versions: [
				{
					id: "v-live",
					number: 26,
					state: "COMPLETE",
					beta: "READY_FOR_TESTING",
					files: [assetFile(sha256(`${id}-foreign-archive`))],
				},
			],
		},
	};
}

test("receipt discovery queries only tag names via gh api --jq (bounded stdout)", async () => {
	const entries = [plannedPack("recitation-1", "audio-archive")];
	const dir = packDir(entries);
	const calls = { api: [], download: [], upload: [], xcrun: [] };
	const remote = unverifiableRemote("recitation-1");
	try {
		await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				repository: "o/r",
				exec: releaseExec({
					pages: { 1: { count: 3, tags: [] } },
					calls,
					onUpload: () => {
						remote["recitation-1"].versions.push({
							id: "v-new",
							number: 27,
							state: "COMPLETE",
							beta: "READY_FOR_TESTING",
							files: [assetFile(entries[0].archiveSha256)],
						});
					},
				}),
				sleep: () => Promise.resolve(),
			},
			remoteReader(remote),
		);
		const jq = calls.api[0].indexOf("--jq");
		assert.notEqual(jq, -1);
		assert.match(calls.api[0][jq + 1], /index\("asset-pack-publication\.json"\)/);
	} finally {
		cleanup(dir);
	}
});

// The failing run's signature: spawnSync gh ENOBUFS killed the receipt read;
// the fleet then decided upload for every pack. Unverifiable content must
// block instead of publishing on missing evidence.
test("an ENOBUFS receipt failure blocks unverifiable packs instead of uploading", async () => {
	const entries = [plannedPack("perushim-notes", "notes-archive")];
	const dir = packDir(entries);
	const calls = { api: [], download: [], upload: [], xcrun: [] };
	const warnings = [];
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					repository: "o/r",
					exec: releaseExec({
						pages: { 1: new Error("spawnSync gh ENOBUFS") },
						calls,
					}),
					report: (line) => warnings.push(line),
					sleep: () => Promise.resolve(),
				},
				remoteReader(unverifiableRemote("perushim-notes")),
			),
			/blocked.*perushim-notes.*unverifiable/s,
		);
		assert.equal(calls.xcrun.length, 0);
		assert.equal(calls.upload.length, 0);
		assert.ok(warnings.some((line) => /receipt unavailable.*ENOBUFS/.test(line)));
	} finally {
		cleanup(dir);
	}
});

test("a completed empty receipt search is an explicit bootstrap that may upload", async () => {
	const entries = [plannedPack("recitation-1", "audio-archive")];
	const dir = packDir(entries);
	const calls = { api: [], download: [], upload: [], xcrun: [] };
	const remote = unverifiableRemote("recitation-1");
	const lines = [];
	try {
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				releaseTag: "app-v5.0.225",
				repository: "o/r",
				exec: releaseExec({
					pages: { 1: { count: 2, tags: [] } },
					calls,
					onUpload: () => {
						remote["recitation-1"].versions.push({
							id: "v-new",
							number: 27,
							state: "COMPLETE",
							beta: "READY_FOR_TESTING",
							files: [assetFile(entries[0].archiveSha256)],
						});
					},
				}),
				report: (line) => lines.push(line),
				sleep: () => Promise.resolve(),
			},
			remoteReader(remote),
		);
		assert.equal(result.uploaded, 1);
		assert.deepEqual(calls.upload, ["app-v5.0.225"]);
		assert.ok(lines.some((line) => /bootstrap/.test(line)));
	} finally {
		cleanup(dir);
	}
});

test("receipt discovery follows pages until history ends and stderr never corrupts stdout", async () => {
	const entries = [plannedPack("perushim-notes", "notes-archive")];
	const dir = packDir(entries);
	const calls = { api: [], download: [], upload: [], xcrun: [] };
	// The remote archive checksum differs from the rebuilt archive; only the
	// downloaded receipt tie may prove reuse.
	const remote = unverifiableRemote("perushim-notes");
	remote["perushim-notes"].versions[0].files = [
		assetFile(sha256("original-archive")),
	];
	const receipt = JSON.stringify({
		version: 1,
		packs: {
			"perushim-notes": {
				versionId: "v-live",
				contentSha256: entries[0].contentSha256,
				archiveSha256: sha256("original-archive"),
			},
		},
	});
	try {
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials,
				releaseTag: "app-v5.0.225",
				repository: "o/r",
				exec: releaseExec({
					pages: {
						1: { count: 100, tags: [], stderr: "warning: noisy" },
						2: { count: 100, tags: ["app-v5.0.224"] },
					},
					receipt,
					calls,
				}),
				sleep: () => Promise.resolve(),
			},
			remoteReader(remote),
		);
		assert.equal(result.reused, 1);
		assert.equal(calls.xcrun.length, 0);
		assert.equal(calls.api.length, 2);
		assert.deepEqual(calls.download, ["app-v5.0.224"]);
	} finally {
		cleanup(dir);
	}
});

test("an incomplete receipt search is unavailable evidence, not an absent receipt", async () => {
	const entries = [plannedPack("recitation-1", "audio-archive")];
	const dir = packDir(entries);
	const calls = { api: [], download: [], upload: [], xcrun: [] };
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					repository: "o/r",
					exec: releaseExec({
						// Every page full, never a receipt: the search gives up
						// explicitly rather than pretending history ended.
						pages: new Proxy(
							{},
							{ get: () => ({ count: 100, tags: [] }) },
						),
						calls,
					}),
					sleep: () => Promise.resolve(),
				},
				remoteReader(unverifiableRemote("recitation-1")),
			),
			/blocked.*recitation-1/s,
		);
		assert.equal(calls.api.length, 25);
		assert.equal(calls.xcrun.length, 0);
	} finally {
		cleanup(dir);
	}
});

test("a malformed or undownloadable receipt blocks unverifiable packs", async () => {
	for (const receipt of ["{not json", JSON.stringify({ version: 2 })]) {
		const entries = [plannedPack("recitation-1", "audio-archive")];
		const dir = packDir(entries);
		const calls = { api: [], download: [], upload: [], xcrun: [] };
		try {
			await assert.rejects(
				uploadAssetPacks(
					{
						directory: dir,
						bundle: "com.tanah.daily929",
						credentials,
						repository: "o/r",
						exec: releaseExec({
							pages: { 1: { count: 5, tags: ["app-v5.0.224"] } },
							receipt,
							calls,
						}),
						sleep: () => Promise.resolve(),
					},
					remoteReader(unverifiableRemote("recitation-1")),
				),
				/blocked/,
			);
			assert.equal(calls.xcrun.length, 0);
		} finally {
			cleanup(dir);
		}
	}
});

test("a transient gh failure retries; a checksum-proven pack still reuses when the receipt is unavailable", async () => {
	const entries = [
		plannedPack("recitation-1", "audio-archive"),
		plannedPack("recitation-2", "other-archive"),
	];
	const dir = packDir(entries);
	const calls = { api: [], download: [], upload: [], xcrun: [] };
	const remote = {
		"recitation-1": {
			pack: {
				type: "backgroundAssets",
				id: "apple-pack-recitation-1",
				attributes: { assetPackIdentifier: "recitation-1" },
			},
			versions: [
				{
					id: "v-live",
					number: 26,
					state: "COMPLETE",
					beta: "READY_FOR_TESTING",
					files: [assetFile(entries[0].archiveSha256)],
				},
			],
		},
		...unverifiableRemote("recitation-2"),
	};
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					repository: "o/r",
					githubPolicy: { retryDelayMs: 0 },
					exec: releaseExec({
						pages: {
							// Transient transport failures are retried; HTTP 5xx matches
							// gh-api.mjs's transient pattern as well.
							1: new Error("dial tcp 10.0.0.1: i/o timeout"),
						},
						calls,
					}),
					sleep: () => Promise.resolve(),
				},
				remoteReader(remote),
			),
			/blocked.*recitation-2/s,
		);
		// Page 1 kept timing out: withApiRetries retried then gave up.
		assert.equal(calls.api.length, 3);
		assert.equal(calls.xcrun.length, 0);
	} finally {
		cleanup(dir);
	}
});

// ---------- #2842: a failed planning read never reaches the upload loop ----------

test("a remote read failure during planning runs no uploads", async () => {
	const entries = [plannedPack("perushim-notes", "notes"), plannedPack("recitation-1", "audio")];
	const dir = packDir(entries);
	const calls = { xcrun: [] };
	let versionsReads = 0;
	const base = remoteReader({
		"perushim-notes": unverifiableRemote("perushim-notes")["perushim-notes"],
		"recitation-1": unverifiableRemote("recitation-1")["recitation-1"],
	});
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					repository: "o/r",
					github: noGithub,
					exec: (command) => {
						if (command === "xcrun") calls.xcrun.push(command);
						return { status: 0, stdout: "" };
					},
					sleep: () => Promise.resolve(),
				},
				async (requestPath, parameters) => {
					if (requestPath.endsWith("/versions") && ++versionsReads === 2)
						throw new DOMException(
							"The operation was aborted due to timeout",
							"TimeoutError",
						);
					return base(requestPath, parameters);
				},
			),
			/aborted due to timeout/,
		);
		assert.equal(calls.xcrun.length, 0);
	} finally {
		cleanup(dir);
	}
});

// ---------- #2842: fresh-upload provenance ----------

test("a fresh upload is not verified when a concurrent producer added an unattributed version", async () => {
	const entries = [plannedPack("recitation-1", "new-archive")];
	const dir = packDir(entries);
	const remote = {
		"recitation-1": {
			pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
			versions: [
				{ id: "v1", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(sha256("old"))] },
			],
		},
	};
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					attempts: 2,
					repository: "o/r",
					github: noGithub,
					exec: () => {
						// Our upload landed as v2 — but a concurrent producer pushed
						// v3 in the same window. Both lack checksums; size alone
						// cannot prove which version carries our bytes.
						const assetOnly = (id) => ({
							id,
							state: "COMPLETE",
							beta: "READY_FOR_TESTING",
							files: [
								{
									type: "backgroundAssetUploadFiles",
									id: `f-${id}`,
									attributes: { assetType: "ASSET", fileSize: entries[0].archiveBytes },
								},
							],
						});
						remote["recitation-1"].versions.push(
							{ ...assetOnly("v2"), number: 2 },
							{ ...assetOnly("v3"), number: 3 },
						);
						return { status: 0, stdout: "Asset pack uploaded" };
					},
					sleep: () => Promise.resolve(),
				},
				remoteReader(remote),
			),
			/deliverable version matching the archive content/,
		);
	} finally {
		cleanup(dir);
	}
});

// ---------- #2842: read retry through the real appleReader ----------

test("a transient timeout on the versions read retries instead of killing planning", async () => {
	const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const entries = [plannedPack("perushim-notes", "notes-archive")];
	const dir = packDir(entries);
	const remote = unverifiableRemote("perushim-notes");
	// Checksum-proof reuse: the live version carries our exact archive.
	remote["perushim-notes"].versions[0].files = [
		assetFile(entries[0].archiveSha256),
	];
	let versionsCalls = 0;
	const dispatch = remoteReader(remote);
	const fetcher = async (url) => {
		const requestPath = url.pathname.replace(/^\/v1\//, "");
		const parameters = Object.fromEntries(url.searchParams);
		if (requestPath.endsWith("/versions") && ++versionsCalls === 1)
			throw new DOMException(
				"The operation was aborted due to timeout",
				"TimeoutError",
			);
		return {
			ok: true,
			status: 200,
			json: async () => dispatch(requestPath, parameters),
		};
	};
	try {
		const result = await uploadAssetPacks(
			{
				directory: dir,
				bundle: "com.tanah.daily929",
				credentials: {
					key_id: "TESTKEY",
					issuer_id: "test-issuer",
					key: privateKey.export({ type: "pkcs8", format: "pem" }),
				},
				repository: "o/r",
				github: noGithub,
				fetcher,
				readPolicy: {
					sleep: () => Promise.resolve(),
					random: () => 0,
					report: () => {},
				},
				exec: () => {
					throw new Error("altool must not run for a reused pack");
				},
				sleep: () => Promise.resolve(),
			},
		);
		assert.equal(result.reused, 1);
		// Plan read (1 failure + 1 retry) plus the deliverable verify read.
		assert.equal(versionsCalls, 3);
	} finally {
		cleanup(dir);
	}
});

test("a fresh upload is not verified when Apple reports no checksum and no file size", async () => {
	const entries = [plannedPack("recitation-1", "new-archive")];
	const dir = packDir(entries);
	const remote = {
		"recitation-1": {
			pack: { type: "backgroundAssets", id: "apple-pack-recitation-1", attributes: { assetPackIdentifier: "recitation-1" } },
			versions: [
				{ id: "v1", number: 1, state: "COMPLETE", beta: "READY_FOR_TESTING", files: [assetFile(sha256("old"))] },
			],
		},
	};
	try {
		await assert.rejects(
			uploadAssetPacks(
				{
					directory: dir,
					bundle: "com.tanah.daily929",
					credentials,
					attempts: 2,
					repository: "o/r",
					github: noGithub,
					exec: () => {
						remote["recitation-1"].versions.push({
							id: "v2",
							number: 2,
							state: "COMPLETE",
							beta: "READY_FOR_TESTING",
							files: [],
						});
						return { status: 0, stdout: "Asset pack uploaded" };
					},
					sleep: () => Promise.resolve(),
				},
				remoteReader(remote),
			),
			/deliverable version matching the archive content/,
		);
	} finally {
		cleanup(dir);
	}
});
