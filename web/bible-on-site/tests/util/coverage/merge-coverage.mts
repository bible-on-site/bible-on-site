// merge-coverage.js
import { CoverageReport } from "monocart-coverage-reports";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs"; // Import the 'fs' module

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const coverageDir = path.resolve(__dirname, "../../../coverage");
const outputDir = path.resolve(coverageDir, "merged");
const coverageOptions = {
	name: "Merge Coverage Report",
	inputDir: [
		path.resolve(coverageDir, "unit", "raw"),
		path.resolve(coverageDir, "e2e", "raw"),
		path.resolve(coverageDir, "perf", "raw"),
	],
	outputDir: path.resolve(coverageDir, "merged"),

	reports: ["raw", "text", "html", "lcov", "json"], // raw merging is currently not working, proably MCR bug. TODO: hack using the results to regenerate the raw report (maybe need a new object)
};
const report = new CoverageReport(coverageOptions);
const results = await report.generate();
if (!results) {
  process.exit(1);
}
const coveragePercentage = results.summary.lines.pct;
const filePath = path.resolve(outputDir, "coverage-percentage.txt");
await fs.promises.writeFile(filePath, coveragePercentage.toString());
