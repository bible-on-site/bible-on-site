#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = "https://bible-on-site-assets.s3.il-central-1.amazonaws.com";
const SAMPLE_KEYS = ["authors/high-res/1.jpg", "recordings/100_record.mp3", "blessing/blessing-poster.webp", "generated/calendar-pdf/manifest.json"];
const HEADERS = ["content-type", "content-encoding", "cache-control", "etag", "content-range", "accept-ranges", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers"];

function cases() {
	const checks = SAMPLE_KEYS.flatMap((key) => [
		{ name: "metadata", key, method: "HEAD", status: 200 },
		{ name: "range without Origin", key, headers: { Range: "bytes=0-31" }, status: 206 },
		{ name: "range with Origin", key, headers: { Range: "bytes=0-31", Origin: "https://xn--febl3a.co.il" }, status: 206 },
		{ name: "preflight", key, method: "OPTIONS", headers: { Origin: "https://xn--febl3a.co.il", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" }, status: 200 },
	]);
	checks.push({ name: "query forwarding", key: SAMPLE_KEYS[0], method: "HEAD", query: "?versionId=assets-cdn-invalid-version", rejectedQuery: true });
	const missing = `assets-cdn-check-missing-${Date.now()}`;
	checks.push({ name: "missing object first", key: missing, missing: true }, { name: "missing object repeated", key: missing, missing: true });
	return checks;
}

async function probe(origin, check, fetcher) {
	const key = check.key.split("/").map(encodeURIComponent).join("/");
	const response = await fetcher(new URL(`/${key}${check.query ?? ""}`, origin), {
		method: check.method ?? "GET", headers: check.headers, redirect: "manual", signal: AbortSignal.timeout(15_000),
	});
	let bytes;
	if (check.status === 206 && response.status !== 206) {
		// Abort a server that ignored Range before it sends a complete large file.
		await response.body?.cancel();
		bytes = Buffer.alloc(0);
	} else bytes = Buffer.from(await response.arrayBuffer());
	return { status: response.status, headers: Object.fromEntries(HEADERS.map((name) => [name, response.headers.get(name)])), age: response.headers.get("age"), edgeId: response.headers.get("x-amz-cf-id"), cache: response.headers.get("x-cache"), bytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") };
}

export function compareAsset(base, candidate, check) {
	const failures = [];
	if (base.edgeId) failures.push("Source already transits CloudFront");
	if (!candidate.edgeId) failures.push("Candidate did not transit CloudFront");
	if (candidate.age !== null || /hit/i.test(candidate.cache ?? "")) failures.push("Candidate has cache evidence; caching must remain disabled");
	if (base.status !== candidate.status) failures.push(`Status drift: ${candidate.status} != ${base.status}`);
	if (check.status && base.status !== check.status) failures.push(`Source sample needs status ${check.status}, got ${base.status}`);
	if (check.missing && ![403, 404].includes(base.status)) failures.push("Source missing-object request was not rejected");
	if (check.rejectedQuery && ![400, 403, 404].includes(base.status)) failures.push("Source did not reject the invalid version query; forwarding is unproven");
	// S3 error documents include request-specific IDs. Compare status and cache
	// evidence for errors; compare headers and exact range bytes for successes.
	if (base.status < 400 && candidate.status < 400) {
		for (const name of HEADERS) if (base.headers[name] !== candidate.headers[name]) failures.push(`Header drift: ${name}`);
		if (base.hash !== candidate.hash) failures.push("Response bytes differ");
		if (check.status === 206 && (base.bytes !== 32 || candidate.bytes !== 32 || !/^bytes 0-31\/\d+$/.test(candidate.headers["content-range"] ?? ""))) failures.push("Invalid 32-byte range response");
		if (check.headers?.Origin && !["*", check.headers.Origin].includes(base.headers["access-control-allow-origin"])) failures.push("Source CORS does not permit the viewer origin");
		if (check.method === "OPTIONS") {
			const methods = (base.headers["access-control-allow-methods"] ?? "").split(",").map((value) => value.trim().toUpperCase());
			const headers = (base.headers["access-control-allow-headers"] ?? "").split(",").map((value) => value.trim().toLowerCase());
			if (!methods.includes("GET") || (!headers.includes("*") && !headers.includes("range"))) failures.push("Source preflight does not permit GET with Range");
		}
	}
	return failures;
}

/** Read-only, small range probes; never downloads a complete recording/video. */
export async function checkAssets(candidate, { source = SOURCE, fetcher = fetch } = {}) {
	const results = [];
	for (const check of cases()) {
		try {
			const base = await probe(source, check, fetcher);
			const edge = await probe(candidate, check, fetcher);
			const failures = compareAsset(base, edge, check);
			results.push({ name: check.name, key: check.key, ok: failures.length === 0, baseStatus: base.status, candidateStatus: edge.status, xCache: edge.cache, age: edge.age, failures });
		} catch (error) {
			results.push({ name: check.name, key: check.key, ok: false, failures: [`Probe failed: ${error.name}`] });
		}
	}
	return { generatedAt: new Date().toISOString(), source, candidate, ok: results.every((result) => result.ok), results };
}

export async function main(args = process.argv.slice(2), { run = checkAssets, write = console.log } = {}) {
	if (args.length !== 2 || args[0] !== "--candidate") throw new Error("Usage: node devops/assets-cdn-check.mjs --candidate https://DISTRIBUTION.cloudfront.net");
	const url = new URL(args[1]);
	if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudfront.net") || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error("Candidate must be a bare HTTPS CloudFront origin");
	const report = await run(url.origin);
	write(JSON.stringify(report, null, 2));
	return report.ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
