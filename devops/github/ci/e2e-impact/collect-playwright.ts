/**
 * Collector for the Playwright E2E suites (#2085): turns run evidence into
 * a coverage tree for the website, admin and API e2e suites.
 *
 * Evidence layout under `--artifacts <dir>` (the suite's
 * `.coverage/e2e-impact/`, written by `web/shared/tests-util/e2e-impact.mjs`
 * during `MEASURE_COV` runs):
 * - `discovered.json` — the runtime test list (reconciled with the static
 *   discovery the selector uses; runtime-only ids are diagnostics).
 * - `test-results.json` — per-test outcomes across retries and projects.
 * - `coverage/*.json` — per-test istanbul maps, tagged `browser` (exact
 *   per-context coverage) or `server` (a shared dev-server process drain —
 *   process-wide counters can leak across parallel workers, so every
 *   server-realm file lands in `sharedFiles`, never a per-test claim).
 *
 * Two evidence strategies, selected by `rules.collector`:
 * - `playwright-istanbul` (website/admin): coverage dumps above.
 * - `api-operations` (API): no per-test process coverage exists for Rust —
 *   tests attribute statically instead: the GraphQL operations and REST
 *   paths each test file exercises resolve through `api-map.ts` (resolver
 *   files plus their `use`-graph closure). Router/dispatch files are shared.
 *
 * Tests with no attributable evidence are marked `unattributed` and cover
 * the union of every attributed file plus shared coverage — any covered or
 * in-scope change runs them; missing evidence can never skip a test.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	buildApiSourceMap,
	depsClosure,
	graphqlOperationsInSource,
	restPaths,
} from "./api-map.ts";
import { fingerprintSource, type SourceFingerprint } from "./fingerprint.ts";
import { globMatcher } from "./glob.ts";
import { discoverPlaywrightTests, type PlaywrightDiscovery } from "./playwright-discovery.ts";
import { stripExtension } from "./select.ts";
import { listFiles } from "./xunit-discovery.ts";
import {
	SCHEMA_VERSION,
	type CoverageTree,
	type CoverageTreeTest,
	type SuiteRules,
} from "./model.ts";

export interface CollectPlaywrightOptions {
	repoRoot: string;
	rules: SuiteRules;
	/** Suite platform key (single-platform web suites use `web`). */
	platform: string;
	/** Evidence directory — `.coverage/e2e-impact` under the suite package. */
	artifactsDir: string;
	snapshotSha: string;
	/** Mark false when the test run did not finish — evidence stays partial. */
	complete: boolean;
}

interface CoverageDump {
	id: string;
	project?: string;
	file?: string;
	titlePath?: string[];
	realm: "browser" | "server";
	coverage: Record<string, unknown>;
}

interface ResultRecord {
	id: string;
	project?: string;
	retry: number;
	status: string;
	outcome?: string;
}

interface DiscoveredRecord {
	id: string;
	project?: string;
	file?: string;
	titlePath?: string[];
}

/**
 * Reads an evidence JSON file; a corrupt file returns `null` and records
 * itself in `corrupt` — evidence integrity problems mark the tree
 * incomplete rather than failing the collect step (#2085).
 */
const readJson = <T>(path: string, corrupt: string[]): T | null => {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch (error) {
		console.warn(`[e2e-impact] corrupt evidence file ${path}: ${String(error)}`);
		corrupt.push(path);
		return null;
	}
};

/** Loads per-test istanbul dumps; a missing directory yields no evidence. */
function loadCoverageDumps(dir: string, corrupt: string[]): CoverageDump[] {
	const coverageDir = join(dir, "coverage");
	if (!existsSync(coverageDir)) return [];
	return readdirSync(coverageDir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => readJson<CoverageDump>(join(coverageDir, name), corrupt))
		.filter((dump) => dump !== null);
}

function loadResults(dir: string, corrupt: string[]): ResultRecord[] {
	const path = join(dir, "test-results.json");
	if (!existsSync(path)) return [];
	const doc = readJson<{ schema: string; tests: ResultRecord[] }>(path, corrupt);
	return doc?.tests ?? [];
}

function loadRuntimeDiscovery(dir: string, corrupt: string[]): DiscoveredRecord[] {
	const path = join(dir, "discovered.json");
	if (!existsSync(path)) return [];
	const doc = readJson<{ schema: string; tests: DiscoveredRecord[] }>(path, corrupt);
	return doc?.tests ?? [];
}

/**
 * Normalizes an istanbul coverage key to a repo-relative path inside
 * `sourcesRoot`, or null when it cannot map (node_modules, build internals,
 * paths outside the module). Server dev transforms can surface absolute
 * OS paths, `file://`/`http(s)://` URLs, `/@fs/` prefixes and Vite `?query`
 * suffixes.
 */
