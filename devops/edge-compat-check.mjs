#!/usr/bin/env node
/**
 * edge-compat-check.mjs — differential compatibility validation for the
 * issue #2508 edge candidate: an isolated CloudFront distribution placed in
 * front of the nginx router with caching disabled and every viewer
 * header/cookie/query forwarded (see docs/aws/edge-rollout-validation.md and
 * docs/aws/cloudformation/cloudfront-edge-candidate.yaml).
 *
 * Three check groups:
 *  1. baseline  — asserts today's documented semantics on every public host
 *                 (.co.il/.com, bare/www/api/admin, http/https). If these fail,
 *                 production drifted and the candidate diff is meaningless.
 *  2. paired    — the same request against the direct origin (--base) and the
 *                 candidate (--candidate): status, normalized Location,
 *                 content-type, cache-control, etag, vary, content-encoding,
 *                 CORS and set-cookie parity must match. HTML responses also
 *                 compare <title> and <link rel="canonical">; byte hashes are
 *                 reported and enforced on deterministic payloads
 *                 (robots.txt, sitemap.xml).
 *  3. edge      — candidate-only assertions: x-amz-cf-id present, x-cache is
 *                 never Hit, a repeated 404 is still a Miss, POST/OPTIONS are
 *                 forwarded, and a Range request matches the origin's answer.
 *
 * Usage:
 *   node devops/edge-compat-check.mjs --candidate https://<id>.cloudfront.net \
 *        [--base https://xn--febl3a.co.il] [--json]
 *
 * Request budget: sequential requests only, ~60 per side, well under the
 * crawler rate limits in router.conf. Run from a recorded vantage point.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USER_AGENT = "edge-compat-check/1.0 (bible-on-site #2508)";

/** Response headers compared verbatim between base and candidate. */
const COMPARE_HEADERS = [
	"content-type",
	"cache-control",
	"etag",
	"vary",
	"content-encoding",
	"access-control-allow-origin",
	"x-robots-tag",
	"content-language",
	"strict-transport-security",
	"content-range",
];

/**
 * Public-host baseline (#3 of the issue): today's semantics, asserted exactly
 * where router.conf defines them and recorded as evidence elsewhere.
 * `location` expectations are the complete Location value.
 */
const BASELINE_HOSTS = [
	{
		name: "http apex co.il -> https",
		url: "http://xn--febl3a.co.il/",
		status: 301,
		location: "https://xn--febl3a.co.il/",
	},
	{
		name: "http apex com -> https",
		url: "http://xn--febl3a.com/",
		status: 301,
		location: "https://xn--febl3a.com/",
	},
	{
		name: "http www co.il -> https bare",
		url: "http://www.xn--febl3a.co.il/",
		status: 301,
		location: "https://xn--febl3a.co.il/",
	},
	{
		name: "http www com -> https bare",
		url: "http://www.xn--febl3a.com/",
		status: 301,
		location: "https://xn--febl3a.com/",
	},
	{
		name: "https www co.il -> bare",
		url: "https://www.xn--febl3a.co.il/",
		status: 301,
		location: "https://xn--febl3a.co.il/",
	},
	{
		name: "https www com -> bare",
		url: "https://www.xn--febl3a.com/",
		status: 301,
		location: "https://xn--febl3a.com/",
	},
	{ name: "https apex com", url: "https://xn--febl3a.com/", status: 200 },
	{ name: "https apex co.il", url: "https://xn--febl3a.co.il/", status: 200 },
	{
		name: "api co.il health",
		url: "https://api.xn--febl3a.co.il/health",
		status: 200,
	},
	{
		name: "api com health",
		url: "https://api.xn--febl3a.com/health",
		status: 200,
	},
	{
		name: "http api co.il -> https",
		url: "http://api.xn--febl3a.co.il/health",
		status: 301,
		location: "https://api.xn--febl3a.co.il/health",
	},
	{
		name: "http api com -> https",
		url: "http://api.xn--febl3a.com/health",
		status: 301,
		location: "https://api.xn--febl3a.com/health",
	},
	{
		name: "http admin co.il -> https",
		url: "http://admin.xn--febl3a.co.il/",
		status: 301,
		location: "https://admin.xn--febl3a.co.il/",
	},
	{
		name: "http admin com -> https",
		url: "http://admin.xn--febl3a.com/",
		status: 301,
		location: "https://admin.xn--febl3a.com/",
	},
	// Admin is session-gated; reachability (not a specific status) is the
	// evidence — the admin subdomain is never routed through the edge.
	{
		name: "admin co.il reachable",
		url: "https://admin.xn--febl3a.co.il/",
		statusBelow: 500,
	},
	{
		name: "admin com reachable",
		url: "https://admin.xn--febl3a.com/",
		statusBelow: 500,
	},
];

