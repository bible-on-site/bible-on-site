import assert from "node:assert/strict";
import test from "node:test";
import { checkAssets, main } from "./assets-cdn-check.mjs";

function fixture(change = () => {}) {
	const calls = [];
	return { calls, async fetcher(input, options) {
		const url = new URL(input);
		const edge = url.hostname === "d123.cloudfront.net";
		calls.push({ url, options });
		const missing = url.pathname.startsWith("/assets-cdn-check-missing");
		let status = missing ? 403 : url.search ? 400 : options.method === "HEAD" || options.method === "OPTIONS" ? 200 : 206;
		const headers = new Headers({ "content-type": "audio/mpeg", "cache-control": "public,max-age=3600", etag: '"same"', "accept-ranges": "bytes" });
		if (options.headers?.Origin) headers.set("access-control-allow-origin", "*");
		if (options.method === "OPTIONS") { headers.set("access-control-allow-methods", "GET, HEAD"); headers.set("access-control-allow-headers", "range"); }
		if (status === 206) headers.set("content-range", "bytes 0-31/1234");
		if (edge) { headers.set("x-amz-cf-id", "edge-id"); headers.set("x-cache", status >= 400 ? "Error from cloudfront" : "Miss from cloudfront"); }
		let body = options.method === "HEAD" ? null : status === 206 ? Buffer.alloc(32, 7) : "";
		const response = { status, headers, body };
		if (edge) change(response, { url, options, missing });
		return new Response(response.body, { status: response.status, headers });
	} };
}

test("read-only matrix proves CORS, query rejection, small ranges and repeated uncached missing objects", async () => {
	const io = fixture();
	const report = await checkAssets("https://d123.cloudfront.net", io);
	assert.equal(report.ok, true);
	assert.equal(report.results.length, 19);
	assert.equal(io.calls.length, 38);
	assert.ok(io.calls.every(({ options }) => ["HEAD", "GET", "OPTIONS"].includes(options.method ?? "GET")));
	assert.ok(io.calls.filter(({ options }) => (options.method ?? "GET") === "GET").every(({ options, url }) => options.headers?.Range === "bytes=0-31" || url.pathname.includes("missing")));
	assert.equal(report.results.at(-1).key, report.results.at(-2).key);
});

test("regressions in bytes, CORS, range metadata, forwarding and error-cache evidence fail", async (t) => {
	const changes = {
		bytes: (r) => { if (r.status === 206) r.body = Buffer.alloc(32, 9); },
		cors: (r) => r.headers.delete("access-control-allow-origin"),
		range: (r) => { if (r.status === 206) r.headers.set("content-range", "bytes 1-32/1234"); },
		query: (r, { url }) => { if (url.search) r.status = 200; },
		errorAge: (r) => { if (r.status >= 400) r.headers.set("age", "0"); },
		cacheHit: (r) => r.headers.set("x-cache", "Hit from cloudfront"),
		edge: (r) => r.headers.delete("x-amz-cf-id"),
	};
	for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
		assert.equal((await checkAssets("https://d123.cloudfront.net", fixture(change))).ok, false);
	});
});

test("unavailable source becomes explicit failed evidence rather than an incomplete pass", async () => {
	const report = await checkAssets("https://d123.cloudfront.net", { fetcher: async () => { throw new TypeError("unavailable"); } });
	assert.equal(report.ok, false);
	assert.equal(report.results.length, 19);
	assert.ok(report.results.every((result) => result.failures[0] === "Probe failed: TypeError"));
});

test("a server ignoring Range is cancelled before a full recording is downloaded", async () => {
	let cancelled = 0;
	const report = await checkAssets("https://d123.cloudfront.net", { fetcher: async (_url, options) => ({
		status: 200,
		headers: new Headers({ "x-amz-cf-id": "edge-id" }),
		body: { cancel: async () => { cancelled++; } },
		arrayBuffer: async () => {
			assert.equal(options.headers?.Range, undefined, "Ignored range body must not be consumed");
			return new ArrayBuffer(0);
		},
	}) });
	assert.equal(report.ok, false);
	assert.equal(cancelled, 16);
});

test("CLI rejects credentials, non-CloudFront targets and paths before making requests", async () => {
	for (const candidate of ["http://d123.cloudfront.net", "https://example.com", "https://user:pass@d123.cloudfront.net", "https://d123.cloudfront.net/path", "https://d123.cloudfront.net/?token=secret", "https://d123.cloudfront.net:123"]) await assert.rejects(main(["--candidate", candidate], { run: () => assert.fail("Invalid target probed") }));
	await assert.rejects(main([]));
	let output;
	assert.equal(await main(["--candidate", "https://d123.cloudfront.net"], { run: async () => ({ ok: true }), write: (text) => { output = JSON.parse(text); } }), true);
	assert.equal(output.ok, true);
	assert.equal(await main(["--candidate", "https://d123.cloudfront.net"], { run: async () => ({ ok: false }), write: () => {} }), false);
});
