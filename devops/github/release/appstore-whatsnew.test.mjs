import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	EDITABLE_STATES,
	editableVersion,
	inspectLiveVersions,
	liveVersion,
	main,
	publicStoreVersion,
	publishWhatsNew,
} from "./appstore-whatsnew.mjs";

const notes = "• אפשר ללמוד פרק חדש בקלות רבה.";

// --- liveVersion ---

const versionData = (version, id = "v1", state = "READY_FOR_SALE") => ({
	id,
	attributes: { versionString: version, platform: "IOS", appStoreState: state },
});

test("liveVersion returns the single ready-for-sale iOS version", async () => {
	const read = async (pathName, params) => {
		assert.equal(
			params["filter[appVersionState]"],
			"READY_FOR_DISTRIBUTION",
		);
		assert.equal(params["filter[platform]"], "IOS");
		return { data: [versionData("5.1.7")] };
	};
	assert.equal(await liveVersion("app1", read), "5.1.7");
});

test("liveVersion reports null before any public release and rejects ambiguity", async () => {
	assert.equal(await liveVersion("app1", async () => ({ data: [] })), null);
	await assert.rejects(
		liveVersion("app1", async () => ({
			data: [versionData("5.1.7", "a"), versionData("5.1.8", "b")],
		})),
		/more than one live/i,
	);
	await assert.rejects(
		liveVersion("app1", async () => ({
			data: [versionData("not-a-version")],
		})),
		/not semver/,
	);
});

// --- editableVersion ---

test("editableVersion matches the exact version only in an editable state", async () => {
	const read = async (_pathName, params) => {
		assert.equal(params["filter[versionString]"], "5.1.8");
		return {
			data: [
				versionData("5.1.8", "vid", "PREPARE_FOR_SUBMISSION"),
				versionData("5.1.7", "old", "READY_FOR_SALE"),
			],
		};
	};
	const found = await editableVersion("app1", "5.1.8", read);
	assert.deepEqual(found, { id: "vid", state: "PREPARE_FOR_SUBMISSION" });
});

test("editableVersion refuses live, submitted and absent records", async () => {
	for (const state of [
		"READY_FOR_SALE",
		"WAITING_FOR_REVIEW",
		"IN_REVIEW",
		"PROCESSING_FOR_APP_STORE",
	]) {
		const found = await editableVersion("app1", "5.1.8", async () => ({
			data: [versionData("5.1.8", "vid", state)],
		}));
		assert.deepEqual(found, { id: null, state }, state);
	}
	assert.equal(
		await editableVersion("app1", "5.1.8", async () => ({ data: [] })),
		null,
	);
	await assert.rejects(
		editableVersion("app1", "5.1.8", async () => ({
			data: [
				versionData("5.1.8", "a", "PREPARE_FOR_SUBMISSION"),
				versionData("5.1.8", "b", "PREPARE_FOR_SUBMISSION"),
			],
		})),
		/ambiguous/i,
	);
	assert.ok(EDITABLE_STATES.includes("PREPARE_FOR_SUBMISSION"));
});

// --- publishWhatsNew ---

const localization = (id, locale = "he", whatsNew = "old") => ({
	id,
	attributes: { locale, whatsNew },
});

test("publishWhatsNew patches the existing hebrew localization and verifies readback", async () => {
	const calls = [];
	let patched = false;
	const read = async (pathName) => {
		calls.push(["read", pathName]);
		assert.ok(pathName.startsWith("appStoreVersions/"));
		return { data: [localization("loc1", "he", patched ? notes : "old")] };
	};
	const write = async (pathName, { method, body }) => {
		calls.push([method, pathName, body]);
		if (method === "PATCH") patched = true;
		return { data: localization("loc1") };
	};
	const result = await publishWhatsNew({
		versionId: "vid",
		notes,
		read,
		write,
	});
	const patch = calls.find((c) => c[0] === "PATCH");
	assert.ok(patch, "expected a PATCH call");
	assert.equal(patch[1], "appStoreVersionLocalizations/loc1");
	assert.equal(patch[2].data.attributes.whatsNew, notes);
	assert.equal(result.verified, true);
	assert.equal(result.localizationId, "loc1");
});

