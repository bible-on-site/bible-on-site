import assert from "node:assert/strict";
import test from "node:test";
import {
	createCurlClient,
	formatReport,
	main,
	measurementTargets,
	parseArgs,
	parseWriteOut,
	runBaseline,
} from "./latency-baseline.mjs";

const timing = ({ connections = 1, redirect = "", code = "200", ttfb = "0.004" } = {}) =>
	`dns=0.001 tcp=0.002 tls=0.003 ttfb=${ttfb} total=0.005 code=${code} redirect=${redirect} ip=127.0.0.1 ssl=0 connections=${connections}`;

/** A curl process double records argv and emits one record per transfer. */
function fakeExecutor(calls = [], { reconnect = false } = {}) {
	return async (command, args) => {
		calls.push({ command, args });
		const urls = args.filter((arg) => /^https?:\/\//.test(arg));
		return {
			stdout: urls.map((_, i) => timing({ connections: i === 0 || reconnect ? 1 : 0 })).join("\n") + "\n",
		};
	};
}

test("CLI defaults preserve production monitoring and validate targeting options", async (t) => {
	assert.deepEqual(parseArgs([]), { samples: 8, asJson: false, origin: null, help: false });
	assert.deepEqual(parseArgs(["--origin", "https://D123.cloudfront.net/", "--samples", "3", "--json"]), {
		samples: 3,
		asJson: true,
		origin: "https://d123.cloudfront.net",
		help: false,
	});
	assert.equal(parseArgs(["--origin", "http://localhost:8080"]).origin, "http://localhost:8080");
	for (const origin of [undefined, "not-a-url", "file:///tmp", "https://user:pass@host", "https://host/path", "https://host/?q=1", "https://host/#fragment"]) {
		await t.test(`reject invalid origin ${origin}`, () => {
			assert.throws(() => parseArgs(["--origin", origin]), /--origin/);
		});
	}
	for (const samples of [undefined, "0", "-1", "1.5", "Infinity", "NaN"]) {
		assert.throws(() => parseArgs(["--samples", samples]), /positive integer/);
	}
	assert.throws(() => parseArgs(["--candidate", "https://host"]), /Unknown argument/);
});

test("default monitor and variant URLs remain unchanged", () => {
	const targets = measurementTargets();
	assert.deepEqual(targets.monitors.map((target) => target.url), [
		"https://xn--febl3a.co.il/api/health",
		"https://xn--febl3a.com/api/health",
		"https://api.xn--febl3a.co.il/health",
		"https://api.xn--febl3a.com/health",
	]);
	assert.deepEqual(targets.variants.map((target) => target.url), [
		"http://xn--febl3a.co.il/api/health",
		"https://www.xn--febl3a.co.il/api/health",
		"https://xn--febl3a.co.il/",
		"https://xn--febl3a.com/",
		"https://api.xn--febl3a.co.il/",
	]);
});

test("direct and candidate origins use identical website paths without API subdomains", () => {
	const direct = measurementTargets("https://xn--febl3a.co.il");
	const candidate = measurementTargets("https://d123.cloudfront.net");
	for (const category of ["monitors", "variants"]) {
		assert.deepEqual(direct[category].map((target) => new URL(target.url).pathname), candidate[category].map((target) => new URL(target.url).pathname));
		assert.ok(candidate[category].every((target) => new URL(target.url).origin === "https://d123.cloudfront.net"));
	}
	assert.deepEqual(candidate.monitors.map((target) => new URL(target.url).pathname), ["/api/health", "/", "/929/315"]);
});

test("curl timing parser preserves redirect query values and connection evidence", () => {
	assert.deepEqual(parseWriteOut(timing({ connections: 0, redirect: "https://host/929/27?book=&x=2", code: "308" })), {
		dns_ms: 1,
		tcp_ms: 2,
		tls_ms: 3,
		ttfb_ms: 4,
		total_ms: 5,
		code: "308",
		redirect: "https://host/929/27?book=&x=2",
		ip: "127.0.0.1",
		new_connections: 0,
	});
	assert.equal(parseWriteOut(timing()).redirect, null);
	assert.equal(parseWriteOut(timing().replace("dns=0.001", "dns=0")).dns_ms, 0);
	for (const bad of ["", timing().replace("dns=0.001", "dns=invalid"), timing().replace("dns=0.001", "dns=-1"), timing().replace("dns=0.001", "dns="), timing().replace("dns=0.001 ", ""), timing({ code: "bad" }), timing().replace("connections=1", "connections=-1"), timing().replace("connections=1", "connections="), timing().replace("connections=1", "")]) {
		assert.throws(() => parseWriteOut(bad), /Invalid curl/);
	}
});

test("cold samples use a separate curl process with the existing deadline", async () => {
	const calls = [];
	const client = createCurlClient(fakeExecutor(calls));
	await client.once("https://candidate.invalid/");
	await client.once("https://candidate.invalid/");
	assert.equal(calls.length, 2);
	for (const { command, args } of calls) {
		assert.equal(command, "curl");
		assert.equal(args[args.indexOf("--max-time") + 1], "30");
		assert.equal(args[args.indexOf("-o") + 1], process.platform === "win32" ? "NUL" : "/dev/null");
		assert.equal(args.at(-1), "https://candidate.invalid/");
		assert.ok(!args.includes("-L"));
	}
});

test("warm pair suppresses both bodies on one curl process and reports actual reuse", async () => {
	const calls = [];
	const pair = await createCurlClient(fakeExecutor(calls)).warmPair("https://candidate.invalid/");
	assert.equal(calls.length, 1);
	assert.equal(pair.connection_reused, true);
	assert.equal(pair.cold.new_connections, 1);
	assert.equal(pair.warm.new_connections, 0);
	assert.deepEqual(calls[0].args.slice(-6), [
		"-o", process.platform === "win32" ? "NUL" : "/dev/null", "https://candidate.invalid/",
		"-o", process.platform === "win32" ? "NUL" : "/dev/null", "https://candidate.invalid/",
	]);
	const reconnected = await createCurlClient(fakeExecutor([], { reconnect: true })).warmPair("https://candidate.invalid/");
	assert.equal(reconnected.connection_reused, false);
});

test("warm pair fails on leaked body output or a missing timing record", async () => {
	for (const stdout of [timing(), `${timing()}\n<html>unexpected body</html>\n${timing()}`]) {
		const client = createCurlClient(async () => ({ stdout }));
		await assert.rejects(client.warmPair("https://candidate.invalid/"), /Expected two curl timing records/);
	}
});

test("process failure propagates without retries", async () => {
	let count = 0;
	const client = createCurlClient(async () => {
		count++;
		throw new Error("curl deadline exceeded");
	});
	await assert.rejects(client.once("https://candidate.invalid/"), /deadline exceeded/);
	assert.equal(count, 1);
});

test("origin report labels every target and samples both cold and warm requests", async () => {
	const calls = [];
	const report = await runBaseline({ origin: "https://candidate.invalid/", samples: 2 }, createCurlClient(fakeExecutor(calls)));
	assert.equal(report.target_origin, "https://candidate.invalid");
	assert.equal(report.target_mode, "website-origin");
	assert.equal(report.samples_per_monitor, 2);
	assert.equal(calls.length, 11); // 3 * (2 cold + 1 warm pair) + 2 variants.
	for (const monitor of Object.values(report.monitors)) {
		assert.equal(monitor.raw.length, 2);
		assert.deepEqual(monitor.codes, ["200"]);
		assert.deepEqual(monitor.ttfb_ms, { min: 4, p50: 4, p90: 4, max: 4, mean: 4 });
	}
	for (const category of ["monitors", "warm_pairs", "variants"]) {
		assert.ok(Object.values(report[category]).every((entry) => new URL(entry.url).origin === report.target_origin));
	}
	const formatted = formatReport(report);
	assert.match(formatted, /Target: https:\/\/candidate\.invalid/);
	assert.match(formatted, /connection_reused=true/);
	assert.match(formatted, /commentary/);
});

test("default report still measures every production monitor and variant", async () => {
	const calls = [];
	const report = await runBaseline({ samples: 1 }, createCurlClient(fakeExecutor(calls)));
	assert.equal(report.target_origin, null);
	assert.equal(report.target_mode, "production-monitors");
	assert.equal(Object.keys(report.monitors).length, 4);
	assert.equal(Object.keys(report.variants).length, 5);
	assert.equal(calls.length, 13);
	assert.match(formatReport(report), /production monitor URLs/);
});

test("CLI JSON output and help do not require live requests", async () => {
	const output = [];
	const calls = [];
	await main(["--origin", "https://candidate.invalid", "--samples", "1", "--json"], { execute: fakeExecutor(calls), write: (value) => output.push(value) });
	assert.equal(JSON.parse(output[0]).target_origin, "https://candidate.invalid");
	const count = calls.length;
	await main(["--help"], { execute: fakeExecutor(calls), write: (value) => output.push(value) });
	await main(["-h"], { execute: fakeExecutor(calls), write: (value) => output.push(value) });
	assert.equal(calls.length, count);
	assert.match(output[1], /--origin/);
	await main(["--samples", "1"], { execute: fakeExecutor(), write: (value) => output.push(value) });
	assert.match(output.at(-1), /production monitor URLs/);
});