/**
 * Paired cases: identical request on base and candidate. `location` expects
 * the normalized target (path+query). `bodyEqual: true` requires identical
 * bytes (deterministic SSG payloads). Everything else reports byte equality
 * as evidence and fails on semantic drift only.
 */
const PAIRED_CASES = [
	{ name: "homepage", path: "/" },
	{ name: "homepage with book param", path: "/?book" },
	{
		name: "trailing-slash normalization",
		path: "/929/315/",
		status: 308,
		location: "/929/315",
	},
	{ name: "perek page", path: "/929/315" },
	{
		name: "commentary (percent-encoded Hebrew + quote)",
		path: "/929/315/%D7%A8%D7%A9%22%D7%99",
	},
	{
		name: "commentary (raw Hebrew request target)",
		path: "/929/315/רש\"י",
	},
	{
		name: "query normalization",
		path: "/929/27/?book",
		status: 308,
		location: "/929/27?book=",
	},
	{ name: "book mode", path: "/929/1?book" },
	{ name: "book chrome page", path: "/929/1?book&bookPage=toc" },
	{ name: "RSC navigation variant", path: "/929/315?_rsc=edge1" },
	{
		name: "RSC prefetch request",
		path: "/929/315",
		headers: { RSC: "1", "Next-Router-Prefetch": "1" },
	},
	{ name: "Hebrew rewrite (raw)", path: "/לוח" },
	{
		name: "Hebrew rewrite (percent-encoded)",
		path: "/%D7%9C%D7%95%D7%97",
	},
	{
		name: "canonical redirect /calendar",
		path: "/calendar",
		locationSuffix: "/%D7%9C%D7%95%D7%97",
	},
	{
		name: "legacy /authors redirect",
		path: "/authors",
		locationSuffix: "/929/authors",
	},
	{ name: "authors listing", path: "/929/authors" },
	{ name: "rabbis alias rewrite", path: "/929/rabbis" },
	{
		name: "legacy tanahpedia redirect",
		path: "/tanahpedia/entry/compat-check",
		locationSuffix: "/pedia/compat-check",
	},
	{ name: "masora root (raw Hebrew)", path: "/מסורה" },
	{
		name: "parasha root (percent-encoded)",
		path: "/%D7%A4%D7%A8%D7%A9%D7%94",
	},
	{ name: "accessibility", path: "/accessibility" },
	{ name: "search (Hebrew query)", path: "/search?q=%D7%90%D7%91" },
	{ name: "robots.txt", path: "/robots.txt", bodyEqual: true },
	{ name: "sitemap.xml", path: "/sitemap.xml", bodyEqual: true },
	{ name: "favicon", path: "/favicon.ico", bodyEqual: true },
	{ name: "health", path: "/api/health" },
	{ name: "readiness", path: "/api/health/ready" },
	{
		name: "missing page is a real 404",
		path: "/no-such-page-edge-compat",
		status: 404,
	},
	{
		name: "cookie probe (no session variance)",
		path: "/",
		headers: { Cookie: "edge-compat-probe=1" },
	},
	{
		name: "CORS preflight",
		path: "/api/health",
		method: "OPTIONS",
		headers: {
			Origin: "https://edge-compat.invalid",
			"Access-Control-Request-Method": "GET",
		},
	},
	{
		name: "POST forwarded uncached",
		path: "/api/health",
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	},
];

