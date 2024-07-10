// merge-coverage.js
import {
  CoverageReport,
  CoverageReportOptions,
} from "monocart-coverage-reports";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs"; // Import the 'fs' module

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const coverageDir = path.resolve(__dirname, "../../../coverage");
const outputDir = path.resolve(coverageDir, "merged");
const reports = ["text", "html"];
if (process.env.CI) {
  reports.push("codecov");
}
const coverageOptions: CoverageReportOptions = {
  name: "Merge Coverage Report",
  inputDir: [
    path.resolve(coverageDir, "unit", "raw"),
    path.resolve(coverageDir, "e2e", "raw"),
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
