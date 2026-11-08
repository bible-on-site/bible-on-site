import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	apiToken,
	appleReader,
	checkBuild,
	checkUploadResult,
	findBuild,
	findBuildUploads,
	previousDelivery,
	readIpa,
} from "./testflight-build.mjs";

// Apple's actual validation responses from deployment job 116585562778.
const validationRejections = [
	"[altool] [ContentDelivery.Uploader] Validation failed (409) Invalid Code Signing Entitlements. The bundle contains a key that is not included in the provisioning profile: 'com.apple.security.application-groups' in 'Payload/BibleOnSite.app/BibleOnSite'.",
	"[altool] Validation failed (409) Invalid bundle structure. The BibleOnSite.app/Extensions/AssetPackDownloader.appex/AssetPackDownloader binary file is not permitted.",
	"[altool] Validation failed (409) This bundle is invalid. The bundle at path Payload/BibleOnSite.app/Extensions/AssetPackDownloader.appex has an invalid CFBundleIdentifier ''.",
	"[altool] Validation failed (409) Missing Info.plist value. A value for the key 'CFBundleExecutable' in bundle BibleOnSite.app/Extensions/AssetPackDownloader.appex is required.",
	"[altool] Validation failed (409) Invalid Mach-O header. The __swift5_entry section is missing for the Payload/BibleOnSite.app/Extensions/AssetPackDownloader.appex extension bundle.",
	"[altool] Validation failed (409) Missing Entitlement. The Background Assets extension and/or its parent app bundle are missing the com.apple.security.application-groups entitlement.",
];

test("Apple signing and extension validation rejections fail without build polling", () => {
	for (const rejection of validationRejections) {
		assert.throws(
			() => checkUploadResult(1, `\u001b[33m${rejection}\u001b[0m`),
			/Apple rejected the upload/,
		);
	}
	assert.throws(
		() => checkUploadResult(0, validationRejections.join("\n")),
		/Apple rejected the upload/,
	);
	assert.throws(
		() =>
			checkUploadResult(
				1,
				'NSUnderlyingError = "Error Domain=IrisAPI UserInfo={status=409, detail=Invalid Code Signing Entitlements., code=STATE_ERROR.VALIDATION_ERROR}";',
			),
		/Apple rejected the upload/,
	);
	assert.throws(
		() =>
			checkUploadResult(
				1,
				'ERROR ITMS-90035: "Invalid Signature. A sealed resource is missing or invalid."',
			),
		/Apple rejected the upload/,
	);
});

test("transport ambiguity and duplicate uploads retain exact-build recovery", () => {
	const messages = [];
	for (const log of [
		"The request timed out. An exception occurred during upload.",
		"Connection reset by peer after sending the package",
		"HTTP 503 Service Unavailable",
		`[altool] Validation failed (409) Redundant Binary Upload. You've already uploaded a build with build number '168'.
NSUnderlyingError = "Error Domain=IrisAPI UserInfo={status=409, detail=Redundant Binary Upload. You've already uploaded a build., code=STATE_ERROR.VALIDATION_ERROR}";
"iris-code" = "STATE_ERROR.VALIDATION_ERROR";
ERROR ITMS-90189: Redundant Binary Upload. This build has already been uploaded.`,
	]) {
		assert.doesNotThrow(() =>
			checkUploadResult(1, log, (message) => messages.push(message)),
		);
	}
	assert.equal(messages.length, 4);
	assert.ok(messages.every((message) => /without uploading again/.test(message)));
	assert.throws(
		() =>
			checkUploadResult(
				1,
				`Redundant Binary Upload. Already uploaded.\n${validationRejections[0]}`,
			),
		/Apple rejected the upload/,
	);
	assert.doesNotThrow(() =>
		checkUploadResult(0, "Upload complete", () => assert.fail("no warning")),
	);
	assert.throws(() => checkUploadResult(undefined, ""), /exit status/);
});