function sha256(buf) {
	return createHash("sha256").update(buf).digest("hex");
}

/** Quote a scalar for messages without JSON.stringify key-ordering concerns. */
function show(value) {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	return `"${String(value)}"`;
}

/** Read a response into a comparable record; body always consumed. */
async function probe(url, { method = "GET", headers = {}, body } = {}) {
	const started = performance.now();
	// Fetch a parsed URL object, not a raw string — the parse boundary is the
	// contract (same shape verify-public-content.mjs uses); origins are
	// scheme/host-validated by parseOrigin before any request runs.
	const response = await fetch(new URL(url), {
		method,
		redirect: "manual",
		body,
		signal: AbortSignal.timeout(30_000),
		headers: { "user-agent": USER_AGENT, ...headers },
	});
	const buf = Buffer.from(await response.arrayBuffer());
	const picked = {};
	for (const name of COMPARE_HEADERS) picked[name] = response.headers.get(name);
	return {
		url,
		status: response.status,
		location: response.headers.get("location"),
		headers: picked,
		setCookies: response.headers.getSetCookie(),
		xAmzCfId: response.headers.get("x-amz-cf-id"),
		xCache: response.headers.get("x-cache"),
		via: response.headers.get("via"),
		bytes: buf.length,
		sha256: sha256(buf),
		ms: Math.round(performance.now() - started),
		body: buf,
	};
}

/**
 * True when a Location value is an absolute URI or protocol-relative
 * reference (carries its own host). Anything else is a relative reference
 * resolved against the request URL.
 */
export function isAbsoluteLocation(location) {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(location) || location.startsWith("//");
}

/**
 * Normalize a Location header to path+query+hash. Relative references
 * resolve against the request URL. Host equality is asserted separately
 * for absolute targets — an edge must not redirect to a different site.
 */
