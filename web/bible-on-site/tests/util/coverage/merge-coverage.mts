import fs from "node:fs"; // Import the 'fs' module
import path from "node:path";
import { fileURLToPath } from "node:url";
// merge-coverage.js
import {
	CoverageReport,
	type CoverageReportOptions,
} from "monocart-coverage-reports";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const coverageDir = path.resolve(__dirname, "../../../coverage");
const unitCoverageDir = path.resolve(coverageDir, "unit");
const e2eCoverageDir = path.resolve(coverageDir, "e2e");
const outputDir = path.resolve(coverageDir, "merged");
const reports = ["text", process.env.CI ? "lcov" : "html"];

const coverageOptions: CoverageReportOptions = {
	name: "Merge Coverage Report",
	inputDir: [
		path.resolve(unitCoverageDir, "raw"),
		path.resolve(e2eCoverageDir, "raw"),
	],
	outputDir: outputDir,
	reports: reports,
};
const report = new CoverageReport(coverageOptions);
const results = await report.generate();
if (!results) {
	process.exit(1);
}
const coveragePercentage = results.summary.lines.pct;
const filePath = path.resolve(outputDir, "coverage-percentage.txt");
await fs.promises.writeFile(filePath, coveragePercentage.toString());
if (process.env.CI) {
	await fs.promises.rm(unitCoverageDir, { recursive: true });
	await fs.promises.rm(e2eCoverageDir, { recursive: true });
}
