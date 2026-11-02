#!/usr/bin/env node
/**
 * Reproducible latency baseline for GitHub issues #2394 and #2508.
 * Default: the production UptimeRobot monitors and representative variants.
 * --origin: equivalent website paths on one direct or candidate origin.
 * DNS/TCP/TLS timings are cumulative curl timings, not isolated phase durations.
 *
 * Usage:
 *   node devops/latency-baseline.mjs [--samples N] [--json] [--origin https://host]
 *
 * Requests are sequential: eight cold samples and one attempted keep-alive
 * pair per monitor, plus representative probes. Record the vantage point;
 * compare the same --origin matrix on direct and candidate origins.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
const USER_AGENT = "latency-baseline/1.0 (research #2394)";
const USAGE =
	"Usage: node devops/latency-baseline.mjs [--samples N] [--json] [--origin https://host]";
const WRITE_OUT =
	"dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} " +
	"ttfb=%{time_starttransfer} total=%{time_total} code=%{response_code} " +
	"redirect=%{redirect_url} ip=%{remote_ip} ssl=%{ssl_verify_result} " +
	"connections=%{num_connects}";

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

function parseOrigin(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("--origin requires an HTTP(S) origin such as https://host");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("--origin must be an HTTP(S) origin without credentials, path, query or fragment");
	}
	return url.origin;
}

export function parseArgs(args) {
	const options = { samples: 8, asJson: false, origin: null, help: false };
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--samples":
				options.samples = Number(args[++i]);
				if (!Number.isSafeInteger(options.samples) || options.samples < 1) {
					throw new Error("--samples must be a positive integer");
				}
				break;
			case "--origin":
				options.origin = parseOrigin(args[++i]);
				break;
			case "--json":
				options.asJson = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${args[i]}`);
		}
	}
	return options;
}

export function measurementTargets(origin = null) {
	if (!origin) return { monitors: MONITORS, variants: VARIANTS };
	const targetOrigin = parseOrigin(origin);
	const target = (label, pathname) => ({
		label,
		url: new URL(pathname, targetOrigin).href,
	});
	return {
		monitors: [
			target("website health", "/api/health"),
			target("homepage", "/"),
			target("perek page", "/929/315"),
		],
		variants: [
			target("trailing-slash redirect", "/929/315/"),
			target("commentary", "/929/315/%D7%A8%D7%A9%22%D7%99"),
		],
	};
}

export function parseWriteOut(text) {
	const fields = {};
	for (const pair of text.trim().split(/\s+/)) {
		const separator = pair.indexOf("=");
		fields[pair.slice(0, separator)] = pair.slice(separator + 1);
	}
	const timings = {};
	for (const name of ["dns", "tcp", "tls", "ttfb", "total"]) {
		const value = Number(fields[name]);
		if (fields[name] === undefined || fields[name] === "" || !Number.isFinite(value) || value < 0) {
			throw new Error(`Invalid curl timing output: ${name}`);
		}
		timings[`${name}_ms`] = Math.round(value * 1000);
	}
	const connections = Number(fields.connections);
	if (
		!/^\d{3}$/.test(fields.code ?? "") ||
		fields.connections === undefined ||
		fields.connections === "" ||
		!Number.isSafeInteger(connections) ||
		connections < 0
	) {
		throw new Error("Invalid curl status or connection-count output");
	}
	return {
		...timings,
		code: fields.code,
		redirect: fields.redirect || null,
		ip: fields.ip,
		new_connections: connections,
	};
}

/** Inject the process executor for tests; no shell interpolation is used. */
export function createCurlClient(execute = execFileAsync) {
	const commonArgs = [
		"-sS",
		"-w",
		`${WRITE_OUT}\n`,
		"--max-time",
		"30",
		"-A",
		USER_AGENT,
	];
	return {
		async once(url) {
			const { stdout } = await execute("curl", [
				...commonArgs,
				"-o",
				NULL_DEVICE,
				url,
			]);
			return parseWriteOut(stdout);
		},
		async warmPair(url) {
			// curl's -o applies to one transfer only. Suppress both bodies so the
			// second response cannot corrupt the timing records or overflow stdout.
			const { stdout } = await execute("curl", [
				...commonArgs,
				"-o",
				NULL_DEVICE,
				url,
				"-o",
				NULL_DEVICE,
				url,
			]);
			const lines = stdout.trim().split(/\r?\n/);
			if (lines.length !== 2) {
				throw new Error("Expected two curl timing records for the keep-alive pair");
			}
			const cold = parseWriteOut(lines[0]);
			const warm = parseWriteOut(lines[1]);
			return { cold, warm, connection_reused: warm.new_connections === 0 };
		},
	};
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const pick = (p) => sorted[Math.ceil((p / 100) * sorted.length) - 1];
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return { min: sorted[0], p50: pick(50), p90: pick(90), max: sorted[sorted.length - 1], mean: Math.round(mean) };
}

