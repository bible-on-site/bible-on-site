import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalizeBenchmarks, writeBenchmark } from "./benchmark-store.cjs";
import {
	collectEvidence,
	lighthouseBenchmarkName,
	performanceMarkdown,
	saveLighthouseReport,
	summarizeLighthouse,
	writePerformanceIndex,
} from "./performance-report.mjs";

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
	assert.deepEqual(collectEvidence(null), []);
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
