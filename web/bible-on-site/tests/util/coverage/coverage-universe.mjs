/**
 * Canonical coverage universe for `src/` (#2670).
 *
 * Every layer that reports coverage — jest (`@swc/jest`) and the instrumented
 * dev server (turbopack) — runs `swc-plugin-coverage-instrument`, but the dev
 * server compiles modules on demand through a different pipeline that emits a
 * *variant* map: `istanbul ignore` comments are lost (they get instrumented
 * anyway), generated modules (`data<hash>`, `[json].cjs`, font chunks) appear
 * with fake src-relative paths, and the `.next` filesystem cache can keep
 * stale variants alive across runs. That made the e2e LCOV's file/line/branch
 * universe — and therefore the codecov `website` denominator — jitter between
 * identical runs.
 *
 * This module builds the *canonical* instrumented map for every src file —
 * the exact transform jest applies (`buildSwcTransformOpts` in `@swc/jest` —
 * so each collected entry can be projected onto deterministic coordinates at
 * collection time. A coverage entry from ANY compile variant then contributes
 * only hit counts matched onto canonical locations; foreign coordinates drop,
 * and files that were never instrumented keep their zero-hit canonical map.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import picomatch from "picomatch";
import { covIgnoreList } from "../../../.covignore.mjs";

/**
 * @typedef {Object} Position
 * @property {number} line
 * @property {number} column
 */

/**
 * @typedef {Object} Location
 * @property {Position} start
 * @property {Position} end
 */

/**
 * A canonical instrumented record: the maps jest's transform enumerates for
 * the file, with zero-hit counters.
 * @typedef {Object} CanonicalEntry
 * @property {string} path Absolute (platform-resolved) file path
 * @property {string} hash Instrumented-content hash emitted by the plugin
 * @property {Object.<string, Location>} statementMap
 * @property {Object.<string, {decl?: Location, loc?: Location, line?: number}>} fnMap
 * @property {Object.<string, {loc?: Location, locations?: Location[], line?: number}>} branchMap
 * @property {Object.<string, number>} s
 * @property {Object.<string, number>} f
 * @property {Object.<string, number|number[]>} b
 */

// File extensions jest's coverage transform regex (`^.+\.(t|j)sx?$`) covers.
const INSTRUMENTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// @swc/jest's buildSwcTransformOpts output for this project's swcCoverageConfig
// on node >= 18 (nodeTarget() -> es2023) without --experimental-vm-modules
// (module type -> commonjs). Keeping these identical is what makes the
// universe's coordinates match the unit layer's exactly.
const CANONICAL_SWC_OPTIONS = {
	jsc: {
		target: "es2023",
		parser: { syntax: "typescript", tsx: true },
		transform: {
			react: { runtime: "automatic" },
			hidden: { jest: true },
		},
		experimental: {
			plugins: [
				["swc-plugin-coverage-instrument", { unstableExclude: covIgnoreList }],
			],
		},
	},
	sourceMaps: "inline",
	module: { type: "commonjs" },
};

const universeCache = new Map();

// @swc/core is loaded lazily: a top-level import would crash every module that
// pulls in sanitize-coverage.mjs — including plain `test:e2e` runs that never
// collect coverage — on machines where the native binding cannot load.
let swcModule;
function loadSwc() {
	if (!swcModule) {
		// Callers run from the package root; resolve like jest's transform does.
		swcModule = createRequire(path.resolve("package.json"))("@swc/core");
	}
	return swcModule;
}

/**
 * The canonical instrumented universe for every instrumentable file under
 * `srcDir`, keyed by absolute resolved path. Memoized per srcDir — building it
 * re-transforms each file once per process.
 *
 * Throws when @swc/core cannot load (native binding missing) — coverage
 * collection then fails loudly rather than emitting a silently variant
 * universe.
 *
 * @param {string} srcDir - Absolute path to the src directory
 * @returns {Map<string, CanonicalEntry>}
 */
export function getCoverageUniverse(srcDir) {
	const resolvedSrcDir = path.resolve(srcDir);
	let universe = universeCache.get(resolvedSrcDir);
	if (!universe) {
		universe = buildCoverageUniverse(resolvedSrcDir);
		universeCache.set(resolvedSrcDir, universe);
	}
	return universe;
}

/** Test hook: drop memoized universes (used between fixture dirs). */
export function resetCoverageUniverseCache() {
	universeCache.clear();
}

/**
 * Does `relativePath` (posix separators, relative to the package root) match
 * covIgnoreList? Shared by the universe build and sanitizeCoverage's tracked
 * check so both agree on which files are instrumentable.
 * @param {string} relativePath
 */
