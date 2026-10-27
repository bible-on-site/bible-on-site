import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	canonicalHref,
	comparePair,
	cookieSignature,
	edgeFindings,
	isAbsoluteLocation,
	nextStaticAssetPath,
	normalizeLocation,
	titleText,
} from "./edge-compat-check.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Minimal probe record; overrides model the response under test. */
function record(overrides = {}) {
	const body = Buffer.from(
		overrides.body ?? '<html><head><title>t</title></head></html>',
	);
	return {
		url: "https://xn--febl3a.co.il/x",
		status: 200,
		location: null,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": null,
			etag: '"abc"',
			vary: "RSC, Next-Router-Prefetch",
			"content-encoding": null,
			"access-control-allow-origin": null,
			"x-robots-tag": null,
			"content-language": null,
			"strict-transport-security": null,
			"content-range": null,
		},
		setCookies: [],
		xAmzCfId: null,
		xCache: null,
		via: null,
		bytes: body.length,
		sha256: sha256(body),
		ms: 10,
		...overrides,
		body, // always a Buffer regardless of overrides.body's type
	};
}

/** Candidate-side record: same payload seen through the distribution. */
function edge(overrides = {}) {
	return record({
		url: "https://d1234abcdef.cloudfront.net/x",
		xAmzCfId: "edge-request-id",
		xCache: "Miss from cloudfront",
		...overrides,
	});
}

const fails = (findings) => findings.filter((f) => f.level === "fail");

test("normalizeLocation", async (t) => {
	await t.test("returns null for no Location header", () => {
		assert.equal(normalizeLocation(null, "https://a/x"), null);
	});
	await t.test("keeps relative targets as path+query", () => {
		assert.equal(
			normalizeLocation("/929/27?book=", "https://a/929/27/?book"),
			"/929/27?book=",
		);
	});
	await t.test("strips the host from absolute targets", () => {
		assert.equal(
			normalizeLocation(
				"https://xn--febl3a.co.il/929/1?book",
				"https://www.xn--febl3a.co.il/929/1",
			),
			"/929/1?book",
		);
		assert.equal(
			normalizeLocation(
				"https://d1234abcdef.cloudfront.net/929/1?book",
				"https://d1234abcdef.cloudfront.net/929/1",
			),
			"/929/1?book",
		);
	});
});

test("canonicalHref", async (t) => {
	await t.test("extracts path+query from an absolute canonical", () => {
		const html = Buffer.from(
			'<link rel="canonical" href="https://xn--febl3a.co.il/929/315?x=1">',
		);
		assert.equal(canonicalHref(html), "/929/315?x=1");
	});
	await t.test("extracts a relative canonical", () => {
		assert.equal(
			canonicalHref(Buffer.from('<link rel="canonical" href="/929/315">')),
			"/929/315",
		);
	});
	await t.test("returns null without a canonical", () => {
		assert.equal(canonicalHref(Buffer.from("<p>none</p>")), null);
	});
});

test("titleText", async (t) => {
	await t.test("extracts the title text", () => {
		assert.equal(
			titleText(Buffer.from("<head><title>דף הבית</title></head>")),
			"דף הבית",
		);
	});
	await t.test("returns null without a title", () => {
		assert.equal(titleText(Buffer.from("<p>none</p>")), null);
	});
});

