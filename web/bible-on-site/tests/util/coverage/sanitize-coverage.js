import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { covIgnoreList } from "../../../.covignore.mjs";

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
const DEBUG_SANITIZE_PATH = process.env.DEBUG_SANITIZE_PATH;

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
	const isPartOfSrc = entryPath.startsWith(srcDir);
	const projectRoot = path.dirname(srcDir);
	const relativePath = path
		.relative(projectRoot, entryPath)
		.replace(/\\/g, "/");
	const isIgnored = covIgnoreList.some((pattern) => {
		// Prepend **/ if pattern doesn't already start with it, to match anywhere in path
		const globPattern = pattern.startsWith("**/") ? pattern : `**/${pattern}`;
		return picomatch(globPattern)(relativePath);
	});

	return isPartOfSrc && !isIgnored;
}

/**
 * Parse source file and find lines that should be ignored based on
 * /* istanbul ignore next * / comments. SWC coverage plugin doesn't
 * respect these comments, so we handle them manually.
 *
 * @param {string} filePath - Absolute path to source file
 * @returns {Set<number>} - Set of line numbers to ignore
 */
function findIstanbulIgnoreLines(filePath) {
	const ignoredLines = new Set();
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Match /* istanbul ignore next */ or /* istanbul ignore next: reason */
			if (/\/\*\s*istanbul\s+ignore\s+next\b/.test(line)) {
				// Ignore the next line (1-indexed)
				ignoredLines.add(i + 2);
			}
		}
	} catch {
		// File not readable, skip ignore handling
	}
	return ignoredLines;
}

/**
 * Apply istanbul ignore directives to coverage data.
 * For ignored lines, mark statements as covered and branches as fully covered.
 * If a function starts on an ignored line, mark all its contents as covered.
 *
 * @param {EntryData} entryData - Coverage entry data
 * @param {Set<number>} ignoredLines - Lines to ignore
 */
function applyIstanbulIgnore(entryData, ignoredLines) {
	if (ignoredLines.size === 0) return;

	// Find functions that start on ignored lines and collect their line ranges
	const ignoredFunctionRanges = [];
	for (const [key, fn] of Object.entries(entryData.fnMap ?? {})) {
		const startLine = fn.line ?? fn.decl?.start?.line ?? fn.loc?.start?.line;
		if (startLine && ignoredLines.has(startLine)) {
			// Mark function as covered
			entryData.f[key] = Math.max(entryData.f[key] ?? 0, 1);

			// Find function end line from loc or estimate from statements
			const endLine =
				fn.loc?.end?.line ?? findFunctionEndLine(entryData, startLine);
			if (endLine) {
				ignoredFunctionRanges.push({ start: startLine, end: endLine });
			}
		}
	}

	// Check if a line is within any ignored function range
	const isLineIgnored = (line) => {
		if (ignoredLines.has(line)) return true;
		return ignoredFunctionRanges.some(
			(range) => line >= range.start && line <= range.end,
		);
	};

	// Mark statements on ignored lines or within ignored functions as covered
	for (const [key, stmt] of Object.entries(entryData.statementMap ?? {})) {
		const line = stmt.start?.line;
		if (line && isLineIgnored(line)) {
			entryData.s[key] = Math.max(entryData.s[key] ?? 0, 1);
		}
	}

	// Mark branches on ignored lines or within ignored functions as fully covered
	for (const [key, branch] of Object.entries(entryData.branchMap ?? {})) {
		const line = branch.line ?? branch.loc?.start?.line ?? branch.loc?.line;
		if (line && isLineIgnored(line)) {
			const branchCount = entryData.b[key]?.length ?? 0;
			entryData.b[key] = Array(branchCount).fill(1);
		}
	}
}

/**
 * Estimate function end line by finding the last statement that could be in this function
 */
function findFunctionEndLine(entryData, startLine) {
	let maxLine = startLine;
	for (const stmt of Object.values(entryData.statementMap ?? {})) {
		const stmtEnd = stmt.end?.line;
		if (stmtEnd && stmtEnd > maxLine) {
			// Only include if there's no other function starting between startLine and stmtEnd
			let belongsToThisFunction = true;
			for (const fn of Object.values(entryData.fnMap ?? {})) {
				const fnStart = fn.line ?? fn.decl?.start?.line ?? fn.loc?.start?.line;
				if (fnStart && fnStart > startLine && fnStart <= stmtEnd) {
					belongsToThisFunction = false;
					break;
				}
			}
			if (belongsToThisFunction) {
				maxLine = stmtEnd;
			}
		}
	}
	return maxLine;
}