test("publishWhatsNew creates the hebrew localization when missing", async () => {
	const calls = [];
	let created = false;
	const read = async () => ({
		data: created
			? [localization("loc9", "he", notes)]
			: [localization("enUS", "en-US")],
	});
	const write = async (pathName, { method, body }) => {
		calls.push([method, pathName, body]);
		if (method === "POST") created = true;
		return { data: { id: "loc9" } };
	};
	const result = await publishWhatsNew({ versionId: "vid", notes, read, write });
	const post = calls.find((c) => c[0] === "POST");
	assert.ok(post, "expected a POST call");
	assert.equal(post[2].data.attributes.locale, "he");
	assert.equal(
		post[2].data.relationships.appStoreVersion.data.id,
		"vid",
	);
	assert.equal(result.localizationId, "loc9");
});

test("publishWhatsNew proves the accepted text instead of trusting the write", async () => {
	const read = async () => ({
		data: [localization("loc1", "he", "different text")],
	});
	await assert.rejects(
		publishWhatsNew({
			versionId: "vid",
			notes,
			read,
			write: async () => ({ data: {} }),
		}),
		/did not accept the exact whatsNew/,
	);
});

test("publishWhatsNew enforces the Apple whatsNew limit", async () => {
	await assert.rejects(
		publishWhatsNew({
			versionId: "vid",
			notes: "א".repeat(4001),
			read: async () => ({ data: [] }),
			write: async () => ({}),
		}),
		/4000/,
	);
});

const modernVersion = (version, state, overrides = {}) => ({
	id: version,
	attributes: {
		versionString: version,
		platform: "IOS",
		appVersionState: state,
		...overrides,
	},
});

test("liveVersion validates modern response states instead of trusting a server filter", async () => {
	const records = [
		modernVersion("5.1.7", "REPLACED_WITH_NEW_VERSION", {
			appStoreState: "READY_FOR_SALE",
		}),
		modernVersion("5.1.8", "READY_FOR_DISTRIBUTION"),
		modernVersion("5.1.9", "PREPARE_FOR_SUBMISSION"),
		modernVersion("8.0.0", "READY_FOR_DISTRIBUTION", { platform: "MAC_OS" }),
	];
	assert.equal(
		await liveVersion("app1", async () => ({ data: records })),
		"5.1.8",
	);
});

test("liveVersion excludes non-live and unknown states while preserving genuine ambiguity", async () => {
	for (const state of [
		"REPLACED_WITH_NEW_VERSION",
		"PREPARE_FOR_SUBMISSION",
		"UNKNOWN_FUTURE_STATE",
	]) {
		assert.equal(
			await liveVersion("app1", async () => ({
				data: [modernVersion("5.1.8", state)],
			})),
			null,
			state,
		);
	}
	await assert.rejects(
		liveVersion("app1", async () => ({
			data: [
				modernVersion("5.1.8", "READY_FOR_DISTRIBUTION"),
				modernVersion("5.1.9", "READY_FOR_DISTRIBUTION"),
			],
		})),
		/more than one live/i,
	);
});

test("editableVersion uses the current iOS state when legacy state disagrees", async () => {
	const read = async () => ({
		data: [
			modernVersion("5.1.8", "PREPARE_FOR_SUBMISSION", { platform: "MAC_OS" }),
			modernVersion("5.1.8", "READY_FOR_DISTRIBUTION", {
				appStoreState: "PREPARE_FOR_SUBMISSION",
			}),
		],
	});
	assert.deepEqual(await editableVersion("app1", "5.1.8", read), {
		id: null,
		state: "READY_FOR_DISTRIBUTION",
	});
	assert.deepEqual(
		await editableVersion("app1", "5.1.8", async () => ({
			data: [modernVersion("5.1.8", "PREPARE_FOR_SUBMISSION")],
		})),
		{ id: "5.1.8", state: "PREPARE_FOR_SUBMISSION" },
	);
});

