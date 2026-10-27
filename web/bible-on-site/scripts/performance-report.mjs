import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function lighthouseBenchmarkName(path, device, name) {
	return `lighthouse: ${path} (${device}) | ${name}`;
}

const METRICS = {
	FCP: "first-contentful-paint",
	LCP: "largest-contentful-paint",
	TBT: "total-blocking-time",
	CLS: "cumulative-layout-shift",
	SI: "speed-index",
	TTFB: "server-response-time",
};

// Keep nested resource URLs, source locations, selectors and savings. Insight
// audits nest these differently from older opportunity audits.
export function collectEvidence(value) {
	const evidence = [];
	function visit(item) {
		if (!item || typeof item !== "object") return;
		if (Array.isArray(item)) {
			for (const child of item) visit(child);
			return;
		}
		const record = Object.fromEntries(
			Object.entries(item).filter(
				([key, entry]) =>
					/^(url|selector|snippet|nodeLabel|sourceURL|line|column|wastedBytes|wastedMs|totalBytes|transferSize|duration|label|signal|protocol|resourceType|priority|subpart)$/.test(
						key,
					) &&
					entry !== null &&
					typeof entry !== "object",
			),
		);
		if (Object.keys(record).some((key) => key !== "label"))
			evidence.push(record);
		for (const [key, child] of Object.entries(item)) {
			if (key !== "headings") visit(child);
		}
	}
	visit(value);
	return evidence;
}

export function summarizeLighthouse(
	lhr,
	{ device, run = 1, environment = "ci", knownIssues = [] },
) {
	const metrics = Object.fromEntries(
		Object.entries(METRICS).map(([name, id]) => [
			name,
			Number.isFinite(lhr.audits[id]?.numericValue)
				? lhr.audits[id].numericValue
				: null,
		]),
	);
	const opportunities = Object.values(lhr.audits)
		.filter((audit) => audit.score !== null && audit.score < 0.9)
		.map((audit) => ({
			id: audit.id,
			title: audit.title,
			score: audit.score,
			knownIssue: knownIssues.includes(audit.id),
			displayValue: audit.displayValue,
			metricSavings: audit.metricSavings,
			wastedMs: audit.details?.overallSavingsMs,
			wastedBytes: audit.details?.overallSavingsBytes,
			evidence: collectEvidence(audit.details),
			// Retain complete diagnostics, including request trees and LCP subparts.
			details: audit.details,
		}));
	return {
		url: lhr.requestedUrl,
		finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl,
		device,
		run,
		environment,
		fetchTime: lhr.fetchTime,
		lighthouseVersion: lhr.lighthouseVersion,
		runtimeError: lhr.runtimeError,
		warnings: lhr.runWarnings || [],
		settings: lhr.configSettings,
		categories: Object.fromEntries(
			Object.entries(lhr.categories).map(([id, category]) => [
				id,
				category.score,
			]),
		),
		metrics,
		opportunities,
		diagnostics: [
			"lcp-breakdown-insight",
			"lcp-discovery-insight",
			"network-dependency-tree-insight",
		]
			.filter((id) => lhr.audits[id]?.details)
			.map((id) => ({
				id,
				title: lhr.audits[id].title,
				evidence: collectEvidence(lhr.audits[id].details),
				details: lhr.audits[id].details,
			})),
	};
}

export function saveLighthouseReport(directory, lhr, options, html) {
	mkdirSync(directory, { recursive: true });
	const summary = summarizeLighthouse(lhr, options);
	const url = new URL(summary.url);
	const path =
		url.pathname.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 50) || "home";
	const hash = createHash("sha256")
		.update(summary.url)
		.digest("hex")
		.slice(0, 10);
	const stem = `${path}-${summary.device}-${summary.run}-${hash}`;
	summary.rawReport = `${stem}.json`;
	writeFileSync(
		join(directory, summary.rawReport),
		JSON.stringify(lhr, null, 2),
	);
	if (html) {
		summary.htmlReport = `${stem}.html`;
		writeFileSync(join(directory, summary.htmlReport), html);
	}
	return summary;
}

