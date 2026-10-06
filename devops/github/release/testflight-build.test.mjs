import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	apiToken,
	checkBuild,
	findBuild,
	previousDelivery,
	readIpa,
} from "./testflight-build.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
	namedCurve: "prime256v1",
});
const credentials = {
	key_id: "TESTKEY",
	issuer_id: "test-issuer",
	key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const metadata = {
	bundle: "com.tanah.daily929",
	version: "5.0.126",
	number: "126",
};
const app = {
	type: "apps",
	id: "1045128150",
	attributes: { bundleId: metadata.bundle },
};
const response = () => ({
	data: [
		{
			id: "exact-build",
			type: "builds",
			attributes: { version: "126", expired: false, processingState: "VALID" },
			relationships: {
				app: { data: { id: app.id } },
				preReleaseVersion: { data: { id: "version-id" } },
			},
		},
	],
	included: [
		app,
		{
			id: "version-id",
			type: "preReleaseVersions",
			attributes: { version: "5.0.126", platform: "IOS" },
		},
	],
});

test("API tokens use a verified P-256 signature and a bounded Apple audience", () => {
	const [header, payload, signature] = apiToken(credentials, 12345).split(".");
	assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
		alg: "ES256",
		kid: "TESTKEY",
		typ: "JWT",
	});
	assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), {
		iss: "test-issuer",
		iat: 12345,
		exp: 12945,
		aud: "appstoreconnect-v1",
	});
	assert.equal(Buffer.from(signature, "base64url").length, 64);
	assert.equal(
		verify(
			"sha256",
			Buffer.from(`${header}.${payload}`),
			{ key: publicKey, dsaEncoding: "ieee-p1363" },
			Buffer.from(signature, "base64url"),
		),
		true,
	);
	assert.throws(() => apiToken({}), /incomplete/);
	const wrongKey = generateKeyPairSync("ec", {
		namedCurve: "secp384r1",
	}).privateKey.export({ type: "pkcs8", format: "pem" });
	assert.throws(() => apiToken({ ...credentials, key: wrongKey }), /P-256/);
});

async function lookup(result, status = 200) {
	const urls = [];
	const build = await findBuild(metadata, credentials, async (url, options) => {
		urls.push(url);
		assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
		assert.equal(options.redirect, "error");
		assert.match(options.headers.Authorization, /^Bearer /);
		return {
			ok: status === 200,
			status,
			json: async () => (urls.length === 1 ? { data: [app] } : result),
		};
	});
	assert.equal(urls[1].searchParams.get("filter[app]"), app.id);
	assert.equal(urls[1].searchParams.get("filter[version]"), "126");
	assert.equal(
		urls[1].searchParams.get("filter[preReleaseVersion.version]"),
		"5.0.126",
	);
	assert.equal(
		urls[1].searchParams.get("filter[preReleaseVersion.platform]"),
		"IOS",
	);
	return build;
}

test("lookup binds the app, marketing version, build number, platform and validity", async () => {
	assert.deepEqual(await lookup(response()), {
		id: "exact-build",
		state: "VALID",
		...metadata,
	});
	assert.equal(await lookup({ data: [] }), null);
});
for (const [label, change] of [
	[
		"different app",
		(r) => {
			r.data[0].relationships.app.data.id = "other-app";
		},
	],
	[
		"different build",
		(r) => {
			r.data[0].attributes.version = "127";
		},
	],
	[
		"different version",
		(r) => {
			r.included[1].attributes.version = "5.0.127";
		},
	],
	[
		"different platform",
		(r) => {
			r.included[1].attributes.platform = "MAC_OS";
		},
	],
	[
		"expired build",
		(r) => {
			r.data[0].attributes.expired = true;
		},
	],
	[
		"unknown state",
		(r) => {
			r.data[0].attributes.processingState = "UNKNOWN";
		},
	],
	[
		"missing state",
		(r) => {
			delete r.data[0].attributes.processingState;
		},
	],
	[
		"ambiguous result",
		(r) => {
			r.data.push(r.data[0]);
		},
	],
	[
		"incomplete pagination",
		(r) => {
			r.links = { next: "https://untrusted.invalid/" };
		},
	],
	[
		"malformed response",
		(r) => {
			r.data = {};
		},
	],
])
	test(`lookup rejects ${label}`, async () => {
		const result = response();
		change(result);
		await assert.rejects(lookup(result));
	});