export function normalizeCoveragePath(
	rawPath: string,
	sourcesRoot: string,
): string | null {
	let p = rawPath.replace(/\\/g, "/").split("?")[0];
	p = p.replace(/^file:\/\/\/?/, "").replace(/^https?:\/\/[^/]+/, "");
	if (p.includes("node_modules")) return null;
	const marker = `/${sourcesRoot}/`;
	const idx = p.indexOf(marker);
	if (idx !== -1) return p.slice(idx + 1);
	if (p.startsWith(`${sourcesRoot}/`)) return p;
	const srcIdx = p.indexOf("/src/");
	if (srcIdx !== -1) return `${sourcesRoot}${p.slice(srcIdx)}`;
	if (p.startsWith("src/")) return `${sourcesRoot}/${p}`;
	return null;
}

/** istanbul dump key set → repo-relative files inside the suite's sources. */
function coverageFiles(
	coverage: Record<string, unknown>,
	sourcesRoot: string,
	sourceSet: ReadonlySet<string>,
): string[] {
	const files = new Set<string>();
	for (const key of Object.keys(coverage)) {
		const repoPath = normalizeCoveragePath(key, sourcesRoot);
		if (repoPath !== null && sourceSet.has(repoPath)) files.add(repoPath);
	}
	return [...files].sort();
}

/** `expected` → passed; everything else preserves the failure-ish state. */
const outcomeOf = (record: ResultRecord): string => {
	const outcome = record.outcome ?? record.status;
	if (outcome === "expected" || outcome === "passed") return "passed";
	if (outcome === "flaky") return "flaky";
	if (outcome === "skipped") return "skipped";
	return "failed";
};

/** Merges outcome across projects/retries: non-passed wins (conservative). */
function outcomeRank(outcome: string): number {
	return outcome === "passed" ? 0 : 1;
}