function sanitizeEntryData(entryData) {
	if (!entryData) return;
	debugEntry(entryData, "before");

	// Apply istanbul ignore comments (SWC doesn't respect them)
	const filePath = entryData.path;
	if (filePath) {
		const ignoredLines = findIstanbulIgnoreLines(filePath);
		applyIstanbulIgnore(entryData, ignoredLines);
	}

	const statementHelper = sanitizeStatementMap(entryData);
	sanitizeBranchMap(entryData, statementHelper);
	sanitizeFunctionMap(entryData);
	debugEntry(entryData, "after");
}

function debugEntry(entryData, stage) {
	if (!DEBUG_SANITIZE_PATH) {
		return;
	}
	if (stage !== "after") {
		return;
	}
	const entryPath = entryData.path ?? entryData?.data?.path;
	const normalized = entryPath?.replace(/\\/g, "/");
	if (!normalized || !normalized.includes(DEBUG_SANITIZE_PATH)) {
		return;
	}
	const safeDump = {
		stage,
		path: entryPath,
		statements: Object.entries(entryData.statementMap ?? {}).map(
			([key, value]) => ({ key, start: value.start, end: value.end }),
		),
		statementHits: entryData.s,
		branches: Object.entries(entryData.branchMap ?? {}).map(([key, value]) => ({
			key,
			line: value?.line ?? value?.loc?.start?.line ?? value?.loc?.line,
			locations: value?.locations,
		})),
		branchHits: entryData.b,
	};
	console.log("[sanitizeCoverage]", JSON.stringify(safeDump, null, 2));
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
	const lineToStatementKey = new Map();
	rebuildMap(entry.statementMap, entry.s, statements, (index, value) => {
		registerStatementLines(lineToStatementKey, value, index);
	});

	let nextStatementIndex = statements.length;
	return {
		ensureLine(line, minHits = 0) {
			if (line <= 0) {
				return undefined;
			}
			const existing = lineToStatementKey.get(line);
			if (existing && existing.origin === "start") {
				const key = existing.key;
				entry.s[key] = Math.max(entry.s[key] ?? 0, minHits);
				return key;
			}
			const key = String(nextStatementIndex++);
			const flatStatement = createFlatStatement(line);
			entry.statementMap[key] = flatStatement;
			entry.s[key] = Math.max(0, minHits);
			registerStatementLines(lineToStatementKey, flatStatement, key);
			return key;
		},
	};
}

function sanitizeBranchMap(entry, statementHelper) {
	entry.branchMap = entry.branchMap ?? {};
	entry.b = entry.b ?? {};
	const branches = [];
	for (const [key, value] of Object.entries(entry.branchMap)) {
		const counter = typeof entry.b[key] === "undefined" ? 0 : entry.b[key];
		const splitEntries = splitBranchByLine(value, counter);
		for (const entryVariant of splitEntries) {
			const { value: branchValue, counter: branchCounter } = entryVariant;
			const hasLines = ensureBranchLines(
				branchValue,
				branchCounter,
				statementHelper,
			);
			if (hasLines) {
				branches.push({ value: branchValue, counter: branchCounter });
			}
		}
	}
	rebuildMap(entry.branchMap, entry.b, branches);
}

function splitBranchByLine(value, counter) {
	const locations = Array.isArray(value?.locations) ? value.locations : [];
	if (!locations.length) {
		return [{ value, counter }];
	}
	const locationHits = getBranchLocationHits(counter);
	const groups = new Map();
	locations.forEach((location, index) => {
		const line = getLocationLine(location);
		if (line <= 0) {
			return;
		}
		const clonedLocation = cloneLocation(location);
		if (!groups.has(line)) {
			groups.set(line, { locations: [], hits: [] });
		}
		const group = groups.get(line);
		group.locations.push(clonedLocation);
		group.hits.push(locationHits[index] ?? 0);
	});
	if (!groups.size) {
		return [{ value, counter }];
	}
	return Array.from(groups.entries()).map(([line, group]) => {
		const cloned = cloneBranchValue(value);
		setBranchLine(cloned, line);
		cloned.locations = group.locations;
		return { value: cloned, counter: group.hits };
	});
}