test("upload-result command makes the upload step red before requiring API credentials", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "testflight-rejection-"));
	try {
		const log = path.join(directory, "upload.log");
		const run = (contents, exitCode) => {
			writeFileSync(log, contents);
			return spawnSync(
				process.execPath,
				[
					fileURLToPath(new URL("./testflight-build.mjs", import.meta.url)),
					"upload-result",
					log,
					exitCode,
				],
				{ encoding: "utf8", env: {} },
			);
		};
		for (const exitCode of ["0", "1"]) {
			const rejected = run(validationRejections.join("\n"), exitCode);
			assert.equal(rejected.status, 1, rejected.stderr);
			assert.match(rejected.stderr, /Apple rejected the upload/);
			assert.doesNotMatch(rejected.stderr, /credentials|IPA identity/);
		}
		const ambiguous = run("Connection reset by peer", "1");
		assert.equal(ambiguous.status, 0, ambiguous.stderr);
		assert.match(ambiguous.stdout, /verifying the exact build/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

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
		await assert.rejects(lookup(response(), status), (err) =>
			String(err instanceof Error ? err.message : err).includes(`HTTP ${status}`),
		);
	});

const uploadResponse = (state = "FAILED") => ({
	data: [
		{
			id: "exact-upload",
			type: "buildUploads",
			attributes: {
				cfBundleShortVersionString: metadata.version,
				cfBundleVersion: metadata.number,
				platform: "IOS",
				state: {
					state,
					errors: [
						{ code: "ITMS-90000", description: "Rejected resource pack" },
					],
					warnings: [{ code: "WARNING", description: "Upload warning" }],
				},
			},
		},
	],
});

async function uploadLookup(result, status = 200) {
	const urls = [];
	const uploads = await findBuildUploads(
		metadata,
		credentials,
		async (url, options) => {
			urls.push(url);
			assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
			assert.equal(options.redirect, "error");
			assert.match(options.headers.Authorization, /^Bearer /);
			return {
				ok: status === 200,
				status,
				json: async () => (urls.length === 1 ? { data: [app] } : result),
			};
		},
	);
	assert.equal(urls[1].pathname, `/v1/apps/${app.id}/buildUploads`);
	assert.equal(
		urls[1].searchParams.get("filter[cfBundleShortVersionString]"),
		metadata.version,
	);
	assert.equal(
		urls[1].searchParams.get("filter[cfBundleVersion]"),
		metadata.number,
	);
	assert.equal(urls[1].searchParams.get("filter[platform]"), "IOS");
	return uploads;
}

test("failed uploads expose Apple's rejection even when there is no processed build", async () => {
	assert.deepEqual(await uploadLookup(uploadResponse()), [
		{
			id: "exact-upload",
			state: "FAILED",
			errors: [{ code: "ITMS-90000", description: "Rejected resource pack" }],
			warnings: [{ code: "WARNING", description: "Upload warning" }],
			...metadata,
		},
	]);
	assert.deepEqual(await uploadLookup({ data: [] }), []);
});

test("upload processing and completion do not count as a validated build", async () => {
	for (const state of ["AWAITING_UPLOAD", "PROCESSING", "COMPLETE"]) {
		assert.equal((await uploadLookup(uploadResponse(state)))[0].state, state);
	}
	await assert.rejects(check([null], { previous: true }), /do not repeat/);
});

for (const [label, change] of [
	[
		"different version",
		(r) => {
			r.data[0].attributes.cfBundleShortVersionString = "5.0.127";
		},
	],
	[
		"different build",
		(r) => {
			r.data[0].attributes.cfBundleVersion = "127";
		},
	],
	[
		"different platform",
		(r) => {
			r.data[0].attributes.platform = "MAC_OS";
		},
	],
	[
		"unknown state",
		(r) => {
			r.data[0].attributes.state.state = "UNKNOWN";
		},
	],
	[
		"missing state",
		(r) => {
			delete r.data[0].attributes.state;
		},
	],
	[
		"malformed details",
		(r) => {
			r.data[0].attributes.state.errors = {};
		},
	],
	[
		"incomplete pagination",
		(r) => {
			r.links = { next: "https://untrusted.invalid/" };
		},
	],
]) {
	test(`upload diagnostics reject ${label}`, async () => {
		const result = uploadResponse();
		change(result);
		await assert.rejects(uploadLookup(result));
	});
}

test("upload lookup denial never permits a retry or hides an HTTP failure", async () => {
	await assert.rejects(uploadLookup(uploadResponse(), 403), /HTTP 403/);
});

// ---------- #2842: bounded retry for read-only Apple requests ----------