export function collectPlaywrightTree(
	options: CollectPlaywrightOptions,
): CoverageTree {
	const { repoRoot, rules } = options;
	const sourcesRoot = join(repoRoot, rules.sources.root);
	const sourceMatches = globMatcher(rules.sources.globs);
	const sourceFiles = listFiles(sourcesRoot, "**/*")
		.map((file) => relative(repoRoot, file).replace(/\\/g, "/"))
		.filter((file) =>
			sourceMatches(relative(sourcesRoot, join(repoRoot, file)).replace(/\\/g, "/")),
		)
		.sort();
	const sourceSet = new Set(sourceFiles);
	// Units map stems, not classes — `x.ts`/`x.tsx`/`x.css` each stay their
	// own unit; the selector's stem fallback already behaves this way.
	const sourceUnits: Record<string, string[]> = {};
	for (const file of sourceFiles) {
		const stem = stripExtension(file);
		sourceUnits[stem] = [...(sourceUnits[stem] ?? []), file].sort();
	}
	const sourceFingerprints: Record<string, SourceFingerprint> = {};
	for (const file of sourceFiles) {
		const fp = fingerprintSource(file, readFileSync(join(repoRoot, file), "utf8"));
		if (fp !== null) sourceFingerprints[file] = fp;
	}

	const discovery: PlaywrightDiscovery = discoverPlaywrightTests(
		repoRoot,
		rules.tests.root,
		rules.tests.glob,
		rules.tests.testDir,
	);
	const fileByTest = new Map(discovery.tests.map((test) => [test.id, test.file]));

	// Corrupt evidence files mark the tree incomplete — partial evidence can
	// be trusted to widen a selection but never to serve as a new baseline.
	const corrupt: string[] = [];

	// ── Outcomes ──────────────────────────────────────────────────────────
	const outcomes = new Map<string, string>();
	for (const record of loadResults(options.artifactsDir, corrupt)) {
		const merged = outcomeOf(record);
		const prev = outcomes.get(record.id);
		if (prev === undefined || outcomeRank(merged) >= outcomeRank(prev)) {
			outcomes.set(record.id, merged);
		}
	}

	// ── Per-test evidence ─────────────────────────────────────────────────
	const covered = new Map<string, Set<string>>(); // id → per-test files
	const shared = new Set<string>();
	const unmatched = new Set<string>();
	const unmappedByTest = new Map<string, Set<string>>();

	if (rules.collector === "api-operations") {
		// API suite: static operation/path attribution (no runtime coverage).
		const map = buildApiSourceMap(sourcesRoot, rules.sources.root);
		const sharedRoutes = new Set<string>();
		for (const files of Object.values(map.routes)) {
			for (const file of files) sharedRoutes.add(file);
		}
		for (const file of sharedRoutes) shared.add(file);
		const testFiles = new Set(discovery.tests.map((test) => test.file));
		for (const testFile of [...testFiles].sort()) {
			const source = readFileSync(join(repoRoot, testFile), "utf8");
			const ops = graphqlOperationsInSource(source);
			const paths = restPaths(source);
			const opFiles = new Set<string>();
			const unmapped = new Set<string>();
			for (const op of ops) {
				const file = map.operations[op];
				if (file === undefined) unmapped.add(op);
				else {
					for (const dep of depsClosure(map.deps, [file])) {
						if (sourceSet.has(dep)) opFiles.add(dep);
					}
				}
			}
			for (const path of paths) {
				const mapped = map.routes[path];
				if (mapped === undefined) {
					// Unknown or external path — not attributable.
					if (path.startsWith("/api") || path === "/") unmapped.add(path);
					continue;
				}
				// Router/handler files are shared dispatch — never per-test.
				for (const file of mapped) shared.add(file);
			}
			for (const test of discovery.tests.filter((t) => t.file === testFile)) {
				covered.set(test.id, new Set(opFiles));
				if (unmapped.size > 0) {
					unmappedByTest.set(
						test.id,
						new Set([...(unmappedByTest.get(test.id) ?? []), ...unmapped]),
					);
				}
			}
		}
	} else {
		// Istanbul suites: browser realm is per-test; server realm is shared.
		const dumps = loadCoverageDumps(options.artifactsDir, corrupt);
		const serverFiles = new Set<string>();
		for (const dump of dumps) {
			if (dump.realm === "server") {
				for (const file of coverageFiles(dump.coverage, rules.sources.root, sourceSet)) {
					serverFiles.add(file);
				}
			}
		}
		for (const file of serverFiles) shared.add(file);
		for (const dump of dumps) {
			if (dump.realm !== "browser") continue;
			const files = coverageFiles(dump.coverage, rules.sources.root, sourceSet);
			if (fileByTest.get(dump.id) === undefined) {
				// Runtime-only tests — dynamic files discovery could not
				// resolve statically. Their coverage can never support a
				// per-test selection claim, so it widens into shared coverage
				// (a touching change runs the whole suite) instead of
				// vanishing into diagnostics.
				unmatched.add(dump.id);
				for (const file of files) shared.add(file);
				continue;
			}
			const entry = covered.get(dump.id) ?? new Set<string>();
			for (const file of files) {
				if (!shared.has(file)) entry.add(file);
			}
			if (entry.size > 0 || !covered.has(dump.id)) covered.set(dump.id, entry);
		}
	}

	// ── Reconcile runtime discovery (diagnostics only) ────────────────────
	for (const record of loadRuntimeDiscovery(options.artifactsDir, corrupt)) {
		if (!covered.has(record.id) && fileByTest.get(record.id) === undefined) {
			unmatched.add(`runtime-only:${record.id}`);
		}
	}

	// ── Compose entries ───────────────────────────────────────────────────
	const allAttributed = new Set<string>();
	for (const files of covered.values()) for (const file of files) allAttributed.add(file);
	const unionAll = [...new Set([...allAttributed, ...shared])].sort();

	const tests: Record<string, CoverageTreeTest> = {};
	const candidateIds = new Set([...fileByTest.keys(), ...covered.keys()]);
	for (const id of [...candidateIds].sort()) {
		const files = covered.get(id);
		const unattributed = files === undefined || files.size === 0;
		tests[id] = {
			...(fileByTest.has(id) ? { file: fileByTest.get(id) } : {}),
			files: unattributed ? unionAll : [...(files as Set<string>)].sort(),
			...(unattributed ? { unattributed: true } : {}),
			automationIds: [],
			unmappedIds: [...(unmappedByTest.get(id) ?? [])].sort(),
			sessions: [],
			outcome: outcomes.get(id) ?? "unknown",
		};
		if (fileByTest.get(id) === undefined) unmatched.add(id);
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		suite: rules.suite,
		platform: options.platform,
		snapshotSha: options.snapshotSha,
		collectorVersion: rules.collectorVersion,
		collectedAtUtc: new Date().toISOString(),
		complete:
			options.complete &&
			corrupt.length === 0 &&
			(rules.collector === "api-operations" ||
				existsSync(join(options.artifactsDir, "coverage"))),
		sourceUnits,
		sourceFiles,
		sourceFingerprints,
		...(shared.size > 0 ? { sharedFiles: [...shared].sort() } : {}),
		tests: Object.fromEntries(
			Object.entries(tests).sort(([a], [b]) => a.localeCompare(b)),
		),
		...(unmatched.size > 0 ? { unmatchedEvidence: [...unmatched].sort() } : {}),
	};
}
