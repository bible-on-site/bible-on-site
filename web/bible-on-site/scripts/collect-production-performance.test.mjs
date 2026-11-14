import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectCrux,
	collectFlaggedAssets,
	parseOptions,
} from "./collect-production-performance.mjs";

test("asset capture deduplicates flagged first-party static code and records its checksum", async () => {
	const dir = mkdtempSync(join(tmpdir(), "perf-assets-"));
	try {
		const report = {
			url: "https://example.com/",
			opportunities: [
				{
					evidence: [
						{ url: "https://example.com/_next/static/chunks/page.css" },
						{ url: "https://example.com/_next/static/chunks/page.css" },
						{ url: "https://third-party.example/script.js" },
						{ url: "https://example.com/api/dynamic" },
					],
				},
			],
		};
		const assets = await collectFlaggedAssets(dir, [report], async (url) => {
			assert.equal(url, "https://example.com/_next/static/chunks/page.css");
			return {
				ok: true,
				arrayBuffer: async () => new TextEncoder().encode("body{}").buffer,
			};
		});
		assert.equal(assets.length, 1);
		assert.equal(assets[0].bytes, 6);
		assert.equal(assets[0].sha256.length, 64);
		assert.equal(readFileSync(join(dir, assets[0].file), "utf8"), "body{}");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("CLI validates devices, repeat count and URLs without a browser", () => {
	const options = parseOptions([
		"--url",
		"https://example.com/a#x",
		"--device",
		"mobile",
		"--runs",
		"2",
		"--skip-field",
	]);
	assert.deepEqual(options.urls, ["https://example.com/a"]);
	assert.deepEqual(options.devices, ["mobile"]);
	assert.equal(options.runs, 2);
	assert.equal(options.field, false);
	for (const args of [
		["--runs", "0"],
		["--runs", "NaN"],
		["--device", "tablet"],
		["--url", "file:///tmp/report"],
		["--url", "https://user:password@example.com"],
	])
		assert.throws(() => parseOptions(args));
	assert.equal(parseOptions(["--help"]).help, true);
});

test("CrUX requests preserve device, page/origin scope, p75 and collection period", async () => {
	const record = {
		collectionPeriod: { firstDate: { year: 2026, month: 9, day: 29 } },
		metrics: { interaction_to_next_paint: { percentiles: { p75: 250 } } },
	};
	const result = await collectCrux(
		"https://example.com/page",
		"mobile",
		"origin",
		{
			apiKey: "test-key",
			fetcher: async (url, request) => {
				assert.ok(!url.includes("test-key"));
				assert.equal(request.headers["X-Goog-Api-Key"], "test-key");
				const body = JSON.parse(request.body);
				assert.equal(body.origin, "https://example.com");
				assert.equal(body.formFactor, "PHONE");
				return { ok: true, json: async () => ({ record }) };
			},
		},
	);
	assert.equal(result.status, "available");
	assert.equal(result.scope, "origin");
	assert.deepEqual(result.record, record);
	assert.ok(!JSON.stringify(result).includes("test-key"));
});

test("missing field credentials, no data, API errors and timeouts remain explicitly unavailable", async () => {
	assert.equal(
		(await collectCrux("https://example.com", "desktop", "url")).status,
		"unavailable",
	);
	for (const status of [404, 429, 500]) {
		const result = await collectCrux("https://example.com", "desktop", "url", {
			apiKey: "key",
			fetcher: async () => ({ ok: false, status }),
		});
		assert.equal(result.status, "unavailable");
		assert.ok(result.reason);
	}
	const result = await collectCrux("https://example.com", "desktop", "url", {
		apiKey: "secret",
		fetcher: async () => {
			throw new Error("secret-bearing request");
		},
	});
	assert.ok(!JSON.stringify(result).includes("secret"));
});
