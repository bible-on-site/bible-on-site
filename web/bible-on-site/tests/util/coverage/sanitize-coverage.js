import path from "node:path";
/**
 * @typedef {Object} Position
 * @property {number} line
 * @property {number} column
 */
/**
 * @typedef {Object} EntryData
 * @property {boolean} all
 * @property {string} path
 * @property {Object.<number, {start: Position, end: Position}>} statementMap
 * @property {Object.<number, {name?: string, decl?: Object, loc?: Object, line?: number}>} fnMap
 * @property {Object.<number, {type?: string, loc?: Object, locations?: Object, line?: number}>} branchMap
 * @property {Object.<number, number>} s
 * @property {Object.<number, number>} f
 * @property {Object.<number, number>} b
 * @property {string} _coverageSchema
 * @property {string} hash
 */

/**
 * @typedef {Object} Entry
 * @property {EntryData} data
 * @property {Object} meta
 * @property {Object} meta.last
 * @property {number} meta.last.s
 * @property {number} meta.last.f
 * @property {number} meta.last.b
 * @property {Object} meta.seen
 */

/**
 * @param {Record<string, Entry>} coverage - The coverage object.
 * @returns {Record<string, Entry>} The filtered coverage object.
 * @description Filters out redundant files from the coverage. Mutates the
 * coverage object and also returns it for convenience/chaining.
 */
export function sanitizeCoverage(coverage) {
	// Work on a stable list of keys so deleting entries doesn't affect iteration
	for (const file of Object.keys(coverage)) {
		const entry = coverage[file];
		if (!isTracked(entry) || !hasValidStructure(entry)) {
			delete coverage[file];
		}
		// some implementation (unit) uses underlying data object, and top level properties are actually getters.
		// other implementation (e2e) uses the data object directly at top level.
		sanitizeEntryData(entry.data ?? entry);
	}

	return coverage;
}

function isTracked(coverageEntry) {
	const entryPath = path.resolve(coverageEntry.path);
	const SRC_DIR = path.resolve(__dirname, "../../../", "src");
	return entryPath.startsWith(SRC_DIR);
}

function hasValidStructure(coverageEntry) {
	return coverageEntry && typeof coverageEntry.path === "string";
}
/**
 * @param {EntryData} coverageEntryData
 * @returns {boolean}
 * @description Checks if the coverage entry has mispositioned tokens (e.g., zero coverage lines).
 */
function sanitizeEntryData(coverageEntryData) {
	const lineElementsMaps = [
		{ map: coverageEntryData.branchMap, counters: coverageEntryData.b },
		{ map: coverageEntryData.fnMap, counters: coverageEntryData.f },
	];
	for (const { map: lineElementsMap, counters } of lineElementsMaps) {
		for (const [key, value] of Object.entries(lineElementsMap)) {
			if (value.line === 0) {
				delete lineElementsMap[key];
				delete counters[key];
			}
		}
	}
	for (const [key, value] of Object.entries(coverageEntryData.statementMap)) {
		if (value.start.line === 0 || value.end.line === 0) {
			delete coverageEntryData.statementMap[key];
			delete coverageEntryData.s[key];
		}
	}
}
