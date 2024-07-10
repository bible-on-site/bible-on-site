import path from "node:path";

/**
 * @param {record<string, {path: string}>} coverage - The coverage object.
 * @returns {void} - The filtered coverage object.
 * @description Filters out redundant files from the coverage.
 */
export function filterOutCoverageRedundantFiles(coverage) {
	const SRC_DIR = path.resolve(__dirname, "../../../", "src");
	for (const file in coverage) {
		if (!coverage[file].path.startsWith(SRC_DIR)) {
			delete coverage[file];
		}
	}
}
