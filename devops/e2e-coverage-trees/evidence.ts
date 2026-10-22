/**
 * Loaders for the per-test execution evidence the MobileE2E harness leaves
 * in the run's artifacts directory (#2085).
 *
 * Inputs (see docs/devops/e2e-test-selection.md for the full layout):
 *   - `app-coverage/<fileBase>-<outcome>.json` — `app-e2e-coverage-dump/1`
 *     records: the app's live AltCover hit snapshot pulled per scenario by
 *     `AppCoverage.cs` (#2156). `test` carries the fileBase (method name);
 *     the FQN is resolved through the coverage-evidence record of the same
 *     `{fileBase}-{outcome}` name, or test discovery.
 *   - `app-coverage/*.coverage-error.txt` — dumps that could not be pulled.
 *   - `coverage-evidence/<fileBase>-<outcome>.json` — `CoverageEvidence.cs`
 *     records with the FQN, session ids and UTC boundaries of each attempt.
 *   - `results/mobile-e2e.trx` / `results/mobile-e2e.xml` — xUnit TRX and
 *     JUnit reports: the executed-test list, outcomes and times.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { children, descendants, parseXml } from "./xml.ts";

const DUMP_KIND = "app-e2e-coverage-dump/1";

/** One pulled app-process hit snapshot (`app-e2e-coverage-dump/1`). */
export interface CoverageDump {
	/** File name inside the dumps directory. */
	name: string;
	/** Scenario fileBase — the [Fact]/[Theory] method name. */
	fileBase: string;
	outcome: string;
	platform: string;
	collectedUtc?: string;
	/** module hash → (visit key → hit count). */
	modules: Map<string, Map<number, number>>;
	/** `kind` values other than app-e2e-coverage-dump/1 land here. */
	untimed?: boolean;
}

/** A scenario whose coverage pull failed — `.coverage-error.txt` exists. */
export interface DumpError {
	fileBase: string;
	outcome: string;
	/** First line of the diagnostic file (bounded). */
	message: string;
}

export interface LoadedDumps {
	dumps: CoverageDump[];
	errors: DumpError[];
}

/** Splits `<fileBase>-<outcome>` on the last dash; method names contain none. */
export function splitFileBase(stem: string): { fileBase: string; outcome: string } {
	const dash = stem.lastIndexOf("-");
	if (dash === -1) return { fileBase: stem, outcome: "unknown" };
	return { fileBase: stem.slice(0, dash), outcome: stem.slice(dash + 1) };
}

function parseDump(name: string, json: string): CoverageDump {
	const record = JSON.parse(json) as {
		kind?: string;
		test?: string;
		platform?: string;
		outcome?: string;
		collectedUtc?: string;
		snapshot?: { modules?: Record<string, Record<string, number>> };
		modules?: Record<string, Record<string, number>>;
	};
	const rawModules = record.snapshot?.modules ?? record.modules;
	const modules = new Map<string, Map<number, number>>();
	for (const [hash, points] of Object.entries(rawModules ?? {})) {
		const hits = new Map<number, number>();
		for (const [key, count] of Object.entries(points)) {
			const pointKey = Number(key);
			if (Number.isInteger(pointKey) && typeof count === "number") {
				hits.set(pointKey, count);
			}
		}
		modules.set(hash, hits);
	}
	const { fileBase, outcome } = splitFileBase(name.replace(/\.json$/, ""));
	return {
		name,
		fileBase: record.test ?? fileBase,
		outcome: record.outcome ?? outcome,
		platform: record.platform ?? "",
		collectedUtc: record.collectedUtc,
		modules,
		// Raw snapshot files (e.g. the graceful-exit e2e-coverage.json) carry
		// hits but no scenario attribution — they join the shared bucket.
		untimed: record.kind !== DUMP_KIND,
	};
}

/**
 * Loads every `app-e2e-coverage-dump/1` record and `.coverage-error.txt` in
 * a dumps directory. Unknown JSON records are kept as untimed dumps so their
 * coverage is attributed conservatively rather than dropped.
 */
export function loadDumps(dir: string): LoadedDumps {
	if (!existsSync(dir)) return { dumps: [], errors: [] };
	const dumps: CoverageDump[] = [];
	const errors: DumpError[] = [];
	for (const name of readdirSync(dir).sort()) {
		if (name.endsWith(".coverage-error.txt")) {
			const stem = name.replace(/\.json\.coverage-error\.txt$/, "").replace(/\.coverage-error\.txt$/, "");
			const { fileBase, outcome } = splitFileBase(stem);
			const text = readFileSync(join(dir, name), "utf8").trim();
			errors.push({
				fileBase,
				outcome,
				message: (text.split("\n")[0] ?? "").slice(0, 300),
			});
			continue;
		}
		if (!name.endsWith(".json")) continue;
		dumps.push(parseDump(name, readFileSync(join(dir, name), "utf8")));
	}
	return { dumps, errors };
}