test("comparePair", async (t) => {
	await t.test("passes identical responses", () => {
		assert.equal(comparePair(record(), edge()).length, 0);
	});

	await t.test("fails on status drift", () => {
		const findings = comparePair(record(), edge({ status: 500 }));
		assert.ok(
			fails(findings).some((f) => f.detail.includes("status 500 != 200")),
		);
	});

	await t.test("passes when absolute redirects keep the same host", () => {
		// With the candidate's Host-override origin policy the origin sees
		// the same Host on both legs, so absolute redirects must keep the
		// canonical host — not drift to the cloudfront.net name.
		const base = record({
			status: 308,
			location: "https://xn--febl3a.co.il/929/27?book=",
		});
		const cand = edge({
			status: 308,
			location: "https://xn--febl3a.co.il/929/27?book=",
		});
		assert.equal(comparePair(base, cand).length, 0);
	});

	await t.test("fails when an absolute redirect drifts to another host", () => {
		const findings = comparePair(
			record({
				status: 308,
				location: "https://xn--febl3a.co.il/929/27?book=",
			}),
			edge({
				status: 308,
				location: "https://d1234abcdef.cloudfront.net/929/27?book=",
			}),
		);
		assert.ok(
			fails(findings).some((f) => f.detail.includes("host drift")),
		);
	});

	await t.test("fails when redirect form drifts (absolute vs relative)", () => {
		const findings = comparePair(
			record({
				status: 308,
				location: "https://xn--febl3a.co.il/929/27?book=",
			}),
			edge({ status: 308, location: "/929/27?book=" }),
		);
		assert.ok(
			fails(findings).some((f) => f.detail.includes("form drift")),
		);
	});

	await t.test("fails on redirect-target drift", () => {
		const findings = comparePair(
			record({ status: 308, location: "/929/315" }),
			edge({ status: 308, location: "/929/316" }),
		);
		assert.ok(fails(findings).some((f) => f.detail.includes("location")));
	});

	await t.test("fails on vary drift (cache-key isolation evidence)", () => {
		const findings = comparePair(
			record(),
			edge({ headers: { ...record().headers, vary: null } }),
		);
		assert.ok(fails(findings).some((f) => f.detail.includes("vary")));
	});

	await t.test("fails on canonical drift even when bytes differ anyway", () => {
		const body =
			'<html><head><link rel="canonical" href="/929/316"><title>t</title></head></html>';
		const findings = comparePair(record(), edge({ body }));
		assert.ok(fails(findings).some((f) => f.detail.includes("canonical")));
	});

	await t.test("reports body drift as a note unless byte equality is required", () => {
		// Same title/canonical, different body bytes — semantic parity holds.
		const body =
			'<html><head><title>t</title></head><body>variant</body></html>';
		const loose = comparePair(record(), edge({ body }));
		assert.equal(fails(loose).length, 0);
		assert.ok(loose.some((f) => f.level === "note"));
		const strict = comparePair(record(), edge({ body }), {
			bodyEqual: true,
		});
		assert.ok(fails(strict).some((f) => f.detail.includes("body differs")));
	});

	await t.test("fails when the base itself sits behind an edge", () => {
		const findings = comparePair(
			record({ xAmzCfId: "unexpected" }),
			edge(),
		);
		assert.ok(fails(findings).some((f) => f.detail.includes("x-amz-cf-id")));
	});

	await t.test("fails on set-cookie count drift", () => {
		const findings = comparePair(
			record({ setCookies: ["s=1; HttpOnly"] }),
			edge({ setCookies: [] }),
		);
		assert.ok(fails(findings).some((f) => f.detail.includes("set-cookie")));
	});

	await t.test("fails when a set-cookie attribute drifts at equal count", () => {
		const findings = comparePair(
			record({ setCookies: ["s=1; Path=/; Secure; HttpOnly"] }),
			edge({ setCookies: ["s=1; Path=/; HttpOnly"] }),
		);
		assert.ok(fails(findings).some((f) => f.detail.includes("set-cookie[0]")));
	});

	await t.test("notes value-only cookie drift as session variance", () => {
		const findings = comparePair(
			record({ setCookies: ["s=abc; Path=/; HttpOnly"] }),
			edge({ setCookies: ["s=def; Path=/; HttpOnly"] }),
		);
		assert.equal(fails(findings).length, 0);
		assert.ok(findings.some((f) => f.level === "note"));
	});

	await t.test("fails on content-range drift", () => {
		const findings = comparePair(
			record({ headers: { ...record().headers, "content-range": "bytes 0-31/100" } }),
			edge({ headers: { ...record().headers, "content-range": null } }),
		);
		assert.ok(
			fails(findings).some((f) => f.detail.includes("content-range")),
		);
	});
});

test("isAbsoluteLocation", async (t) => {
	await t.test("detects absolute and protocol-relative targets", () => {
		assert.equal(isAbsoluteLocation("https://a/x"), true);
		assert.equal(isAbsoluteLocation("//a/x"), true);
	});
	await t.test("rejects relative targets", () => {
		assert.equal(isAbsoluteLocation("/x"), false);
		assert.equal(isAbsoluteLocation("x?y=1"), false);
	});
});

test("cookieSignature", async (t) => {
	await t.test("normalizes away the Expires date value", () => {
		assert.equal(
			cookieSignature("s=1; Expires=Wed, 01 Jan 2030 00:00:00 GMT; Path=/"),
			cookieSignature("s=1; Expires=Thu, 02 Jan 2031 00:00:00 GMT; Path=/"),
		);
	});
	await t.test("keeps name and attributes, drops the value", () => {
		assert.equal(
			cookieSignature("sess=abc; Path=/; Secure"),
			"sess;path=/;secure",
		);
	});
});

test("nextStaticAssetPath", async (t) => {
	await t.test("extracts a script src asset path", () => {
		const html =
			'<html><head><script src="/_next/static/chunks/main-abc123.js" defer></script></head></html>';
		assert.equal(
			nextStaticAssetPath(html),
			"/_next/static/chunks/main-abc123.js",
		);
	});
	await t.test("extracts a single-quoted link asset path", () => {
		const html = "<link rel='preload' href='/_next/static/media/f.woff'>";
		assert.equal(nextStaticAssetPath(html), "/_next/static/media/f.woff");
	});
	await t.test("returns null without a static asset", () => {
		assert.equal(nextStaticAssetPath("<p>no assets</p>"), null);
	});
});

test("edgeFindings", async (t) => {
	await t.test("passes a real uncached edge response", () => {
		assert.equal(edgeFindings(edge()).length, 0);
	});
	await t.test("fails without CloudFront evidence", () => {
		assert.ok(
			fails(edgeFindings(record())).some((f) =>
				f.detail.includes("x-amz-cf-id"),
			),
		);
	});
	await t.test("fails on an edge cache hit", () => {
		assert.ok(
			fails(edgeFindings(edge({ xCache: "Hit from cloudfront" }))).some(
				(f) => f.detail.includes("Hit"),
			),
		);
	});
});
