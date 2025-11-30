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
 * Filters coverage entries so only tracked files remain and their coverage maps
 * are rebuilt without invalid statement or branch references.
 *
 * @param {Record<string, Entry>} coverage
 * @returns {Record<string, Entry>}
 */
export function sanitizeCoverage(coverage) {
	const SRC_DIR = path.resolve(__dirname, "../../../", "src");
	for (const file of Object.keys(coverage)) {
		const entry = coverage[file];
		if (!entry || !hasValidStructure(entry) || !isTracked(entry, SRC_DIR)) {
			delete coverage[file];
			continue;
		}
		sanitizeEntryData(entry.data ?? entry);
	}
	return coverage;
}

function hasValidStructure(entry) {
	return entry && typeof entry.path === "string";
}

function isTracked(entry, srcDir) {
	if (!entry || typeof entry.path !== "string") {
		return false;
	}
	const entryPath = path.resolve(entry.path);
	return entryPath.startsWith(srcDir);
}

function sanitizeEntryData(entryData) {
	if (!entryData) return;
	const statementHelper = sanitizeStatementMap(entryData);
	sanitizeBranchMap(entryData, statementHelper);
	sanitizeFunctionMap(entryData);
}

function sanitizeStatementMap(entry) {
	entry.statementMap = entry.statementMap ?? {};
	entry.s = entry.s ?? {};
	const statements = [];
	for (const [key, value] of Object.entries(entry.statementMap)) {
		const startLine = value.start?.line ?? 0;
		const endLine = value.end?.line ?? 0;
		if (startLine > 0 && endLine > 0) {
			statements.push({ value, counter: entry.s[key] ?? 0 });
		}
	}
	rebuildMap(entry.statementMap, entry.s, statements);

	const statementLines = new Set();
	for (const { value } of statements) {
		trackStatementLines(value, statementLines);
	}
	let nextStatementIndex = statements.length;
	return {
		ensureLine(line) {
			if (line <= 0) {
				return false;
			}
			if (statementLines.has(line)) {
				return true;
			}
			const key = String(nextStatementIndex++);
			const flatStatement = createFlatStatement(line);
			entry.statementMap[key] = flatStatement;
			entry.s[key] = 0;
			trackStatementLines(flatStatement, statementLines);
			return true;
		},
	};
}

function sanitizeBranchMap(entry, statementHelper) {
	entry.branchMap = entry.branchMap ?? {};
	entry.b = entry.b ?? {};
	const branches = [];
	for (const [key, value] of Object.entries(entry.branchMap)) {
		const line = value.line ?? value.loc?.start?.line ?? value.loc?.line;
		if (statementHelper.ensureLine(line)) {
			branches.push({ value, counter: entry.b[key] ?? 0 });
		}
	}
	rebuildMap(entry.branchMap, entry.b, branches);
}

function sanitizeFunctionMap(entry) {
	entry.fnMap = entry.fnMap ?? {};
	entry.f = entry.f ?? {};
	const functions = [];
	for (const [key, value] of Object.entries(entry.fnMap)) {
		const line = value.line ?? value.loc?.start?.line ?? 0;
		if (line > 0) {
			functions.push({ value, counter: entry.f[key] ?? 0 });
		}
	}
	rebuildMap(entry.fnMap, entry.f, functions);
}

function rebuildMap(map, counters, entries) {
	for (const key of Object.keys(map)) {
		delete map[key];
	}
	for (const key of Object.keys(counters)) {
		delete counters[key];
	}
	entries.forEach((entry, index) => {
		map[index] = entry.value;
		counters[index] = entry.counter;
	});
}

function trackStatementLines(statement, statementLines) {
	const startLine = statement.start?.line;
	const endLine = statement.end?.line;
	if (typeof startLine === "number" && startLine > 0) {
		statementLines.add(startLine);
	}
	if (typeof endLine === "number" && endLine > 0) {
		statementLines.add(endLine);
	}
}

function createFlatStatement(line) {
	return {
		start: { line, column: 0 },
		end: { line, column: 0 },
	};
}