export function isCovIgnored(relativePath) {
	return covIgnoreList.some((pattern) => {
		// Prepend **/ if pattern doesn't already start with it, to match anywhere in path
		const globPattern = pattern.startsWith("**/") ? pattern : `**/${pattern}`;
		return picomatch(globPattern)(relativePath);
	});
}

function buildCoverageUniverse(srcDir) {
	const universe = new Map();
	const projectRoot = path.dirname(srcDir);
	const failures = [];

	for (const filePath of walkSourceFiles(srcDir)) {
		const relativePath = path
			.relative(projectRoot, filePath)
			.replace(/\\/g, "/");
		if (isCovIgnored(relativePath)) continue;
		try {
			const entry = instrumentFile(filePath);
			// Files the plugin's unstableExclude skips emit no coverage fn at
			// all — they stay out of the universe so their records drop too.
			if (entry) universe.set(path.resolve(filePath), entry);
		} catch (error) {
			failures.push(`${relativePath}: ${error?.message ?? error}`);
		}
	}

	if (failures.length > 0) {
		// A failed transform drops that file's coverage records entirely —
		// loud, not silent, so config drift is caught here and in tests.
		console.error(
			`[coverage-universe] ${failures.length} src file(s) failed canonical instrumentation:\n  ` +
				failures.join("\n  "),
		);
	}
	return universe;
}

function* walkSourceFiles(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkSourceFiles(full);
		} else if (
			entry.isFile() &&
			INSTRUMENTABLE_EXTENSIONS.has(path.extname(entry.name))
		) {
			yield full;
		}
	}
}

/**
 * Run the canonical transform on one file and extract the plugin's
 * `cov_<hash>()` initializer output — the FileCoverage-shaped record with
 * statement/fn/branch maps and zeroed counters.
 * @param {string} filePath
 * @returns {CanonicalEntry | null}
 */
function instrumentFile(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const { code } = loadSwc().transformSync(source, {
		...CANONICAL_SWC_OPTIONS,
		filename: filePath,
	});
	const initializer = extractCoverageInitializer(code);
	if (!initializer) return null;

	const sandbox = {};
	vm.createContext(sandbox);
	vm.runInContext(initializer, sandbox);
	const coverage = sandbox.__coverage__;
	if (!coverage) return null;
	const data = coverage[Object.keys(coverage)[0]];
	if (!data) return null;
	// Normalize to the resolved absolute path the universe is keyed on — the
	// plugin may emit a different separator style than path.resolve().
	return { ...data, path: path.resolve(filePath) };
}

/**
 * The swc coverage plugin emits `function cov_<hash>() { ... __coverage__[path] = data; return data; }`.
 * Extract an expression that calls it, so evaluating it in a sandbox yields
 * the coverage record without executing the rest of the module.
 */