// --- #3610: multi-record resolution beyond synthetic rows ---

/**
 * The sanitized shape of the real 5.1.23 failure (run 44034434746): the
 * legacy-state query returned more than one record. A superseded version can
 * retain a stale legacy live flag, and the same live version can appear on
 * more than one record — so no single record can prove the public baseline.
 */
const realWorldRecords = [
	{
		id: "rec-superseded",
		attributes: {
			versionString: "5.1.22",
			platform: "IOS",
			appVersionState: "REPLACED_WITH_NEW_VERSION",
			appStoreState: "READY_FOR_SALE",
		},
	},
	{
		id: "rec-live-a",
		attributes: {
			versionString: "5.1.23",
			platform: "IOS",
			appVersionState: "READY_FOR_DISTRIBUTION",
			appStoreState: "READY_FOR_SALE",
		},
	},
	{
		id: "rec-live-b",
		attributes: {
			versionString: "5.1.23",
			platform: "IOS",
			appVersionState: "READY_FOR_DISTRIBUTION",
		},
	},
	{
		id: "rec-mac",
		attributes: {
			versionString: "8.0.0",
			platform: "MAC_OS",
			appVersionState: "READY_FOR_DISTRIBUTION",
		},
	},
	{
		id: "rec-draft",
		attributes: {
			versionString: "5.1.24",
			platform: "IOS",
			appVersionState: "PREPARE_FOR_SUBMISSION",
			appStoreState: "READY_FOR_SALE",
		},
	},
];

test("liveVersion collapses the real duplicate live records into one baseline", async () => {
	// The real response carries two live records reporting the same version —
	// they describe one baseline, so they collapse to it and no public
	// storefront lookup is needed at all.
	const read = async () => ({ data: realWorldRecords });
	assert.equal(await liveVersion("app1", read), "5.1.23");
	assert.equal(
		await liveVersion("app1", read, async () => {
			throw new Error("lookup must not run for a single-version baseline");
		}),
		"5.1.23",
	);
});

test("liveVersion binds the baseline to the public storefront version among distinct live records", async () => {
	const read = async () => ({
		data: [
			modernVersion("5.1.22", "READY_FOR_DISTRIBUTION"),
			modernVersion("5.1.23", "READY_FOR_DISTRIBUTION"),
		],
	});
	assert.equal(
		await liveVersion("app1", read, async () => "5.1.23"),
		"5.1.23",
	);
	await assert.rejects(
		liveVersion("app1", read, async () => "5.1.24"),
		/does not match a live iOS App Store record/i,
	);
});

test("liveVersion refuses unclassifiable rows instead of silently skipping them", async () => {
	const live = modernVersion("5.1.23", "READY_FOR_DISTRIBUTION");
	for (const [label, broken] of [
		["missing version", { id: "u1", attributes: { platform: "IOS", appVersionState: "READY_FOR_DISTRIBUTION" } }],
		["missing platform", { id: "u2", attributes: { versionString: "5.1.23", appVersionState: "READY_FOR_DISTRIBUTION" } }],
		["missing state", { id: "u3", attributes: { versionString: "5.1.23", platform: "IOS" } }],
		["missing identity", { attributes: { versionString: "5.1.23", platform: "IOS", appVersionState: "READY_FOR_DISTRIBUTION" } }],
	]) {
		await assert.rejects(
			liveVersion("app1", async () => ({ data: [live, broken] })),
			/cannot be classified/,
			label,
		);
	}
	// A row proven non-iOS is still safely ignored rather than unverifiable.
	assert.equal(
		await liveVersion("app1", async () => ({
			data: [live, { id: "mac", attributes: { platform: "MAC_OS" } }],
		})),
		"5.1.23",
	);
});