function ensureBranchLines(value, counter, statementHelper) {
	if (!value) {
		return false;
	}
	let registered = false;
	const locationHits = getBranchLocationHits(counter);
	const branchHits = getBranchHitCount(counter);
	const primaryLine = getCanonicalBranchLine(value);
	const extraLine = getBranchDeclaredLine(value);
	const branchLines = new Set();
	if (primaryLine > 0) {
		branchLines.add(primaryLine);
	}
	if (extraLine > 0) {
		branchLines.add(extraLine);
	}
	if (primaryLine > 0 && value.line !== primaryLine) {
		setBranchLine(value, primaryLine);
	}
	for (const line of branchLines) {
		statementHelper.ensureLine(line, branchHits);
		registered = true;
	}
	const locations = Array.isArray(value.locations) ? value.locations : [];
	locations.forEach((location, index) => {
		const locationLine = getLocationLine(location);
		if (locationLine <= 0) {
			return;
		}
		const hits = locationHits[index] ?? 0;
		statementHelper.ensureLine(locationLine, hits);
		registered = true;
	});
	return registered;
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

function rebuildMap(map, counters, entries, onEntry) {
	for (const key of Object.keys(map)) {
		delete map[key];
	}
	for (const key of Object.keys(counters)) {
		delete counters[key];
	}
	entries.forEach((entry, index) => {
		map[index] = entry.value;
		counters[index] = entry.counter;
		if (typeof onEntry === "function") {
			onEntry(index, entry.value);
		}
	});
}

function trackStatementLine(lineToKey, line, key, origin) {
	if (typeof line !== "number" || line <= 0) {
		return;
	}
	const existing = lineToKey.get(line);
	if (existing) {
		if (existing.origin === "start" || origin !== "start") {
			return;
		}
	}
	lineToKey.set(line, { key: String(key), origin });
}

function registerStatementLines(lineToKey, statement, key) {
	trackStatementLine(lineToKey, statement.start?.line, key, "start");
	trackStatementLine(lineToKey, statement.end?.line, key, "end");
}

function createFlatStatement(line) {
	return {
		start: { line, column: 0 },
		end: { line, column: 0 },
	};
}

function getBranchHitCount(counter) {
	if (Array.isArray(counter)) {
		return counter.reduce((max, value) => {
			const num = typeof value === "number" ? value : Number(value);
			return Number.isFinite(num) ? Math.max(max, num) : max;
		}, 0);
	}
	return typeof counter === "number" && Number.isFinite(counter) ? counter : 0;
}

function getBranchLocationHits(counter) {
	if (Array.isArray(counter)) {
		return counter.map((value) => toFiniteNumber(value));
	}
	if (counter && typeof counter === "object") {
		return Object.keys(counter)
			.sort((a, b) => Number(a) - Number(b))
			.map((key) => toFiniteNumber(counter[key]));
	}
	return [toFiniteNumber(counter)];
}

function toFiniteNumber(value) {
	const num = typeof value === "number" ? value : Number(value);
	return Number.isFinite(num) ? num : 0;
}

function getCanonicalBranchLine(value) {
	const locationLines = [];
	if (Array.isArray(value?.locations)) {
		for (const location of value.locations) {
			const line =
				location?.start?.line ??
				location?.line ??
				location?.loc?.start?.line ??
				0;
			if (line > 0) locationLines.push(line);
		}
	}
	if (locationLines.length) {
		return Math.min(...locationLines);
	}
	const locLine = value?.loc?.start?.line ?? value?.loc?.line ?? 0;
	if (locLine > 0) {
		return locLine;
	}
	const directLine = typeof value?.line === "number" ? value.line : 0;
	return directLine > 0 ? directLine : 0;
}

function getBranchDeclaredLine(value) {
	return typeof value?.line === "number" && value.line > 0 ? value.line : 0;
}

function cloneBranchValue(value) {
	return {
		...value,
		loc: cloneLocation(value?.loc),
		locations: Array.isArray(value?.locations)
			? value.locations.map(cloneLocation)
			: value?.locations,
	};
}

function cloneLocation(location) {
	if (!location || typeof location !== "object") {
		return location ?? null;
	}
	const cloned = { ...location };
	if (location.start) {
		cloned.start = { ...location.start };
	}
	if (location.end) {
		cloned.end = { ...location.end };
	}
	if (location.loc) {
		cloned.loc = cloneLocation(location.loc);
	}
	if (location.line) {
		cloned.line = location.line;
	}
	return cloned;
}

function getLocationLine(location) {
	return (
		location?.start?.line ?? location?.line ?? location?.loc?.start?.line ?? 0
	);
}

function setBranchLine(value, line) {
	if (!value || line <= 0) {
		return;
	}
	value.line = line;
	value.loc = alignLocationLine(value.loc, line);
}

function alignLocationLine(location, line) {
	const cloned = cloneLocation(location ?? {});
	if (!cloned.start) {
		cloned.start = {};
	}
	cloned.start.line = line;
	if (typeof cloned.line === "number") {
		cloned.line = line;
	}
	return cloned;
}
