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
	attributes: { versionString: version, appStoreState: state },
});

test("liveVersion returns the single ready-for-sale iOS version", async () => {
	const read = async (pathName, params) => {
		assert.equal(
			params["filter[appStoreState]"],
			"READY_FOR_SALE",
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