test("liveVersion ambiguity names the conflicting candidates and the corrective action", async () => {
	const error = await liveVersion("app1", async () => ({
		data: [
			modernVersion("5.1.22", "READY_FOR_DISTRIBUTION"),
			modernVersion("5.1.23", "READY_FOR_DISTRIBUTION"),
		],
	})).then(
		() => assert.fail("expected an ambiguity rejection"),
		(e) => e,
	);
	assert.match(error.message, /more than one live iOS App Store version/i);
	assert.match(error.message, /5\.1\.22/);
	assert.match(error.message, /5\.1\.23/);
	assert.match(error.message, /App Store Connect/);
});

test("liveVersion refuses truncated or paginated responses instead of guessing", async () => {
	await assert.rejects(
		liveVersion("app1", async () => ({
			data: [versionData("5.1.7")],
			links: { next: "https://api.appstoreconnect.apple.com/v1/cursor" },
		})),
		/incomplete/i,
	);
	await assert.rejects(
		liveVersion("app1", async () => ({
			data: [versionData("5.1.7")],
			meta: { paging: { total: 2 } },
		})),
		/incomplete/i,
	);
	await assert.rejects(
		liveVersion("app1", async () => ({ data: "nope" })),
		/malformed/i,
	);
});

test("editableVersion refuses paginated and unclassifiable responses", async () => {
	await assert.rejects(
		editableVersion("app1", "5.1.8", async () => ({
			data: [versionData("5.1.8", "vid", "PREPARE_FOR_SUBMISSION")],
			links: { next: "https://api.appstoreconnect.apple.com/v1/cursor" },
		})),
		/incomplete/i,
	);
	await assert.rejects(
		editableVersion("app1", "5.1.8", async () => ({
			data: [
				versionData("5.1.8", "vid", "PREPARE_FOR_SUBMISSION"),
				{ attributes: { versionString: "5.1.8" } },
			],
		})),
		/cannot be classified/i,
	);
	// A row proven different on either axis is still safely ignored.
	assert.equal(
		await editableVersion("app1", "5.1.8", async () => ({
			data: [
				versionData("5.1.8", "vid", "PREPARE_FOR_SUBMISSION"),
				{ id: "ghost", attributes: { platform: "IOS", versionString: "5.1.7" } },
			],
		})).then((v) => v.id),
		"vid",
	);
});

test("publishWhatsNew refuses a truncated localization list instead of writing blind", async () => {
	const writes = [];
	await assert.rejects(
		publishWhatsNew({
			versionId: "vid",
			notes,
			read: async () => ({
				data: [],
				links: { next: "https://api.appstoreconnect.apple.com/v1/cursor" },
			}),
			write: async (pathName, options) => {
				writes.push(pathName);
				return { data: { id: "loc1" } };
			},
		}),
		/incomplete/i,
	);
	assert.equal(writes.length, 0, "no write may happen on unverifiable state");
});

test("public version inspection preserves the exact queried identities without choosing an ambiguous baseline", async () => {
	let calls = 0;
	const records = [
		modernVersion("5.1.8", "READY_FOR_DISTRIBUTION", {
			appStoreState: "READY_FOR_SALE",
			copyright: "not retained",
		}),
		modernVersion("5.1.9", "READY_FOR_DISTRIBUTION"),
		modernVersion("8.0.0", "READY_FOR_DISTRIBUTION", { platform: "MAC_OS" }),
	];
	const snapshot = await inspectLiveVersions(
		"app/1",
		async (endpoint, parameters) => {
			calls++;
			assert.equal(endpoint, "apps/app%2F1/appStoreVersions");
			assert.deepEqual(parameters, {
				"filter[appVersionState]": "READY_FOR_DISTRIBUTION",
				"filter[platform]": "IOS",
				limit: "200",
			});
			return { data: records, included: [{ private: "not retained" }] };
		},
	);
	assert.equal(calls, 1);
	assert.equal(snapshot.appId, "app/1");
	assert.equal(snapshot.publicBaseline, null);
	assert.match(snapshot.error, /more than one live/i);
	assert.deepEqual(snapshot.records[0], {
		id: "5.1.8",
		version: "5.1.8",
		platform: "IOS",
		appVersionState: "READY_FOR_DISTRIBUTION",
		appStoreState: "READY_FOR_SALE",
	});
	assert.equal(snapshot.records.length, 3);
	assert.doesNotMatch(JSON.stringify(snapshot), /not retained/);
});