function median(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return null;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const cell = (value) =>
	String(value ?? "unavailable")
		.replace(/[\\|]/g, "\\$&")
		.replace(/[\r\n]/g, " ");
const number = (value) =>
	Number.isFinite(value) ? Math.round(value * 100) / 100 : "unavailable";

export function performanceMarkdown(reports, field = [], assets = []) {
	const groups = new Map();
	for (const report of reports) {
		const key = `${report.url} (${report.device})`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(report);
	}
	const lines = [
		"# Performance diagnostics",
		"",
		"Lab measurements from the recorded machine and Lighthouse device/throttling settings. These are not real-user percentiles. Timing values are milliseconds. Repeated runs use medians; savings estimates overlap and must not be added together.",
		"",
		"| Page / device | Runs | Performance | LCP | TBT | CLS |",
		"| --- | ---: | ---: | ---: | ---: | ---: |",
	];
	for (const [key, runs] of groups) {
		const valid = runs.filter((report) => !report.runtimeError);
		const score = median(valid.map((report) => report.categories.performance));
		lines.push(
			`| ${cell(key)} | ${valid.length}/${runs.length} valid | ${number(score === null ? null : score * 100)} | ${number(median(valid.map((r) => r.metrics.LCP)))} | ${number(median(valid.map((r) => r.metrics.TBT)))} | ${number(median(valid.map((r) => r.metrics.CLS)))} |`,
		);
	}
	for (const [key, runs] of groups) {
		lines.push("", `## ${key}`, "");
		for (const run of runs) {
			if (run.runtimeError)
				lines.push(
					`- Run ${run.run} failed: ${cell(run.runtimeError.message || run.runtimeError.code)}`,
				);
			for (const warning of run.warnings)
				lines.push(`- Run ${run.run} warning: ${cell(warning)}`);
		}
		const valid = runs
			.filter((r) => !r.runtimeError && Number.isFinite(r.metrics.LCP))
			.sort((a, b) => a.metrics.LCP - b.metrics.LCP);
		const selected = valid[Math.floor(valid.length / 2)];
		if (!selected) continue;
		lines.push(
			`Diagnostics from run ${selected.run} (middle LCP sample). Full report: [JSON](${selected.rawReport})${selected.htmlReport ? ` / [HTML](${selected.htmlReport})` : ""}.`,
			"",
		);
		for (const diagnostic of selected.diagnostics || []) {
			lines.push(`### ${diagnostic.title} (${diagnostic.id})`, "");
			for (const evidence of diagnostic.evidence.slice(0, 30))
				lines.push(`- ${cell(JSON.stringify(evidence))}`);
			lines.push("");
		}
		for (const audit of [...selected.opportunities].sort(
			(a, b) =>
				(b.metricSavings?.LCP || b.wastedMs || 0) -
				(a.metricSavings?.LCP || a.wastedMs || 0),
		)) {
			lines.push(
				`### ${audit.title} (${audit.id})`,
				"",
				`Score: ${audit.score}; ${audit.knownIssue ? "accepted CI issue (still needs investigation)" : "not exempted"}. ${cell(audit.displayValue || "")}`,
			);
			if (audit.metricSavings)
				lines.push(
					`Estimated metric savings: ${JSON.stringify(audit.metricSavings)} ms.`,
				);
			if (audit.wastedBytes !== undefined)
				lines.push(`Estimated avoidable transfer: ${audit.wastedBytes} bytes.`);
			if (audit.wastedMs !== undefined)
				lines.push(`Estimated time savings: ${audit.wastedMs} ms.`);
			for (const evidence of audit.evidence.slice(0, 30))
				lines.push(`- ${cell(JSON.stringify(evidence))}`);
			if (audit.evidence.length > 30)
				lines.push(
					`- ${audit.evidence.length - 30} additional evidence records are retained in summary.json and the raw report.`,
				);
			lines.push("");
		}
	}
	lines.push("", "## Real-user data", "");
	if (!field.length)
		lines.push(
			"Not collected. Lab TBT is not INP; no real-user INP or p75 claim can be made from these audits.",
		);
	for (const result of field) {
		lines.push(
			`- ${cell(result.url)} (${result.device}, ${result.scope}): ${cell(result.status)}${result.reason ? ` - ${cell(result.reason)}` : ""}`,
		);
		if (result.record)
			lines.push(
				`  - CrUX collection period: ${JSON.stringify(result.record.collectionPeriod)}; p75: ${JSON.stringify(Object.fromEntries(Object.entries(result.record.metrics).map(([name, metric]) => [name, metric.percentiles?.p75 ?? null])))}`,
			);
	}
	if (assets.length) {
		lines.push("", "## Captured first-party resources", "");
		for (const asset of assets)
			lines.push(
				`- ${cell(asset.url)}: ${asset.file ? `[downloaded source](${asset.file}) (${asset.bytes} bytes, SHA-256 ${asset.sha256})` : cell(asset.reason)}`,
			);
	}
	return `${lines.join("\n")}\n`;
}

export function writePerformanceIndex(
	directory,
	reports,
	field = [],
	assets = [],
) {
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "summary.json"),
		JSON.stringify({ schemaVersion: 1, reports, field, assets }, null, 2),
	);
	writeFileSync(
		join(directory, "summary.md"),
		performanceMarkdown(reports, field, assets),
	);
}