const okResponse = (result = { data: [] }) => ({
	ok: true,
	status: 200,
	json: async () => result,
});
const statusResponse = (status, headers = {}) => ({
	ok: false,
	status,
	headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

function readWith(fetcher, policy = {}) {
	const sleeps = [];
	const reports = [];
	const read = appleReader(credentials, fetcher, {
		sleep: async (ms) => sleeps.push(ms),
		random: () => 0,
		report: (line) => reports.push(JSON.parse(line)),
		...policy,
	});
	return { read, sleeps, reports };
}

test("appleReader retries a transient timeout then succeeds", async () => {
	let calls = 0;
	const { read, sleeps, reports } = readWith(async () => {
		calls++;
		if (calls === 1)
			throw new DOMException(
				"The operation was aborted due to timeout",
				"TimeoutError",
			);
		return okResponse({ data: [{ id: "pack" }] });
	});
	assert.deepEqual(await read("backgroundAssets/1/versions", {}), {
		data: [{ id: "pack" }],
	});
	assert.equal(calls, 2);
	assert.deepEqual(sleeps, [1000]);
	assert.equal(reports[0].phase, "apple-read-retry");
	assert.equal(reports[0].attempt, 2);
});

test("appleReader honors Retry-After on throttled and server answers", async () => {
	for (const [status, header, expected] of [
		[429, "2", 2000],
		[503, "1", 1000],
		// A long server hint is honored up to the remaining budget instead of
		// retrying inside the throttle window (Devin Review on #2847).
		[429, "60", 60000],
	]) {
		let calls = 0;
		const { read, sleeps } = readWith(async () => {
			calls++;
			if (calls === 1)
				return statusResponse(status, { "retry-after": header });
			return okResponse();
		});
		await read("apps", {});
		assert.equal(calls, 2);
		assert.deepEqual(sleeps, [expected]);
	}
});

test("appleReader never retries permanent authorization or malformed answers", async () => {
	for (const status of [400, 401, 403, 404, 422]) {
		let calls = 0;
		const { read } = readWith(async () => {
			calls++;
			return statusResponse(status);
		});
		await assert.rejects(read("apps", {}), (error) =>
			error.message.includes(`HTTP ${status}`),
		);
		assert.equal(calls, 1);
	}
	let calls = 0;
	const { read } = readWith(async () => {
		calls++;
		return okResponse({ data: {} });
	});
	await assert.rejects(read("apps", {}), /incomplete build lookup/);
	assert.equal(calls, 1);
});

test("appleReader exhausts bounded retries and stays a failed read", async () => {
	for (const fail of [
		() => {
			throw new TypeError("fetch failed");
		},
		() => statusResponse(500),
	]) {
		let calls = 0;
		const { read } = readWith(async () => {
			calls++;
			return fail();
		});
		await assert.rejects(read("apps", {}));
		assert.equal(calls, 3);
	}
});

test("appleReader stops inside the overall time budget", async () => {
	let now = 0;
	let calls = 0;
	const { read, sleeps } = readWith(
		async () => {
			calls++;
			throw new TypeError("fetch failed");
		},
		{
			retries: 10,
			budgetMs: 2500,
			now: () => now,
			sleep: async (ms) => {
				sleeps.push(ms);
				now += ms;
			},
		},
	);
	await assert.rejects(read("apps", {}), /fetch failed/);
	assert.equal(calls, 3);
	assert.deepEqual(sleeps, [1000, 1500]);
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
test("large extensions can finish processing after the old ten-minute budget", async () => {
	let reads = 0;
	let waits = 0;
	const result = await checkBuild({
		phase: "postflight",
		lookup: async () =>
			++reads < 40 ? null : { id: "exact-build", state: "VALID" },
		sleep: async (ms) => {
			assert.equal(ms, 30000);
			waits++;
		},
		report: () => {},
	});
	assert.equal(reads, 40);
	assert.equal(waits, 39);
	assert.equal(result.upload, false);
});
test("the extended processing budget still ends without permitting another upload", async () => {
	let reads = 0;
	await assert.rejects(
		checkBuild({
			phase: "preflight",
			previous: true,
			lookup: async () => {
				reads++;
				return null;
			},
			sleep: async () => {},
			report: () => {},
		}),
		/do not repeat/,
	);
	assert.equal(reads, 60);
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
