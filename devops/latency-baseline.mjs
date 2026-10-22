#!/usr/bin/env node
/**
 * latency-baseline.mjs — reproducible latency baseline for GitHub issue #2394.
 *
 * Measures the same URLs the UptimeRobot monitors check, plus a small set of
 * representative variants, with a curl timing breakdown per request:
 * DNS, TCP connect, TLS handshake, TTFB and total.
 *
 * Usage:
 *   node devops/latency-baseline.mjs [--samples N] [--json]
 *
 * Request budget: ~SAMPLES (default 8) cold requests per monitor URL, one
 * keep-alive pair, and a handful of redirect/representative probes. Total
 * stays well under ~30 requests per host; run no more than needed.
 *
 * Vantage note: numbers depend on where this runs. Run it from a known
 * location and record it; UptimeRobot probes measure from their own PoPs.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const samplesFlag = args.indexOf("--samples");
const SAMPLES = samplesFlag >= 0 ? Number(args[samplesFlag + 1]) : 8;

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

const WRITE_OUT =
	"dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} " +
	"ttfb=%{time_starttransfer} total=%{time_total} code=%{response_code} " +
	"redirect=%{redirect_url} ip=%{remote_ip} ssl=%{ssl_verify_result}";

/** Monitor URLs exactly as configured in UptimeRobot (issue #2394). */
const MONITORS = [
	{ label: "website co.il (monitor)", url: "https://xn--febl3a.co.il/api/health" },
	{ label: "website com (monitor)", url: "https://xn--febl3a.com/api/health" },
	{ label: "api co.il (monitor)", url: "https://api.xn--febl3a.co.il/health" },
	{ label: "api com (monitor)", url: "https://api.xn--febl3a.com/health" },
];

/** One request each: redirect/entry-point and representative payloads. */
const VARIANTS = [
	{ label: "http apex co.il (redirect hop)", url: "http://xn--febl3a.co.il/api/health" },
	{ label: "https www co.il (www hop)", url: "https://www.xn--febl3a.co.il/api/health" },
	{ label: "homepage co.il", url: "https://xn--febl3a.co.il/" },
	{ label: "homepage com", url: "https://xn--febl3a.com/" },
	{ label: "api playground co.il", url: "https://api.xn--febl3a.co.il/" },
];

function parseWriteOut(text) {
	const fields = {};
	for (const pair of text.trim().split(/\s+/)) {
		const [k, v] = pair.split("=");
		fields[k] = v;
	}
	return {
		dns_ms: Math.round(Number(fields.dns) * 1000),
		tcp_ms: Math.round(Number(fields.tcp) * 1000),
		tls_ms: Math.round(Number(fields.tls) * 1000),
		ttfb_ms: Math.round(Number(fields.ttfb) * 1000),
		total_ms: Math.round(Number(fields.total) * 1000),
		code: fields.code,
		redirect: fields.redirect === "" ? null : fields.redirect,
		ip: fields.ip,
	};
}

async function curlOnce(url, extraArgs = []) {
	const { stdout } = await execFileAsync("curl", [
		"-sS",
		"-o",
		NULL_DEVICE,
		"-w",
		WRITE_OUT,
		"--max-time",
		"30",
		"-A",
		"latency-baseline/1.0 (research #2394)",
		...extraArgs,
		url,
	]);
	return parseWriteOut(stdout);
}

/** Two sequential GETs on one connection: [0]=cold, [1]=keep-alive reuse. */
async function curlWarmPair(url) {
	const { stdout } = await execFileAsync("curl", [
		"-sS",
		"-o",
		NULL_DEVICE,
		"-w",
		`${WRITE_OUT}\n`,
		"--max-time",
		"30",
		"-A",
		"latency-baseline/1.0 (research #2394)",
		url,
		url,
	]);
	const lines = stdout.trim().split("\n");
	return { cold: parseWriteOut(lines[0]), warm: parseWriteOut(lines[1]) };
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return { min: sorted[0], p50: pick(50), p90: pick(90), max: sorted[sorted.length - 1], mean: Math.round(mean) };
}

const report = {
	generated_at: new Date().toISOString(),
	samples_per_monitor: SAMPLES,
	monitors: {},
	warm_pairs: {},
	variants: {},
};

for (const m of MONITORS) {
	const runs = [];
	for (let i = 0; i < SAMPLES; i++) {
		runs.push(await curlOnce(m.url));
	}
	report.monitors[m.label] = {
		url: m.url,
		codes: [...new Set(runs.map((r) => r.code))],
		ttfb_ms: stats(runs.map((r) => r.ttfb_ms)),
		total_ms: stats(runs.map((r) => r.total_ms)),
		dns_ms: stats(runs.map((r) => r.dns_ms)),
		tcp_ms: stats(runs.map((r) => r.tcp_ms)),
		tls_ms: stats(runs.map((r) => r.tls_ms)),
		raw: runs,
	};
	// One keep-alive pair per monitor host.
	report.warm_pairs[m.label] = await curlWarmPair(m.url);
}

for (const v of VARIANTS) {
	report.variants[v.label] = { url: v.url, ...(await curlOnce(v.url)) };
}

if (asJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	const row = (name, s) =>
		`${name.padEnd(28)} min=${String(s.min).padStart(4)} p50=${String(s.p50).padStart(4)} p90=${String(s.p90).padStart(4)} max=${String(s.max).padStart(4)} mean=${s.mean}`;
	console.log(`# Latency baseline (${report.generated_at}), ${SAMPLES} cold samples each\n`);
	console.log("## Monitor URLs — cold connection per request (like UptimeRobot)");
	for (const [label, m] of Object.entries(report.monitors)) {
		console.log(`\n${label}  ${m.url}  codes=${m.codes.join(",")}`);
		console.log(`  ${row("ttfb_ms", m.ttfb_ms)}`);
		console.log(`  ${row("total_ms", m.total_ms)}`);
		console.log(`  ${row("tcp_ms", m.tcp_ms)}`);
		console.log(`  ${row("tls_ms", m.tls_ms)}`);
		console.log(`  ${row("dns_ms", m.dns_ms)}`);
	}
	console.log("\n## Keep-alive reuse (2nd request on same connection)");
	for (const [label, p] of Object.entries(report.warm_pairs)) {
		console.log(
			`  ${label.padEnd(28)} cold_ttfb=${p.cold.ttfb_ms} warm_ttfb=${p.warm.ttfb_ms} warm_total=${p.warm.total_ms} code=${p.warm.code}`,
		);
	}
	console.log("\n## Variants (single request)");
	for (const [label, v] of Object.entries(report.variants)) {
		console.log(
			`  ${label.padEnd(28)} code=${v.code} ttfb=${v.ttfb_ms} total=${v.total_ms} redirect=${v.redirect ?? "-"}`,
		);
	}
}