export async function runBaseline({ samples = 8, origin = null } = {}, client = createCurlClient()) {
	const targets = measurementTargets(origin);
	const report = {
		generated_at: new Date().toISOString(),
		target_mode: origin ? "website-origin" : "production-monitors",
		target_origin: origin ? parseOrigin(origin) : null,
		samples_per_monitor: samples,
		monitors: {},
		warm_pairs: {},
		variants: {},
	};
	for (const monitor of targets.monitors) {
		const runs = [];
		for (let i = 0; i < samples; i++) runs.push(await client.once(monitor.url));
		const metrics = {};
		for (const name of ["ttfb_ms", "total_ms", "dns_ms", "tcp_ms", "tls_ms"]) {
			metrics[name] = stats(runs.map((run) => run[name]));
		}
		report.monitors[monitor.label] = {
			url: monitor.url,
			codes: [...new Set(runs.map((run) => run.code))],
			...metrics,
			raw: runs,
		};
		report.warm_pairs[monitor.label] = {
			url: monitor.url,
			...(await client.warmPair(monitor.url)),
		};
	}
	for (const variant of targets.variants) {
		report.variants[variant.label] = { url: variant.url, ...(await client.once(variant.url)) };
	}
	return report;
}

export function formatReport(report) {
	const row = (name, s) =>
		`${name.padEnd(28)} min=${String(s.min).padStart(4)} p50=${String(s.p50).padStart(4)} p90=${String(s.p90).padStart(4)} max=${String(s.max).padStart(4)} mean=${s.mean}`;
	const lines = [
		`# Latency baseline (${report.generated_at}), ${report.samples_per_monitor} cold samples each`,
		`Target: ${report.target_origin ?? "production monitor URLs"}`,
		"\n## Monitor URLs - cold connection per request",
	];
	for (const [label, monitor] of Object.entries(report.monitors)) {
		lines.push(`\n${label}  ${monitor.url}  codes=${monitor.codes.join(",")}`);
		for (const metric of ["ttfb_ms", "total_ms", "tcp_ms", "tls_ms", "dns_ms"]) {
			lines.push(`  ${row(metric, monitor[metric])}`);
		}
	}
	lines.push("\n## Keep-alive pair (reuse is observed, not assumed)");
	for (const [label, pair] of Object.entries(report.warm_pairs)) {
		lines.push(
			`  ${label.padEnd(28)} cold_ttfb=${pair.cold.ttfb_ms} warm_ttfb=${pair.warm.ttfb_ms} warm_total=${pair.warm.total_ms} code=${pair.warm.code} connection_reused=${pair.connection_reused}`,
		);
	}
	lines.push("\n## Variants (single request)");
	for (const [label, variant] of Object.entries(report.variants)) {
		lines.push(
			`  ${label.padEnd(28)} code=${variant.code} ttfb=${variant.ttfb_ms} total=${variant.total_ms} redirect=${variant.redirect ?? "-"}`,
		);
	}
	return lines.join("\n");
}

export async function main(args = process.argv.slice(2), { execute = execFileAsync, write = console.log } = {}) {
	const options = parseArgs(args);
	if (options.help) {
		write(USAGE);
		return;
	}
	const report = await runBaseline(options, createCurlClient(execute));
	write(options.asJson ? JSON.stringify(report, null, 2) : formatReport(report));
	return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`Latency baseline failed: ${error.message}`);
		process.exitCode = 1;
	});
}
