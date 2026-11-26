import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { stageAuthorPortraits } from "./stage-author-portraits.mjs";

const origin = "https://bible-on-site-assets.s3.il-central-1.amazonaws.com";
const manifestUrl = `${origin}/authors/caricatures/manifest.json`;
const portraitKey = "authors/caricatures/v20261126/high-res/39.png";
const legacyKey = "authors/high-res/39.jpg";
const legacyEtag = "0123456789abcdef0123456789abcdef";

const portrait = (key = portraitKey, etag = legacyEtag) => ({
	key,
	legacyEtag: etag,
});
const manifest = (portraits = { 39: portrait() }) => ({
	version: 1,
	portraits,
});
const notFound = () => new Response(null, { status: 404 });

async function fixture(t) {
	const cwd = await mkdtemp(join(tmpdir(), "author-portraits-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const snapshot = join(cwd, "public/generated/author-portraits.json");
	return {
		stage: (fetcher, options) =>
			stageAuthorPortraits({ cwd, env: {}, fetcher, ...options }),
		read: async () => JSON.parse(await readFile(snapshot, "utf8")),
	};
}

test("stages a PNG when the current JPEG matches its release ETag", async (t) => {
	const { stage, read } = await fixture(t);
	const calls = [];
	const fetcher = async (url, options) => {
		calls.push({ url, method: options.method });
		assert.ok(options.signal instanceof AbortSignal);
		assert.equal(options.cache, "no-store");
		if (url === manifestUrl) {
			assert.equal(options.method, undefined);
			return Response.json(manifest());
		}
		assert.equal(url, `${origin}/${legacyKey}`);
		assert.equal(options.method, "HEAD");
		return new Response(null, {
			headers: { ETag: `"${legacyEtag.toUpperCase()}"` },
		});
	};

	assert.deepEqual(await stage(fetcher, { requireManifest: true }), {
		39: portraitKey,
	});
	assert.deepEqual(await read(), { 39: portraitKey });
	assert.deepEqual(calls, [
		{ url: manifestUrl, method: undefined },
		{ url: `${origin}/${legacyKey}`, method: "HEAD" },
	]);
});

test("stages a cache-busted legacy JPEG after a later admin upload", async (t) => {
	const { stage, read } = await fixture(t);
	const currentEtag = "abcdef0123456789abcdef0123456789-2";
	await stage(async (url) =>
		url === manifestUrl
			? Response.json(
					manifest({ 39: portrait(portraitKey, `"${legacyEtag}"`) }),
				)
			: new Response(null, { headers: { ETag: `"${currentEtag}"` } }),
	);
	assert.deepEqual(await read(), { 39: `${legacyKey}?v=${currentEtag}` });
});

test("keeps the PNG if the legacy JPEG metadata is unavailable", async (t) => {
	const { stage, read } = await fixture(t);
	const unavailable = [
		notFound,
		() => new Response(null, { headers: { ETag: "bad-etag" } }),
		() => {
			throw new Error("Timed out");
		},
	];

	for (const fetchLegacy of unavailable) {
		await stage(async (url) =>
			url === manifestUrl ? Response.json(manifest()) : fetchLegacy(),
		);
		assert.deepEqual(await read(), { 39: portraitKey });
	}
});

test("rejects malformed manifest entries before any JPEG probe", async (t) => {
	const { stage, read } = await fixture(t);
	for (const portraits of [
		{ 39: portrait("authors/caricatures/../high-res/39.png") },
		{ 39: portrait("authors/caricatures/v20261126/high-res/41.png") },
		{ 39: portrait("Authors/caricatures/v20261126/high-res/39.png") },
		{
			39: portrait(
				"https://example.com/authors/caricatures/v1/high-res/39.png",
			),
		},
		{ "039": portrait("authors/caricatures/v1/high-res/039.png") },
		{
			9007199254740992: portrait(
				"authors/caricatures/v1/high-res/9007199254740992.png",
			),
		},
		{ 39: portrait(portraitKey, "bad-etag") },
	]) {
		const fetcher = async (url) => {
			assert.equal(url, manifestUrl);
			return Response.json(manifest(portraits));
		};
		await stage(fetcher);
		assert.deepEqual(await read(), {});
		await assert.rejects(
			stage(fetcher, { requireManifest: true }),
			/Invalid author portrait manifest entry/,
		);
	}
});

test("an unavailable manifest clears the snapshot or fails a required release", async (t) => {
	const { stage, read } = await fixture(t);
	await stage(async (url) =>
		url === manifestUrl ? Response.json(manifest()) : notFound(),
	);
	await assert.rejects(
		stage(async () => notFound(), { requireManifest: true }),
		/HTTP 404/,
	);
	assert.deepEqual(await read(), { 39: portraitKey });

	await stage(async () => notFound());
	assert.deepEqual(await read(), {});
	await assert.rejects(
		stage(async () => Response.json({ version: 2 }), {
			requireManifest: true,
		}),
		/Invalid author portrait manifest/,
	);
});

test("skips production requests with a local endpoint or a different bucket", async (t) => {
	const { stage, read } = await fixture(t);
	const fetcher = t.mock.fn(() => {
		throw new Error("Unexpected network request");
	});
	for (const env of [
		{ S3_ENDPOINT: "http://localhost:4566" },
		{ S3_BUCKET: "bible-on-site-assets-test" },
	]) {
		await stage(fetcher, { env });
		assert.deepEqual(await read(), {});
		await assert.rejects(
			stage(fetcher, { env, requireManifest: true }),
			/requires the production S3 bucket/,
		);
	}
	assert.equal(fetcher.mock.callCount(), 0);
});

test("bounds parallel JPEG probes without dropping entries", async (t) => {
	const { stage } = await fixture(t);
	const portraits = Object.fromEntries(
		Array.from({ length: 20 }, (_, index) => {
			const id = index + 1;
			return [id, portrait(`authors/caricatures/v1/high-res/${id}.png`)];
		}),
	);
	let active = 0;
	let peak = 0;
	const snapshot = await stage(async (url) => {
		if (url === manifestUrl) return Response.json(manifest(portraits));
		active += 1;
		peak = Math.max(active, peak);
		await setImmediate();
		active -= 1;
		return notFound();
	});
	assert.equal(Object.keys(snapshot).length, 20);
	assert.equal(peak, 8);
});