function extractCoverageInitializer(code) {
	const match = code.match(/function (cov_\d+)\(\)\s*\{/);
	if (!match) return null;
	let depth = 0;
	const start = code.indexOf("{", match.index);
	let end = -1;
	for (let i = start; i < code.length; i++) {
		if (code[i] === "{") depth++;
		else if (code[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) return null;
	return `(${code.slice(match.index, end + 1)})()`;
}

/**
 * Rewrite `entryData` onto the canonical map: the record keeps its hit
 * counts, re-expressed on canonical statement/fn/branch coordinates.
 * Coordinates the canonical map doesn't know (e.g. `istanbul ignore` regions
 * a comment-stripping variant instrumented anyway, or locations from a stale
 * cache compile) contribute hits only through containment onto canonical
 * regions — never new coordinates.
 *
 * @param {CanonicalEntry} canonical - Universe entry for the file
 * @param {Object} entryData - Collected coverage record (any variant)
 * @param {Object} [projected] - Pre-computed projectCounters() result, when
 * the caller merged several records for the same canonical file first
 */
export function rewriteToCanonical(
	canonical,
	entryData,
	projected = projectCounters(canonical, entryData),
) {
	entryData.path = canonical.path;
	entryData.hash = canonical.hash;
	entryData.statementMap = structuredClone(canonical.statementMap);
	entryData.fnMap = structuredClone(canonical.fnMap);
	entryData.branchMap = structuredClone(canonical.branchMap);
	if ("inputSourceMap" in canonical) {
		entryData.inputSourceMap = canonical.inputSourceMap;
	} else {
		delete entryData.inputSourceMap;
	}
	entryData.s = projected.s;
	entryData.f = projected.f;
	entryData.b = projected.b;
}

/**
 * Re-express a variant record's counters on the canonical key space.
 * Same instrumented hash → identical map → keyed copy (the common case on the
 * jest side and for in-sync dev-server compiles). Otherwise locations match
 * by equality or containment, taking max hits.
 *
 * @param {CanonicalEntry} canonical
 * @param {Object} entryData
 * @returns {{s: Object.<string, number>, f: Object.<string, number>, b: Object.<string, number|number[]>}}
 */
export function projectCounters(canonical, entryData) {
	if (entryData.hash === canonical.hash) {
		return {
			s: { ...(entryData.s ?? {}) },
			f: { ...(entryData.f ?? {}) },
			b: { ...(entryData.b ?? {}) },
		};
	}
	return {
		s: projectScalarHits(
			canonical.statementMap ?? {},
			entryData.statementMap ?? {},
			entryData.s ?? {},
			(stmt) => stmt,
		),
		f: projectScalarHits(
			canonical.fnMap ?? {},
			entryData.fnMap ?? {},
			entryData.f ?? {},
			(fn) => fn.decl ?? fn.loc,
		),
		b: projectBranchHits(canonical.branchMap ?? {}, entryData),
	};
}

function projectScalarHits(canonicalMap, variantMap, variantCounters, locOf) {
	const variantItems = Object.entries(variantMap)
		.map(([key, item]) => ({
			loc: locOf(item),
			hits: toFiniteNumber(variantCounters[key]),
		}))
		.filter((item) => item.loc && item.hits > 0);
	const out = {};
	for (const [key, item] of Object.entries(canonicalMap)) {
		const canonicalLoc = locOf(item);
		let hit = 0;
		for (const variant of variantItems) {
			if (
				canonicalLoc &&
				(locationsEqual(variant.loc, canonicalLoc) ||
					locationContains(variant.loc, canonicalLoc) ||
					locationContains(canonicalLoc, variant.loc))
			) {
				hit = Math.max(hit, variant.hits);
			}
		}
		out[key] = hit;
	}
	return out;
}

function projectBranchHits(canonicalBranchMap, entryData) {
	// Flatten variant branches into individual arm records.
	const variantArms = [];
	for (const [key, branch] of Object.entries(entryData.branchMap ?? {})) {
		const hits = branchArmHits(entryData.b?.[key]);
		const locs = branchArmLocations(branch);
		locs.forEach((loc, index) => {
			const hit = hits[index] ?? hits[hits.length - 1] ?? 0;
			if (loc && hit > 0) variantArms.push({ loc, hits: hit });
		});
	}
	const out = {};
	for (const [key, branch] of Object.entries(canonicalBranchMap)) {
		out[key] = branchArmLocations(branch).map((canonicalArmLoc) => {
			let hit = 0;
			for (const variant of variantArms) {
				if (
					canonicalArmLoc &&
					(locationsEqual(variant.loc, canonicalArmLoc) ||
						locationContains(variant.loc, canonicalArmLoc) ||
						locationContains(canonicalArmLoc, variant.loc))
				) {
					hit = Math.max(hit, variant.hits);
				}
			}
			return hit;
		});
	}
	return out;
}

function branchArmLocations(branch) {
	if (Array.isArray(branch?.locations) && branch.locations.length > 0) {
		return branch.locations;
	}
	return branch?.loc ? [branch.loc] : [];
}

function branchArmHits(counter) {
	if (Array.isArray(counter)) return counter.map(toFiniteNumber);
	if (counter && typeof counter === "object") {
		return Object.keys(counter)
			.sort((a, b) => Number(a) - Number(b))
			.map((key) => toFiniteNumber(counter[key]));
	}
	return [toFiniteNumber(counter)];
}

function locationsEqual(a, b) {
	return positionEqual(a.start, b.start) && positionEqual(a.end, b.end);
}

function positionEqual(a, b) {
	return a?.line === b?.line && (a?.column ?? 0) === (b?.column ?? 0);
}

function locationContains(outer, inner) {
	return (
		positionLE(outer?.start, inner?.start) && positionLE(inner?.end, outer?.end)
	);
}

function positionLE(a, b) {
	if (!a || !b || a.line == null || b.line == null) return false;
	return (
		a.line < b.line || (a.line === b.line && (a.column ?? 0) <= (b.column ?? 0))
	);
}

function toFiniteNumber(value) {
	const num = typeof value === "number" ? value : Number(value);
	return Number.isFinite(num) ? num : 0;
}
