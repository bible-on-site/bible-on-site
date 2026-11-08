import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalizeBenchmarks, writeBenchmark } from "./benchmark-store.cjs";
import {
	collectEvidence,
	lighthouseBenchmarkEntry,
	lighthouseBenchmarkName,
	performanceMarkdown,
	saveLighthouseReport,
	summarizeLighthouse,
	writePerformanceIndex,
} from "./performance-report.mjs";

test("both TBT reporting paths preserve the existing browser blocking budget", () => {
	// PR #3005: 7ms exceeded a 6.43ms history-derived limit even though the
	// unchanged desktop test allows 5000ms. The duplicate audit must use the
	// same gate as the named TBT metric; neither may clip a real breach.
	assert.ok(7 > (15 / 14) * 6);
	for (const name of ["metric: TBT", "audit: total-blocking-time"]) {
		for (const budget of [5000, 10000]) {
			for (const value of [0, 7, budget, budget + 1]) {
				const entry = { name, measure: "time_ms", value, upperValue: budget };
				const result = lighthouseBenchmarkEntry(
					entry,
					"total-blocking-time",
					budget,
				);
				assert.equal(result.name, name);
				assert.equal(result.measure, "frame_budget_ratio");
				assert.equal(result.upperValue, 1);
				assert.equal(result.value > result.upperValue, value > budget);
				assert.equal(result.value * budget, value);
				assert.equal(entry.value, value);
				assert.equal(entry.measure, "time_ms");
			}
		}
	}
});

test("TBT normalization preserves raw evidence and other benchmark measures", () => {
	const lhr = fixture();
	lhr.audits["total-blocking-time"] = { numericValue: 7, score: 1 };
	assert.equal(summarizeLighthouse(lhr, { device: "desktop" }).metrics.TBT, 7);
	for (const [auditId, measure, value] of [
		["first-contentful-paint", "time_ms", 3000],
		["cumulative-layout-shift", "cls_ratio", 0.05],
		["total-blocking-time", "score", 1],
	]) {
		const entry = { name: auditId, measure, value };
		assert.equal(lighthouseBenchmarkEntry(entry, auditId, 5000), entry);
	}
	for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() =>
				lighthouseBenchmarkEntry(
					{ name: "TBT", measure: "time_ms", value: 7 },
					"total-blocking-time",
					budget,
				),
			/finite and positive/,
		);
	}
});

function fixture(url = "https://example.com/", lcp = 2000) {
	return {
		requestedUrl: url,
		finalDisplayedUrl: url,
		fetchTime: "2026-10-27T08:00:00Z",
		configSettings: { formFactor: "mobile" },
		categories: { performance: { score: 0.9 } },
		audits: {
			"largest-contentful-paint": {
				id: "largest-contentful-paint",
				numericValue: lcp,
				score: 1,
			},
			"unused-javascript": {
				id: "unused-javascript",
				title: "Reduce unused JavaScript",
				score: 0,
				metricSavings: { LCP: 200 },
				details: {
					type: "opportunity",
					overallSavingsBytes: 50000,
					overallSavingsMs: 200,
					items: [
						{
							url: "https://example.com/feature.js",
							wastedBytes: 50000,
							subItems: {
								items: [
									{
										source: { url: "src/feature.ts", line: 20, column: 3 },
										node: { selector: "#feature" },
									},
								],
							},
						},
					],
				},
			},
		},
	};
}

test("the CPU profile is retained beside the raw Lighthouse settings", () => {
	const lhr = fixture();
	lhr.cpuCalibration = {
		profile: "cpu-m500-d1500-v1",
		hostBenchmarkIndex: 2449,
		targetBenchmarkIndex: 500,
		cpuSlowdownMultiplier: 4.898,
	};
	lhr.configSettings.throttling = { cpuSlowdownMultiplier: 4.898 };
	const summary = summarizeLighthouse(lhr, { device: "mobile" });
	assert.deepEqual(summary.cpuCalibration, lhr.cpuCalibration);
	assert.deepEqual(summary.settings.throttling, {
		cpuSlowdownMultiplier: 4.898,
	});
});

test("page and device benchmark keys retain all four measurements", () => {
	const keys = new Set();
	for (const path of ["/", "/929/686"])
		for (const device of ["mobile", "desktop"])
			keys.add(lighthouseBenchmarkName(path, device, "metric: LCP"));
	assert.equal(keys.size, 4);
});