test("public inspection retains legacy, absent, replaced and malformed-version states while preserving publication selection", async () => {
	for (const [records, baseline, expectedError] of [
		[[versionData("5.1.8")], "5.1.8", null],
		[[modernVersion("5.1.8", "READY_FOR_DISTRIBUTION")], "5.1.8", null],
		[[{ id: "absent" }], null, /cannot be classified/],
		[
			[
				modernVersion("5.1.7", "REPLACED_WITH_NEW_VERSION", {
					appStoreState: "READY_FOR_SALE",
				}),
			],
			null,
			null,
		],
		[[modernVersion("invalid", "READY_FOR_DISTRIBUTION")], null, /not semver/],
		[[], null, null],
	]) {
		const snapshot = await inspectLiveVersions("app1", async () => ({
			data: records,
		}));
		assert.equal(snapshot.publicBaseline, baseline);
		if (expectedError) assert.match(snapshot.error, expectedError);
		else assert.equal(snapshot.error, null);
		assert.equal(snapshot.records.length, records.length);
		if (records[0]?.id === "absent")
			assert.deepEqual(snapshot.records[0], {
				id: "absent",
				version: null,
				platform: null,
				appVersionState: null,
				appStoreState: null,
			});
	}
	await assert.rejects(
		inspectLiveVersions("app1", async () => {
			throw new Error("read failed");
		}),
		/read failed/,
	);
});

test("inspection CLI uses only authenticated Apple GETs and persists the same unambiguous diagnostic record", (t) => {
	const directory = mkdtempSync(
		path.join(tmpdir(), "apple-public-inspection-"),
	);
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const preload = path.join(directory, "fetch-fixture.mjs");
	writeFileSync(
		preload,
		`
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const calls = [];
process.on("exit", () => writeFileSync(process.env.INSPECTION_CALLS, JSON.stringify(calls)));
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
  assert.equal(options.method ?? "GET", "GET");
  assert.match(options.headers.Authorization, /^Bearer /);
  calls.push({path: url.pathname, query: Object.fromEntries(url.searchParams)});
  if (url.pathname === "/v1/apps") return {ok:true, json:async () => ({data:[{id:"app1",attributes:{bundleId:"com.tanah.daily929"}}]})};
  assert.equal(url.pathname, "/v1/apps/app1/appStoreVersions");
  return {ok:true, json:async () => ({data:[{id:"v1",attributes:{versionString:"5.1.8",platform:"IOS",appVersionState:"READY_FOR_DISTRIBUTION"}}]})};
};
`,
	);
	const { privateKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const output = path.join(directory, "literal output $value");
	const callsPath = path.join(directory, "calls.json");
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			pathToFileURL(preload).href,
			fileURLToPath(new URL("./appstore-whatsnew.mjs", import.meta.url)),
			"inspect",
			"--out-dir",
			output,
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				GITHUB_REPOSITORY: "",
				API_KEY_PATH: "",
				API_KEY_ID: "synthetic",
				API_ISSUER_ID: "synthetic",
				API_KEY_BASE64: Buffer.from(
					privateKey.export({ type: "pkcs8", format: "pem" }),
				).toString("base64"),
				INSPECTION_CALLS: callsPath,
			},
		},
	);
	assert.equal(result.status, 0, result.stderr);
	const saved = JSON.parse(
		readFileSync(
			path.join(output, "app-store-public-version-inspection.json"),
			"utf8",
		),
	);
	assert.deepEqual(saved, JSON.parse(result.stdout));
	assert.equal(saved.publicBaseline, "5.1.8");
	assert.equal(saved.error, null);
	assert.equal(saved.kind, "app-store-public-version-inspection/1");
	const calls = JSON.parse(readFileSync(callsPath, "utf8"));
	assert.equal(calls.length, 2);
	assert.equal(calls[0].query["filter[bundleId]"], "com.tanah.daily929");
	assert.equal(
		calls[1].query["filter[appVersionState]"],
		"READY_FOR_DISTRIBUTION",
	);
	assert.doesNotMatch(JSON.stringify(saved), /Bearer|PRIVATE KEY|synthetic/);
});