/** One executed test's run record (FQN + outcome + session/time boundaries). */
export interface TestRunRecord {
	/** Stable xUnit identity: `Namespace.Class.Method`. */
	id: string;
	outcome: string;
	sessions: string[];
	startedUtc?: string;
	endedUtc?: string;
	/** Theory case display suffixes (`(arg: x)`) seen for this method. */
	cases: string[];
	source: "evidence" | "trx" | "junit";
}

interface EvidenceRecord {
	test?: string;
	platform?: string;
	outcome?: string;
	sessions?: string[];
	startedUtc?: string;
	endedUtc?: string;
}

export interface LoadedEvidence {
	/** `{fileBase}-{outcome}` filename stem → run record (the exact join). */
	byStem: Map<string, TestRunRecord>;
	/** Every record, for listing which tests ran. */
	records: TestRunRecord[];
}

/** Loads `coverage-evidence/*.json` records written by the harness. */
export function loadEvidenceRecords(dir: string): LoadedEvidence {
	const byStem = new Map<string, TestRunRecord>();
	const records: TestRunRecord[] = [];
	if (!existsSync(dir)) return { byStem, records };
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith(".json")) continue;
		const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as EvidenceRecord;
		if (typeof record.test !== "string" || record.test.length === 0) continue;
		const run: TestRunRecord = {
			id: record.test,
			outcome: record.outcome ?? "unknown",
			sessions: [...new Set(record.sessions ?? [])].sort(),
			startedUtc: record.startedUtc,
			endedUtc: record.endedUtc,
			cases: [],
			source: "evidence",
		};
		byStem.set(name.replace(/\.json$/, ""), run);
		records.push(run);
	}
	return { byStem, records };
}

const normalizeOutcome = (outcome: string): string =>
	outcome === "Passed" || outcome === "passed"
		? "passed"
		: outcome === "Failed" || outcome === "failed"
			? "failed"
			: outcome.toLowerCase();

/**
 * Parses an xUnit/MTP TRX report into run records. `UnitTestResult` gives
 * the display name (`Namespace.Class.Method` plus any theory argument
 * suffix), outcome and start/end times; `TestMethod@className`+`@name`
 * resolves the FQN when the display name carries case data.
 */
export function loadTrx(path: string): TestRunRecord[] {
	const root = parseXml(readFileSync(path, "utf8"));
	const definitions = new Map<string, string>();
	for (const unitTest of descendants(root, "UnitTest")) {
		const method = descendants(unitTest, "TestMethod")[0];
		const id = unitTest.attrs.id;
		if (method !== undefined && id !== undefined) {
			const className = method.attrs.className ?? "";
			const name = method.attrs.name ?? "";
			if (className && name) definitions.set(id, `${className}.${name}`);
		}
	}
	const byId = new Map<string, TestRunRecord>();
	for (const result of descendants(root, "UnitTestResult")) {
		const displayName = result.attrs.testName ?? "";
		const defined = definitions.get(result.attrs.testId ?? "");
		const id = defined ?? (displayName.includes("(") ? displayName.slice(0, displayName.indexOf("(")) : displayName);
		if (!id) continue;
		const caseSuffix =
			displayName.startsWith(`${id}(`) ? displayName.slice(id.length) : "";
		const existing = byId.get(id);
		const times = {
			startedUtc: result.attrs.startTime,
			endedUtc: result.attrs.endTime,
		};
		if (existing !== undefined) {
			if (caseSuffix && !existing.cases.includes(caseSuffix)) existing.cases.push(caseSuffix);
			if (existing.outcome !== "failed") existing.outcome = normalizeOutcome(result.attrs.outcome ?? "unknown");
			if (existing.startedUtc === undefined) existing.startedUtc = times.startedUtc;
			existing.endedUtc = times.endedUtc ?? existing.endedUtc;
		} else {
			byId.set(id, {
				id,
				outcome: normalizeOutcome(result.attrs.outcome ?? "unknown"),
				sessions: [],
				startedUtc: times.startedUtc,
				endedUtc: times.endedUtc,
				cases: caseSuffix ? [caseSuffix] : [],
				source: "trx",
			});
		}
	}
	return [...byId.values()];
}

/**
 * Parses the xUnit JUnit report (`mobile-e2e.xml`) as a fallback test list:
 * `testcase@className`+`@name` forms the FQN unless `@name` is already fully
 * qualified (as in MTP reports); a `failure`/`error` child marks
 * the outcome.
 */
export function loadJunit(path: string): TestRunRecord[] {
	const root = parseXml(readFileSync(path, "utf8"));
	const records: TestRunRecord[] = [];
	for (const testcase of descendants(root, "testcase")) {
		const className = testcase.attrs.classname ?? testcase.attrs.className ?? "";
		const name = testcase.attrs.name ?? "";
		if (!className || !name) continue;
		const failed = children(testcase, "failure").length + children(testcase, "error").length > 0;
		const skipped = children(testcase, "skipped").length > 0;
		records.push({
			id: name.startsWith(`${className}.`) ? name : `${className}.${name}`,
			outcome: failed ? "failed" : skipped ? "skipped" : "passed",
			sessions: [],
			cases: [],
			source: "junit",
		});
	}
	return records;
}
