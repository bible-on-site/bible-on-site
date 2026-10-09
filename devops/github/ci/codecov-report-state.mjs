import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** ci_passed describes upstream CI; its absence says nothing about uploads. */
export function codecovReportState(commit) {
	if (commit.ci_passed === false) return "failed";
	if (commit.state !== "complete") return "pending";
	const report = commit.report;
	const hasReport = Array.isArray(report?.files) && report.files.length > 0
		&& report.totals?.files > 0 && report.totals?.lines > 0
		&& report.totals?.sessions > 0;
	if (!hasReport) return "missing";
	return commit.ci_passed === true ? "passed" : "reported";
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	console.log(codecovReportState(JSON.parse(readFileSync(process.argv[2], "utf8"))));
}