test("inspection CLI validates its command and output before reading Apple credentials", () => {
	const script = fileURLToPath(
		new URL("./appstore-whatsnew.mjs", import.meta.url),
	);
	for (const [args, message] of [
		[[], /Usage:/],
		[["unsupported"], /Usage:/],
		[["inspect"], /--out-dir is required/],
		[["publish"], /--version is required/],
	]) {
		const result = spawnSync(process.execPath, [script, ...args], {
			encoding: "utf8",
			env: { ...process.env, API_KEY_PATH: "must-not-be-read" },
		});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, message);
		assert.doesNotMatch(result.stderr, /ENOENT|credentials are incomplete/);
	}
});

test("inspection entrypoint reads the guarded app once and returns before any publication path", async (t) => {
	const directory = mkdtempSync(
		path.join(tmpdir(), "apple-public-entrypoint-"),
	);
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const originalArguments = process.argv;
	const originalKeyPath = process.env.API_KEY_PATH;
	const originalRepository = process.env.GITHUB_REPOSITORY;
	const originalGithubOutput = process.env.GITHUB_OUTPUT;
	t.after(() => {
		process.argv = originalArguments;
		if (originalKeyPath === undefined) delete process.env.API_KEY_PATH;
		else process.env.API_KEY_PATH = originalKeyPath;
		if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY;
		else process.env.GITHUB_REPOSITORY = originalRepository;
		if (originalGithubOutput === undefined) delete process.env.GITHUB_OUTPUT;
		else process.env.GITHUB_OUTPUT = originalGithubOutput;
	});
	const keyPath = path.join(directory, "synthetic-key.json");
	const { privateKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	writeFileSync(
		keyPath,
		JSON.stringify({
			key_id: "synthetic",
			issuer_id: "synthetic",
			key: privateKey.export({ type: "pkcs8", format: "pem" }),
		}),
	);
	process.env.API_KEY_PATH = keyPath;
	process.env.GITHUB_OUTPUT = "";
	const requests = [];
	t.mock.method(globalThis, "fetch", async (input, options) => {
		const url = new URL(input);
		requests.push(url.href);
		assert.equal(options.method ?? "GET", "GET");
		if (url.origin === "https://itunes.apple.com") {
			assert.equal(url.pathname, "/lookup");
			assert.equal(url.searchParams.get("id"), "1045128150");
			assert.equal(url.searchParams.get("country"), "il");
			assert.equal(options.headers, undefined);
			return { ok: true, json: async () => publicAppleResult("5.1.15") };
		}
		assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
		assert.match(options.headers.Authorization, /^Bearer /);
		const data =
			url.pathname === "/v1/apps"
				? [{ id: "1045128150", attributes: { bundleId: "com.tanah.daily929" } }]
				: ["5.1.15", "5.0.217", "5.0.34", "5.0.33", "4.0.2"].map((version) =>
						modernVersion(version, "READY_FOR_DISTRIBUTION"),
					);
		return { ok: true, json: async () => ({ data }) };
	});
	const output = [];
	t.mock.method(console, "log", (value) => output.push(value));
	const errors = [];
	t.mock.method(console, "error", (value) => errors.push(value));
	process.argv = [
		process.execPath,
		"appstore-whatsnew.mjs",
		"inspect",
		"--out-dir",
		directory,
	];
	await main();
	assert.deepEqual(
		requests.map((value) => new URL(value).pathname),
		["/v1/apps", "/v1/apps/1045128150/appStoreVersions", "/lookup"],
	);
	assert.equal(JSON.parse(output[0]).publicBaseline, "5.1.15");
	assert.equal(JSON.parse(output[0]).publicLookupVersion, "5.1.15");
	assert.deepEqual(
		JSON.parse(
			readFileSync(
				path.join(directory, "app-store-public-version-inspection.json"),
				"utf8",
			),
		),
		JSON.parse(output[0]),
	);
	for (const [args, message] of [
		[[], /Usage:/],
		[["unsupported"], /Usage:/],
		[["inspect"], /--out-dir is required/],
		[["publish"], /--version is required/],
	]) {
		process.argv = [process.execPath, "appstore-whatsnew.mjs", ...args];
		await assert.rejects(main(), message);
	}
	process.env.GITHUB_REPOSITORY = "";
	process.argv = [
		process.execPath,
		"appstore-whatsnew.mjs",
		"publish",
		"--version",
		"5.1.9",
		"--tag",
		"app-v5.1.9",
		"--out-dir",
		directory,
	];
	await assert.rejects(main(), /GITHUB_REPOSITORY is required/);
	assert.equal(requests.length, 3);
	process.env.GITHUB_REPOSITORY = "bible-on-site/bible-on-site";
	process.argv = [
		process.execPath,
		"appstore-whatsnew.mjs",
		"publish",
		"--version",
		"not-version",
		"--tag",
		"app-vnot-version",
		"--out-dir",
		directory,
	];
	await main();
	const publication = JSON.parse(
		readFileSync(path.join(directory, "release-notes-manifest.json"), "utf8"),
	);
	assert.equal(publication.publicBaseline, "5.1.15");
	assert.equal(publication.publication.attempted, false);
	assert.match(publication.publication.error, /Invalid release version/);
	assert.equal(requests.length, 6);
	assert.equal(errors.length, 1);
});

function publicAppleResult(version, overrides = {}) {
	return {
		resultCount: 1,
		results: [
			{
				trackId: 1045128150,
				bundleId: "com.tanah.daily929",
				kind: "software",
				wrapperType: "software",
				version,
				...overrides,
			},
		],
	};
}

test("ambiguous ready versions use the exact published Apple match rather than the greatest version", async () => {
	const versions = [
		modernVersion("5.1.15", "READY_FOR_DISTRIBUTION"),
		modernVersion("5.0.217", "READY_FOR_DISTRIBUTION"),
	];
	let lookups = 0;
	const published = async (appId) => {
		assert.equal(appId, "1045128150");
		lookups++;
		return "5.0.217";
	};
	assert.equal(
		await liveVersion(
			"1045128150",
			async () => ({ data: versions }),
			published,
		),
		"5.0.217",
	);
	const inspected = await inspectLiveVersions(
		"1045128150",
		async () => ({ data: versions }),
		published,
	);
	assert.equal(inspected.publicBaseline, "5.0.217");
	assert.equal(inspected.publicLookupVersion, "5.0.217");
	assert.equal(inspected.records.length, 2);
	assert.equal(inspected.error, null);
	assert.equal(lookups, 2);
});

test("public baseline resolution fails closed for missing, malformed and unavailable matches", async () => {
	for (const [versions, published] of [
		[["5.1.15", "5.0.217"], "5.1.25"],
		[["5.1.15", "invalid"], "invalid"],
	]) {
		await assert.rejects(
			liveVersion(
				"1045128150",
				async () => ({
					data: versions.map((version) =>
						modernVersion(version, "READY_FOR_DISTRIBUTION"),
					),
				}),
				async () => published,
			),
			/does not match a live iOS App Store record|not semver/,
		);
	}
	// Duplicate records of one live version collapse to a single baseline
	// rather than blocking on record-count ambiguity.
	assert.equal(
		await liveVersion(
			"1045128150",
			async () => ({
				data: [
					modernVersion("5.1.15", "READY_FOR_DISTRIBUTION"),
					{ ...modernVersion("5.1.15", "READY_FOR_DISTRIBUTION"), id: "dup" },
				],
			}),
			async () => "5.1.15",
		),
		"5.1.15",
	);
	const read = async () => ({
		data: [
			modernVersion("5.1.15", "READY_FOR_DISTRIBUTION"),
			modernVersion("5.0.217", "READY_FOR_DISTRIBUTION"),
		],
	});
	await assert.rejects(
		liveVersion("1045128150", read, async () => {
			throw new Error("lookup unavailable");
		}),
		/lookup unavailable/,
	);
	const inspection = await inspectLiveVersions("1045128150", read, async () => {
		throw new Error("lookup unavailable");
	});
	assert.equal(inspection.publicBaseline, null);
	assert.equal(inspection.publicLookupVersion, null);
	assert.equal(inspection.error, "lookup unavailable");
});

test("empty and single ready-version results preserve the existing path without another lookup", async () => {
	for (const records of [
		[],
		[modernVersion("5.1.15", "READY_FOR_DISTRIBUTION")],
	]) {
		assert.equal(
			await liveVersion(
				"1045128150",
				async () => ({ data: records }),
				() => {
					throw new Error("must not perform an unnecessary lookup");
				},
			),
			records[0]?.attributes.versionString ?? null,
		);
	}
});

test("public Apple lookup binds the exact software identity without credentials or redirects", async () => {
	let calls = 0;
	const version = await publicStoreVersion(
		"1045128150",
		async (input, options) => {
			calls++;
			const url = new URL(input);
			assert.equal(url.origin, "https://itunes.apple.com");
			assert.equal(url.pathname, "/lookup");
			assert.deepEqual(Object.fromEntries(url.searchParams), {
				id: "1045128150",
				country: "il",
				entity: "software",
			});
			assert.equal(options.method, "GET");
			assert.equal(options.redirect, "error");
			assert.equal(options.headers, undefined);
			assert(options.signal instanceof AbortSignal);
			return { ok: true, json: async () => publicAppleResult("5.1.15") };
		},
	);
	assert.equal(version, "5.1.15");
	assert.equal(calls, 1);
});

test("public Apple lookup refuses invalid app IDs before transport", async () => {
	for (const id of [
		undefined,
		1045128150,
		"0",
		"-1",
		"app/1",
		"1045128150?country=us",
		"999999999999999999999",
	]) {
		await assert.rejects(
			publicStoreVersion(id, () => {
				throw new Error("unexpected transport");
			}),
			/Invalid public Apple app identity/,
		);
	}
});

test("public Apple lookup rejects unbound, non-software or ambiguous result payloads", async () => {
	for (const result of [
		null,
		{},
		{ resultCount: 0, results: [] },
		{ resultCount: 1, results: [] },
		{ resultCount: 1, results: null },
		{ resultCount: 1, results: [null] },
		{ resultCount: 2, results: publicAppleResult("5.1.15").results },
		{
			resultCount: 1,
			results: [
				...publicAppleResult("5.1.15").results,
				...publicAppleResult("5.1.15").results,
			],
		},
		publicAppleResult("5.1.15", { trackId: "1045128150" }),
		publicAppleResult("5.1.15", { trackId: 2 }),
		publicAppleResult("5.1.15", { bundleId: "other.app" }),
		publicAppleResult("5.1.15", { kind: "song" }),
		publicAppleResult("5.1.15", { wrapperType: "track" }),
		publicAppleResult(5),
		publicAppleResult("5.1"),
	]) {
		await assert.rejects(
			publicStoreVersion("1045128150", async () => ({
				ok: true,
				json: async () => result,
			})),
			/identity is missing or ambiguous/,
		);
	}
});

test("public Apple read failures remain failures without retries or a guessed baseline", async () => {
	for (const response of [
		async () => ({ ok: false, status: 503 }),
		async () => {
			throw new Error("network unavailable");
		},
		async () => ({
			ok: true,
			json: async () => {
				throw new Error("invalid JSON");
			},
		}),
	]) {
		let calls = 0;
		await assert.rejects(
			publicStoreVersion("1045128150", (...args) => {
				calls++;
				return response(...args);
			}),
			/HTTP 503|network unavailable|invalid JSON/,
		);
		assert.equal(calls, 1);
	}
});