export function normalizeLocation(location, requestUrl) {
	if (!location) return null;
	const resolved = new URL(location, requestUrl);
	return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * Stable signature of a Set-Cookie header: cookie name plus normalized
 * attribute list. The Expires date value is normalized out — it
 * legitimately drifts per request when a lifetime is absolute — and the
 * cookie's own value is excluded because per-request session data is
 * allowed to differ; attribute changes (Path/Domain/SameSite/Secure/
 * HttpOnly/Max-Age) are the contract an edge must preserve.
 */
export function cookieSignature(setCookie) {
	const [pair, ...rest] = setCookie.split(";");
	const name = pair.split("=")[0].trim();
	const attrs = rest
		.map((attr) => attr.trim())
		.filter(Boolean)
		.map((attr) => {
			const eq = attr.indexOf("=");
			const key = (eq === -1 ? attr : attr.slice(0, eq)).toLowerCase();
			if (key === "expires" || eq === -1) return key;
			return `${key}=${attr.slice(eq + 1)}`;
		})
		.sort();
	return `${name};${attrs.join(";")}`;
}

/** Extract <link rel="canonical" href="..."> path+query from HTML bytes. */
export function canonicalHref(buf) {
	const match = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(
		buf.toString("utf8"),
	);
	if (!match) return null;
	const resolved = new URL(match[1], "https://placeholder.invalid");
	return `${resolved.pathname}${resolved.search}`;
}

/** Extract <title>...</title> text from HTML bytes. */
export function titleText(buf) {
	const match = /<title[^>]*>([^<]*)<\/title>/.exec(buf.toString("utf8"));
	return match ? match[1] : null;
}

const isHtml = (record) =>
	(record.headers["content-type"] ?? "").startsWith("text/html");

/**
 * Compare a base/candidate probe pair. Returns a list of findings; each
 * finding is { level: "fail" | "note", detail }. Empty means identical
 * semantics.
 */
export function comparePair(base, candidate, { bodyEqual = false } = {}) {
	const findings = [];
	const fail = (detail) => findings.push({ level: "fail", detail });
	const note = (detail) => findings.push({ level: "note", detail });

	if (base.xAmzCfId) {
		fail(
			"base response carries x-amz-cf-id — --base is already behind an edge; parity is meaningless",
		);
	}
	if (candidate.status !== base.status) {
		fail(`status ${candidate.status} != ${base.status}`);
	}
	const baseLoc = normalizeLocation(base.location, base.url);
	const candLoc = normalizeLocation(candidate.location, candidate.url);
	if (candLoc !== baseLoc) {
		fail(`location ${show(candLoc)} != ${show(baseLoc)}`);
	}
	if (base.location !== null && candidate.location !== null) {
		const baseAbs = isAbsoluteLocation(base.location);
		const candAbs = isAbsoluteLocation(candidate.location);
		if (baseAbs !== candAbs) {
			fail(
				`redirect form drift: base Location is ${baseAbs ? "absolute" : "relative"}, ` +
					`candidate's is ${candAbs ? "absolute" : "relative"}`,
			);
		} else if (
			baseAbs &&
			new URL(base.location, base.url).host !==
				new URL(candidate.location, candidate.url).host
		) {
			fail(
				`redirect host drift: candidate sends ${new URL(candidate.location, candidate.url).host}, ` +
					`base sends ${new URL(base.location, base.url).host}`,
			);
		}
	}
	for (const name of COMPARE_HEADERS) {
		if (candidate.headers[name] !== base.headers[name]) {
			fail(
				`header ${name} ${show(candidate.headers[name])} != ` +
					show(base.headers[name]),
			);
		}
	}
	if (candidate.setCookies.length !== base.setCookies.length) {
		fail(
			`set-cookie count ${candidate.setCookies.length} != ${base.setCookies.length}`,
		);
	} else {
		for (let i = 0; i < base.setCookies.length; i += 1) {
			const baseSig = cookieSignature(base.setCookies[i]);
			const candSig = cookieSignature(candidate.setCookies[i]);
			if (candSig !== baseSig) {
				fail(`set-cookie[${i}] ${show(candSig)} != ${show(baseSig)}`);
			} else if (candidate.setCookies[i] !== base.setCookies[i]) {
				note(
					`set-cookie[${i}] value differs with identical attributes — ` +
						"expected for per-request session data",
				);
			}
		}
	}
	if (isHtml(base) && isHtml(candidate)) {
		if (canonicalHref(candidate.body) !== canonicalHref(base.body)) {
			fail(
				`canonical ${show(canonicalHref(candidate.body))} != ` +
					show(canonicalHref(base.body)),
			);
		}
		if (titleText(candidate.body) !== titleText(base.body)) {
			fail(
				`title ${show(titleText(candidate.body))} != ` +
					show(titleText(base.body)),
			);
		}
	}
	if (candidate.sha256 !== base.sha256) {
		(bodyEqual ? fail : note)(
			`body differs (sha256 ${candidate.sha256.slice(0, 12)} != ` +
				`${base.sha256.slice(0, 12)}, ${candidate.bytes} vs ${base.bytes} bytes)`,
		);
	}
	return findings;
}

/** Candidate-only assertions: the response really transited the edge. */
export function edgeFindings(candidate) {
	const findings = [];
	if (!candidate.xAmzCfId) {
		findings.push({
			level: "fail",
			detail: "missing x-amz-cf-id — request did not transit CloudFront",
		});
	}
	const cache = (candidate.xCache ?? "").toLowerCase();
	if (cache.includes("hit")) {
		findings.push({
			level: "fail",
			detail: `x-cache is ${show(candidate.xCache)} — caching must stay disabled during validation`,
		});
	}
	return findings;
}

async function runBaseline() {
	const results = [];
	for (const check of BASELINE_HOSTS) {
		try {
			const record = await probe(check.url);
			const location = record.location ?? null;
			let ok =
				check.statusBelow !== undefined
					? record.status < check.statusBelow
					: record.status === check.status;
			if (ok && check.location !== undefined) {
				ok = location === check.location;
			}
			results.push({
				name: check.name,
				url: check.url,
				ok,
				status: record.status,
				location,
				ms: record.ms,
			});
		} catch (error) {
			results.push({
				name: check.name,
				url: check.url,
				ok: false,
				error: String(error),
			});
		}
	}
	return results;
}

async function runPaired(base, candidate) {
	const results = [];
	for (const check of PAIRED_CASES) {
		const request = {
			method: check.method ?? "GET",
			headers: check.headers ?? {},
			body: check.body,
		};
		const baseRecord = await probe(new URL(check.path, base).href, request);
		const candRecord = await probe(
			new URL(check.path, candidate).href,
			request,
		);
		const findings = comparePair(baseRecord, candRecord, {
			bodyEqual: check.bodyEqual,
		});
		findings.push(...edgeFindings(candRecord));

		// Explicit expectations (status/location) on top of parity.
		if (check.status !== undefined && candRecord.status !== check.status) {
			findings.push({
				level: "fail",
				detail: `expected status ${check.status}, got ${candRecord.status}`,
			});
		}
		const candLoc = normalizeLocation(candRecord.location, candRecord.url);
		if (check.location !== undefined && candLoc !== check.location) {
			findings.push({
				level: "fail",
				detail: `expected location ${check.location}, got ${show(candLoc)}`,
			});
		}
		if (
			check.locationSuffix !== undefined &&
			(candLoc === null || !candLoc.endsWith(check.locationSuffix))
		) {
			findings.push({
				level: "fail",
				detail: `expected location ending ${check.locationSuffix}, got ${show(candLoc)}`,
			});
		}
		results.push({
			name: check.name,
			path: check.path,
			ok: !findings.some((f) => f.level === "fail"),
			findings,
			base: summarize(baseRecord),
			candidate: summarize(candRecord),
		});
	}
	return results;
}

function summarize(record) {
	return {
		status: record.status,
		location: normalizeLocation(record.location, record.url),
		bytes: record.bytes,
		ms: record.ms,
		xCache: record.xCache,
	};
}

/** Repeat a missing path twice: a 404 must stay a Miss when caching is off. */
async function runNegativeCacheCheck(candidate) {
	const path_ = `/edge-compat-missing-${Date.now()}`;
	const first = await probe(new URL(path_, candidate).href);
	const second = await probe(new URL(path_, candidate).href);
	const findings = [];
	for (const [label, record] of [
		["first", first],
		["second", second],
	]) {
		if (record.status !== 404) {
			findings.push({
				level: "fail",
				detail: `${label} request: expected 404, got ${record.status}`,
			});
		}
		findings.push(
			...edgeFindings(record).map((f) => ({
				...f,
				detail: `${label} request: ${f.detail}`,
			})),
		);
	}
	return {
		name: "negative response not cached",
		path: path_,
		ok: !findings.some((f) => f.level === "fail"),
		findings,
		candidate: [summarize(first), summarize(second)],
	};
}

/**
 * First `/_next/static/...` asset reference in an HTML body, without a regex
 * over remote input — scan the marker then read until the closing quote.
 */
export function nextStaticAssetPath(html) {
	const marker = "/_next/static/";
	const start = html.indexOf(marker);
	if (start === -1) return null;
	const rest = html.slice(start);
	let end = rest.length;
	for (const stop of ['"', "'", " ", "\\"]) {
		const index = rest.indexOf(stop);
		if (index > 0 && index < end) end = index;
	}
	return rest.slice(0, end);
}

/** Byte-range parity on a discovered hashed static asset. */
async function runRangeCheck(base, candidate) {
	const homepage = await probe(new URL("/", base).href);
	const assetPath = nextStaticAssetPath(homepage.body.toString("utf8"));
	if (!assetPath) {
		return {
			name: "byte-range parity",
			ok: true,
			findings: [
				{
					level: "note",
					detail: "no /_next/static asset discovered on the base homepage — range parity skipped",
				},
			],
		};
	}
	const request = { headers: { Range: "bytes=0-31" } };
	const baseRecord = await probe(new URL(assetPath, base).href, request);
	const candRecord = await probe(new URL(assetPath, candidate).href, request);
	const findings = comparePair(baseRecord, candRecord, { bodyEqual: true });
	findings.push(...edgeFindings(candRecord));
	// A 206 without a matching Content-Range (or wrong length) is a broken
	// range answer even when the body bytes happen to match.
	for (const [label, record] of [
		["base", baseRecord],
		["candidate", candRecord],
	]) {
		if (record.status !== 206) continue;
		if (!(record.headers["content-range"] ?? "").startsWith("bytes 0-31/")) {
			findings.push({
				level: "fail",
				detail: `${label} answered 206 with Content-Range ${show(record.headers["content-range"])} — expected bytes 0-31/...`,
			});
		}
		if (record.bytes !== 32) {
			findings.push({
				level: "fail",
				detail: `${label} answered 206 but served ${record.bytes} bytes for bytes=0-31`,
			});
		}
	}
	return {
		name: `byte-range parity (${assetPath.slice(0, 60)})`,
		path: assetPath,
		ok: !findings.some((f) => f.level === "fail"),
		findings,
		base: summarize(baseRecord),
		candidate: summarize(candRecord),
	};
}

async function main() {
	const args = process.argv.slice(2);
	const flagValue = (flag) => {
		const index = args.indexOf(flag);
		return index >= 0 ? args[index + 1] : undefined;
	};
	const candidate = flagValue("--candidate");
	if (!candidate) {
		throw new Error(
			"Usage: node devops/edge-compat-check.mjs --candidate https://<id>.cloudfront.net [--base https://xn--febl3a.co.il] [--json]",
		);
	}
	// Origins must be plain http(s) URLs — this also rejects credentials,
	// paths and odd schemes before any request is made.
	const parseOrigin = (value, flag) => {
		const parsed = new URL(value);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			throw new Error(`${flag} must be an http(s) origin, got ${value}`);
		}
		if (parsed.username || parsed.password) {
			throw new Error(`${flag} must not contain credentials`);
		}
		return parsed.origin;
	};
	const base = parseOrigin(
		flagValue("--base") ?? "https://xn--febl3a.co.il",
		"--base",
	);
	const candidateOrigin = parseOrigin(candidate, "--candidate");
	const asJson = args.includes("--json");

	const report = {
		generated_at: new Date().toISOString(),
		base,
		candidate: candidateOrigin,
		baseline: await runBaseline(),
		paired: await runPaired(base, candidateOrigin),
		negative_cache: await runNegativeCacheCheck(candidateOrigin),
		range: await runRangeCheck(base, candidateOrigin),
	};

	const baselineFails = report.baseline.filter((r) => !r.ok);
	const pairedFails = report.paired.filter((r) => !r.ok);
	const edgeFailList = [report.negative_cache, report.range].filter(
		(r) => !r.ok,
	);
	const failures = baselineFails.length + pairedFails.length + edgeFailList.length;

	if (asJson) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(
			`# Edge compatibility check (${report.generated_at})\nbase=${base} candidate=${candidateOrigin}`,
		);
		console.log("\n## Baseline public hosts");
		for (const r of report.baseline) {
			console.log(
				`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}  -> ${r.status ?? r.error}` +
					(r.location ? `  location=${r.location}` : "") +
					(r.ms !== undefined ? `  ${r.ms}ms` : ""),
			);
		}
		console.log("\n## Paired cases (origin vs candidate)");
		for (const r of report.paired) {
			console.log(
				`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}\n      base=${r.base.status} ${r.base.bytes}B ${r.base.ms}ms  ` +
					`edge=${r.candidate.status} ${r.candidate.bytes}B ${r.candidate.ms}ms (${r.candidate.xCache ?? "no x-cache"})`,
			);
			for (const f of r.findings) console.log(`      ${f.level}: ${f.detail}`);
		}
		console.log("\n## Candidate-only checks");
		for (const r of [report.negative_cache, report.range]) {
			console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
			for (const f of r.findings) console.log(`      ${f.level}: ${f.detail}`);
		}
		console.log(`\n${failures} failure(s)`);
	}
	if (failures > 0) process.exit(1);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	await main();
}
