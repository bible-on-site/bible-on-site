import path from "path";
import { fileURLToPath } from "url";
// merge-coverage.js
import { CoverageReport } from "monocart-coverage-reports";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const coverageDir = path.resolve(__dirname, "../../../coverage");
const coverageOptions = {
	name: "Merge Coverage Report",
	inputDir: [
		path.resolve(coverageDir, "unit", "raw"),
		path.resolve(coverageDir, "e2e", "raw"),
	],
	outputDir: path.resolve(coverageDir, "merged"),

	reports: ["raw", "text", "html"],
};
await new CoverageReport(coverageOptions).generate();