for (const status of [401, 403, 404, 500])
	test(`HTTP ${status} never becomes permission to upload`, async () => {
		await assert.rejects(
			lookup(response(), status),
			new RegExp(`HTTP ${status}`),
		);
	});

const check = (states, options = {}) => {
	let reads = 0;
	return checkBuild({
		lookup: async () => {
			const state = states[Math.min(reads++, states.length - 1)];
			return state ? { id: "exact-build", state } : null;
		},
		attempts: 3,
		sleep: async () => {},
		report: () => {},
		phase: "preflight",
		...options,
	});
};
test("only a first recorded delivery with an absent build may upload", async () => {
	assert.equal((await check([null])).upload, true);
	await assert.rejects(check([null], { previous: true }), /do not repeat/);
	await assert.rejects(check([null], { phase: "postflight" }), /do not repeat/);
});
test("a partial delivery resumes the exact processed build without uploading again", async () => {
	for (const phase of ["preflight", "postflight"]) {
		assert.equal(
			(await check([null, "PROCESSING", "VALID"], { phase, previous: true }))
				.upload,
			false,
		);
	}
});
test("failed, invalid and unconfirmed builds do not count as delivered", async () => {
	for (const state of ["INVALID", "FAILED"])
		await assert.rejects(check([state]), /rejected/);
	await assert.rejects(check(["PROCESSING"]), /not confirmed/);
	assert.deepEqual(await check(["PROCESSING"], { phase: "inspect" }), {
		upload: false,
		build: { id: "exact-build", state: "PROCESSING" },
	});
});
test("lookup failures terminate immediately without permitting an upload", async () => {
	await assert.rejects(
		checkBuild({
			phase: "preflight",
			lookup: async () => {
				throw new Error("denied");
			},
			report: () => {},
		}),
		/denied/,
	);
});
test("delivery history excludes this attempt and unrelated targets and follows pages", () => {
	const current = { id: 20, payload: { release_key: "app-ios-v5.0.126" } };
	const args = {
		repo: "test/repo",
		ref: "a".repeat(40),
		version: "5.0.126",
		deploymentId: 20,
	};
	assert.equal(
		previousDelivery(args, () => [
			current,
			{ id: 1, payload: { release_key: "app-ios-v5.0.125" } },
		]),
		false,
	);
	assert.equal(
		previousDelivery(args, () => [
			current,
			{ id: 19, payload: current.payload },
		]),
		true,
	);
	let pages = 0;
	assert.equal(
		previousDelivery(args, () =>
			++pages === 1
				? Array(100).fill(current)
				: [{ id: 19, payload: current.payload }],
		),
		true,
	);
	assert.equal(pages, 2);
});
test("binary IPA metadata rather than current checkout determines build identity", (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "testflight-ipa-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const ipa = path.join(directory, "app.ipa");
	execFileSync(process.platform === "win32" ? "python" : "python3", [
		"-c",
		"import plistlib,sys,zipfile; info={'CFBundleIdentifier':'com.tanah.daily929','CFBundleShortVersionString':'5.0.126','CFBundleVersion':'126'}; archive=zipfile.ZipFile(sys.argv[1],'w'); archive.writestr('Payload/BibleOnSite.app/Info.plist',plistlib.dumps(info,fmt=plistlib.FMT_BINARY)); archive.close()",
		ipa,
	]);
	assert.deepEqual(readIpa(ipa, "5.0.126"), metadata);
	assert.throws(() => readIpa(ipa, "5.0.127"), /guarded release/);
});
