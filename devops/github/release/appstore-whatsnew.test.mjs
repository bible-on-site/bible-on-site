import assert from "node:assert/strict";
import { test } from "node:test";

import {
	EDITABLE_STATES,
	editableVersion,
	liveVersion,
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
 * more than one record — only the verified iOS live state may decide the
 * baseline.
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

test("liveVersion resolves the baseline from verified state in the real multi-record response", async () => {
	// The failed run's response held several records; only one verified-live
	// version exists, reported by two different records.
	assert.equal(await liveVersion("app1", async () => ({ data: realWorldRecords })), "5.1.23");
});

test("liveVersion treats duplicate records of one live version as one baseline", async () => {
	const read = async () => ({
		data: [
			versionData("5.1.23", "a", "READY_FOR_SALE"),
			versionData("5.1.23", "b", "READY_FOR_SALE"),
		],
	});
	assert.equal(await liveVersion("app1", read), "5.1.23");
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

test("liveVersion blocks rather than silently trusting records it cannot classify", async () => {
	// A row missing platform, state, or versionString can never prove it is
	// not the live record — ignoring it could fabricate a null baseline.
	for (const row of [
		{ id: "x", attributes: { versionString: "5.1.9", appVersionState: "READY_FOR_DISTRIBUTION" } },
		{ id: "x", attributes: { versionString: "5.1.9", platform: "IOS" } },
		{ id: "x", attributes: { platform: "IOS", appVersionState: "READY_FOR_DISTRIBUTION" } },
		{ id: "x", attributes: { platform: "IOS" } },
	]) {
		await assert.rejects(
			liveVersion("app1", async () => ({
				data: [versionData("5.1.7"), row],
			})),
			/cannot be classified/i,
			JSON.stringify(row),
		);
	}
	// But a proven non-live or non-iOS row with missing unrelated attributes
	// is still excludable — only live candidates need full identity.
	assert.equal(
		await liveVersion("app1", async () => ({
			data: [
				versionData("5.1.7"),
				{ id: "x", attributes: { platform: "IOS", appVersionState: "REJECTED" } },
				{ id: "y", attributes: { platform: "MAC_OS" } },
			],
		})),
		"5.1.7",
	);
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