test("nested insight evidence retains URLs, selectors, source locations and byte savings", () => {
	const report = summarizeLighthouse(fixture(), {
		device: "mobile",
		knownIssues: ["unused-javascript"],
	});
	const audit = report.opportunities[0];
	assert.equal(audit.knownIssue, true);
	assert.equal(audit.wastedBytes, 50000);
	assert.deepEqual(audit.metricSavings, { LCP: 200 });
	assert.ok(
		audit.evidence.some((e) => e.url === "src/feature.ts" && e.line === 20),
	);
	assert.ok(audit.evidence.some((e) => e.selector === "#feature"));
	assert.equal(report.metrics.CLS, null);
	assert.equal(report.metrics.TTFB, undefined);
	assert.equal(report.metrics.SERVER_RESPONSE_TIME, null);
	assert.deepEqual(collectEvidence(null), []);
	const cached = fixture();
	cached.configSettings.disableStorageReset = true;
	assert.equal(
		summarizeLighthouse(cached, { device: "mobile" }).cacheMode,
		"retained",
	);
	cached.configSettings.disableStorageReset = false;
	assert.equal(
		summarizeLighthouse(cached, { device: "mobile" }).cacheMode,
		"reset",
	);
});

test("raw reports distinguish URLs that normalize to the same filename", () => {
	const dir = mkdtempSync(join(tmpdir(), "perf-report-"));
	try {
		const a = saveLighthouseReport(
			dir,
			fixture("https://example.com/a/b"),
			{ device: "mobile" },
			"<html></html>",
		);
		const b = saveLighthouseReport(dir, fixture("https://example.com/a_b"), {
			device: "mobile",
		});
		assert.notEqual(a.rawReport, b.rawReport);
		assert.equal(
			JSON.parse(readFileSync(join(dir, a.rawReport), "utf8")).requestedUrl,
			a.url,
		);
		assert.equal(
			readFileSync(join(dir, a.htmlReport), "utf8"),
			"<html></html>",
		);
		writePerformanceIndex(dir, [a, b]);
		assert.equal(
			JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).reports
				.length,
			2,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("summary uses medians, flags failed samples and never presents TBT as field INP", () => {
	const reports = [1000, 2000, 9000].map((lcp, i) => ({
		...summarizeLighthouse(fixture(undefined, lcp), {
			device: "mobile",
			run: i + 1,
		}),
		rawReport: `${i}.json`,
	}));
	reports.push({
		...reports[0],
		runtimeError: { code: "NO_FCP", message: "Failed load" },
		metrics: { LCP: 999999 },
	});
	const text = performanceMarkdown(reports, [
		{
			url: reports[0].url,
			scope: "url",
			device: "mobile",
			status: "unavailable",
			reason: "No CrUX record",
		},
	]);
	assert.match(text, /3\/4 valid \| 90 \| 2000/);
	assert.match(text, /Failed load/);
	assert.match(text, /middle LCP sample/);
	assert.match(text, /feature\.js/);
	assert.match(performanceMarkdown(reports), /TBT is not INP/);
	assert.match(text, /No CrUX record/);
	const warm = { ...reports[0], cacheMode: "retained" };
	const cold = { ...reports[1], cacheMode: "reset" };
	const separated = performanceMarkdown([warm, cold]);
	assert.match(separated, /cache: retained/);
	assert.match(separated, /cache: reset/);
	assert.equal((separated.match(/1\/1 valid/g) || []).length, 2);
	const escaped = performanceMarkdown(
		[],
		[
			{
				url: "https://example.com/",
				device: "mobile",
				scope: "url",
				status: "unavailable",
				reason: "path\\name|reason <b>&",
			},
		],
	);
	assert.ok(escaped.includes("path\\\\name\\|reason"));
	assert.ok(escaped.includes("&lt;b&gt;&amp;"));
});

test("parallel benchmark workers do not lose entries", async () => {
	const dir = mkdtempSync(join(tmpdir(), "perf-workers-"));
	try {
		const moduleUrl = new URL("./benchmark-store.cjs", import.meta.url).href;
		await Promise.all(
			[0, 1, 2, 3].map(
				(worker) =>
					new Promise((resolve, reject) => {
						const code = `import { writeBenchmark } from ${JSON.stringify(moduleUrl)}; for(let i=0;i<30;i++) writeBenchmark(${JSON.stringify(dir)},{name:'worker-${worker}-'+i,measure:'time_ms',value:i});`;
						const child = spawn(
							process.execPath,
							["--input-type=module", "-e", code],
							{ stdio: "pipe" },
						);
						let error = "";
						child.stderr.on("data", (chunk) => {
							error += chunk;
						});
						child.on("error", reject);
						child.on("exit", (status) =>
							status === 0 ? resolve() : reject(new Error(error)),
						);
					}),
			),
		);
		const merged = finalizeBenchmarks(dir);
		assert.equal(Object.keys(merged).length, 120);
		assert.equal(merged["worker-3-29"].time_ms.value, 29);
		assert.throws(
			() =>
				writeBenchmark(dir, {
					name: "bad",
					measure: "time_ms",
					value: Number.NaN,
				}),
			/Non-finite/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
