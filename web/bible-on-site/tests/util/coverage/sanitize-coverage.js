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
	return entryPath.startsWith(srcDir);
}

function sanitizeEntryData(entryData) {
	if (!entryData) return;
	debugEntry(entryData, "before");
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
		splitEntries.forEach(({ value: branchValue, counter: branchCounter }) => {
			const hasLines = ensureBranchLines(branchValue, branchCounter, statementHelper);
			if (hasLines) {
				branches.push({ value: branchValue, counter: branchCounter });
			}
		});
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
	branchLines.forEach((line) => {
		statementHelper.ensureLine(line, branchHits);
		registered = true;
	});
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
	return typeof counter === "number" && Number.isFinite(counter)
		? counter
		: 0;
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
				location?.start?.line ?? location?.line ?? location?.loc?.start?.line ?? 0;
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
		location?.start?.line ??
		location?.line ??
		location?.loc?.start?.line ??
		0
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
