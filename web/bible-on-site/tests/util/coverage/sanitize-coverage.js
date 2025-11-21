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
	// Remove any line elements that are mapped to line 0 // TODO: refactor, as this is very clumsy
	const lineElementsMaps = [
		{ map: coverageEntryData.branchMap, counters: coverageEntryData.b },
		{ map: coverageEntryData.fnMap, counters: coverageEntryData.f },
	];
	for (const { map: lineElementsMap, counters } of lineElementsMaps) {
		const validEntries = [];
		for (const [key, value] of Object.entries(lineElementsMap)) {
			if (value.line !== 0) {
				validEntries.push({ key, value, counter: counters[key] });
			}
		}
		// Clear and rebuild the map without holes
		for (const key of Object.keys(lineElementsMap)) {
			delete lineElementsMap[key];
			delete counters[key];
		}
		validEntries.forEach((entry, index) => {
			lineElementsMap[index] = entry.value;
			counters[index] = entry.counter;
		});
	}

	const validStatements = [];
	for (const [key, value] of Object.entries(coverageEntryData.statementMap)) {
		if (value.start.line !== 0 && value.end.line !== 0) {
			validStatements.push({ value, counter: coverageEntryData.s[key] });
		}
	}
	// Clear and rebuild the statementMap without holes
	for (const key of Object.keys(coverageEntryData.statementMap)) {
		delete coverageEntryData.statementMap[key];
		delete coverageEntryData.s[key];
	}
	validStatements.forEach((entry, index) => {
		coverageEntryData.statementMap[index] = entry.value;
		coverageEntryData.s[index] = entry.counter;
	});

	// // Remove any branch entries that point to non-existent statement lines TODO: remove commented code or uncomment if ever found an issue in this area
	// const statementLines = new Set();
	// for (const stmt of Object.values(coverageEntryData.statementMap)) {
	// 	statementLines.add(stmt.start.line);
	// }

	// for (const [key, value] of Object.entries(coverageEntryData.branchMap)) {
	// 	const line = value.line || value.loc?.start?.line;
	// 	if (line && !statementLines.has(line)) {
	// 		delete coverageEntryData.branchMap[key];
	// 		delete coverageEntryData.b[key];
	// 	}
	// }
}
