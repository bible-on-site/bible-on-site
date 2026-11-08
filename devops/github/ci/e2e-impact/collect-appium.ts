/**
 * Collector for the Appium suites (#2085): turns per-scenario evidence
 * recorded by the C# harness into a platform coverage tree.
 *
 * Evidence: `coverage-evidence/*.json` inside the run's artifacts directory,
 * written by `CoverageEvidence` in `app/BibleOnSite.Tests.MobileE2E` — each
 * record lists the automation ids a test queried through its driver and the
 * Appium session ids attributed to it.
 *
 * The collector resolves automation ids to the app source files declaring
 * them (XAML `AutomationId="X"`, C# `AutomationId = "X"` including
 * interpolated `$"Prefix{n}"` forms, and `SetAutomationId` calls), groups
 * files into logical units (`X.xaml` + `X.xaml.cs` + verified `X.*.cs`
 * partials), and emits the deterministic tree consumed by `select`.
 *
 * When a compatible `exec-coverage-tree` of the same run is supplied
 * (`CollectOptions.execTree`), its per-test executed-file evidence unions
 * into the same entries — the channels are complementary, so a file
 * covered by either selects the test — and its `shared` bucket surfaces
 * as `sharedFiles` (selection widens, never narrows). Missing or
 * incompatible exec input leaves the automation-id output untouched.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { ExecCoverageTree } from "../../../e2e-coverage-trees/model.ts";
import {
	execSelectorView,
	execTreeCompatible,
} from "../../../e2e-coverage-trees/to-selector-tree.ts";
import { fingerprintSource, type SourceFingerprint } from "./fingerprint.ts";
import { globMatcher } from "./glob.ts";
import { stripExtension } from "./select.ts";
import {
	listFiles,
	discoverSuiteTests,
	isPartialClassOf,
} from "./xunit-discovery.ts";
import { SCHEMA_VERSION, type CoverageTree, type SuiteRules } from "./model.ts";
import { caseDurations, evidenceDurations, mergeOverhead, mergeTiming, observedOverheadMs } from "./timings.ts";

export interface EvidenceRecord {
	test: string;
	platform?: string;
	outcome?: string;
	sessions?: string[];
	automationIds?: string[];
	startedUtc?: string;
	endedUtc?: string;
}

interface IdPattern {
	/** `literal` for exact ids, `wildcard` for `Prefix{...}` interpolations. */
	kind: "literal" | "wildcard";
	pattern: string;
	/** Matches a recorded automation id against the declaration pattern. */
	matches: (id: string) => boolean;
	file: string;
}

const XAML_ID = /\bAutomationId="([^"]+)"/g;
const CSHARP_ID = /\bAutomationId\s*=\s*(\$?)"([^"]+)"/g;
const SET_ID = /SetAutomationId\s*\(\s*[^,]+,\s*"([^"]+)"\s*\)/g;

/** Literal `*` matcher: ordered non-empty anchors, no regex engine involved. */
export function wildcardMatch(pattern: string): (value: string) => boolean {
	const parts = pattern.split("*");
	if (parts.length === 1) return (value) => value === pattern;
	return (value) => {
		if (!value.startsWith(parts[0])) return false;
		let position = parts[0].length;
		for (const part of parts.slice(1, -1)) {
			const index = value.indexOf(part, position);
			if (index === -1) return false;
			position = index + part.length;
		}
		const last = parts[parts.length - 1];
		return (
			last === "" ||
			(value.endsWith(last) && value.length - last.length >= position)
		);
	};
}

/** Scans app sources for automation-id declarations. */
export function scanAutomationIds(
	files: { path: string; content: string }[],
): IdPattern[] {
	const patterns: IdPattern[] = [];
	for (const { path, content } of files) {
		const add = (kind: IdPattern["kind"], raw: string) => {
			if (raw.startsWith("{")) return; // bound value — not a stable id
			const pattern = kind === "wildcard" ? raw.replace(/\{[^}]*\}/g, "*") : raw;
			patterns.push({ kind, pattern, matches: wildcardMatch(pattern), file: path });
		};
		for (const match of content.matchAll(XAML_ID)) add("literal", match[1]);
		for (const match of content.matchAll(CSHARP_ID)) {
			add(match[1] === "$" ? "wildcard" : "literal", match[2]);
		}
		for (const match of content.matchAll(SET_ID)) add("literal", match[1]);
	}
	return patterns;
}

/**
 * Groups scanned source files into logical units. `X.xaml`, `X.xaml.cs` and
 * `X.*.cs` files that declare `partial class X` share unit `dir/X`; every
 * other file is its own unit `dir/File`.
 */
export function computeSourceUnits(
	files: { path: string; content: string }[],
): Record<string, string[]> {
	const stems = new Set(files.map(({ path }) => stripExtension(path)));
	const unitOf = new Map<string, string>();
	for (const { path, content } of files) {
		const stem = stripExtension(path);
		const base = basename(stem);
		const dot = base.indexOf(".");
		let unit = stem;
		if (dot > 0 && !path.endsWith(".xaml.cs")) {
			const dir = stem.includes("/") ? `${stem.slice(0, stem.lastIndexOf("/"))}/` : "";
			const parent = `${dir}${base.slice(0, dot)}`;
			if (stems.has(parent) && isPartialClassOf(content, base.slice(0, dot))) {
				unit = parent;
			}
		}
		unitOf.set(path, unit);
	}
	const units: Record<string, string[]> = {};
	for (const [file, unit] of unitOf) {
		units[unit] = [...(units[unit] ?? []), file].sort();
	}
	return Object.fromEntries(Object.entries(units).sort(([a], [b]) => a.localeCompare(b)));
}

/** Loads every evidence record in an artifacts `coverage-evidence` directory. */
export function loadEvidence(dir: string): EvidenceRecord[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.flatMap((name) => {
			try {
				return [JSON.parse(readFileSync(join(dir, name), "utf8")) as EvidenceRecord];
			} catch (error) {
				throw new Error(`Corrupt evidence file ${name}: ${String(error)}`);
			}
		});
}

export interface CollectOptions {
	repoRoot: string;
	rules: SuiteRules;
	platform: string;
	artifactsDir: string;
	snapshotSha: string;
	/** Mark false when the test run did not finish — evidence stays partial. */
	complete: boolean;
	/**
	 * The run's `exec-coverage-tree`, when the extractor produced one
	 * (#2085). Only a compatible tree (suite/platform/snapshot — see
	 * `execTreeCompatible`) merges; anything else is ignored so exec
	 * evidence can widen but never replace the automation-id channel.
	 */
	execTree?: ExecCoverageTree;
	/**
	 * The published baseline this run descends from (#2263): per-case rolling
	 * timing and pilot overhead carry forward and merge with this run's
	 * observations. Missing or incompatible history is simply absent —
	 * timing never blocks collection.
	 */
	history?: CoverageTree;
	/**
	 * Observed non-case pilot time in ms. When absent the collector derives
	 * it from the artifacts' `pilot-timing.json` minus the measured case
	 * durations; the merge step passes the explicit mean of its shards.
	 */
	overheadMs?: number;
}

const unionSorted = (a: string[], b: string[]): string[] =>
	[...new Set([...a, ...b])].sort();

/**
 * A non-"passed" outcome from either channel wins: `previously-failing`
 * selection keys on `outcome !== "passed"`, so masking a failure or a
 * skipped record would under-select.
 */
const mergeOutcome = (primary: string, exec: string): string =>
	primary !== "passed" ? primary : exec;

export function collectTree(options: CollectOptions): CoverageTree {
	const { repoRoot, rules, platform } = options;
	const sourceRoot = join(repoRoot, rules.sources.root);
	const sourceMatches = globMatcher(rules.sources.globs);
	const sourceFiles = listFiles(sourceRoot, "**/*")
		.filter((file) =>
			sourceMatches(relative(sourceRoot, file).replace(/\\/g, "/")),
		)
		.map((file) => relative(repoRoot, file).replace(/\\/g, "/"))
		.sort();
	const sources = sourceFiles.map((file) => ({
		path: file,
		content: readFileSync(join(repoRoot, file), "utf8"),
	}));

	const idIndex = scanAutomationIds(sources);
	const sourceUnits = computeSourceUnits(sources);
	// Structural fingerprints persist the snapshot's trivia-insensitive digest
	// per file so future selections can prove a diff was comment/format-only.
	// Unfingerprintable files are simply absent — always read as changed.
	const sourceFingerprints: Record<string, SourceFingerprint> = {};
	for (const { path, content } of sources) {
		const fp = fingerprintSource(path, content);
		if (fp !== null) sourceFingerprints[path] = fp;
	}
	const discovered = discoverSuiteTests(
		repoRoot,
		rules.tests.root,
		rules.tests.glob,
		rules.tests.category ?? "",
	);
	const fileByTest = new Map(discovered.map((test) => [test.id, test.file]));

	const matchId = (id: string) =>
		idIndex.filter((entry) => entry.matches(id)).map((entry) => entry.file);

	const tests: CoverageTree["tests"] = {};
	const unmatchedEvidence: string[] = [];
	const records = loadEvidence(join(options.artifactsDir, "coverage-evidence"));
	// Per-case durations for this run (#2263): the merger's sidecar on
	// multi-shard runs, else the JUnit report, else evidence spans. A corrupt
	// report degrades to evidence spans — timing is advisory, never fatal.
	let durations: Map<string, number>;
	try {
		durations = caseDurations(options.artifactsDir, records);
	} catch (error) {
		console.warn(`[e2e-impact] case timings degraded to evidence spans: ${String(error)}`);
		durations = evidenceDurations(records);
	}
	for (const record of records) {
		const ids = [...new Set(record.automationIds ?? [])].sort();
		const files = new Set<string>();
		const unmapped: string[] = [];
		for (const id of ids) {
			const mapped = matchId(id);
			if (mapped.length === 0) unmapped.push(id);
			for (const file of mapped) files.add(file);
		}
		if (fileByTest.get(record.test) === undefined) unmatchedEvidence.push(record.test);
		tests[record.test] = {
			...(fileByTest.has(record.test) ? { file: fileByTest.get(record.test) } : {}),
			files: [...files].sort(),
			automationIds: ids,
			unmappedIds: unmapped.sort(),
			sessions: [...new Set(record.sessions ?? [])].sort(),
			outcome: record.outcome ?? "unknown",
		};
	}

	// Executable coverage unions in when a compatible exec tree is supplied:
	// per-test evidence widens the same test's file set (never shrinks the
	// automation-id channel), the shared bucket surfaces as `sharedFiles`
	// for select-time widening, and an incomplete exec tree keeps the merged
	// tree incomplete. Incompatible input is ignored — the CLI diagnoses
	// the reason before ever passing it here.
	let sharedFiles: string[] | undefined;
	let memberGaps: Record<string, string[]> | undefined;
	let complete = options.complete;
	if (
		options.execTree !== undefined &&
		execTreeCompatible(options.execTree, {
			suite: rules.suite,
			platform,
			snapshotSha: options.snapshotSha,
		}) === null
	) {
		const view = execSelectorView(options.execTree);
		for (const [id, execTest] of Object.entries(view.tests)) {
			const existing = tests[id];
			if (existing === undefined) {
				if (fileByTest.get(id) === undefined && !unmatchedEvidence.includes(id)) {
					unmatchedEvidence.push(id);
				}
				tests[id] = {
					...execTest,
					...(fileByTest.has(id) ? { file: fileByTest.get(id) } : {}),
				};
			} else {
				existing.files = unionSorted(existing.files, execTest.files);
				existing.sessions = unionSorted(existing.sessions, execTest.sessions);
				existing.outcome = mergeOutcome(existing.outcome, execTest.outcome);
				// Member evidence unions per file (#2085 member granularity);
				// a file absent from exec evidence keeps the test unqualified
				// for member narrowing there — never silently narrowed away.
				if (execTest.members !== undefined) {
					const members: Record<string, string[]> = { ...(existing.members ?? {}) };
					for (const [file, keys] of Object.entries(execTest.members)) {
						members[file] = unionSorted(members[file] ?? [], keys);
					}
					existing.members = members;
				}
			}
		}
		for (const name of view.unmatchedEvidence) {
			if (!unmatchedEvidence.includes(name)) unmatchedEvidence.push(name);
		}
		if (view.sharedFiles.length > 0) sharedFiles = view.sharedFiles;
		if (Object.keys(view.memberGaps).length > 0) memberGaps = view.memberGaps;
		complete = complete && options.execTree.complete;
	}

	// Runtime history (#2263): each executed case rolls its measured duration
	// into the baseline's per-case mean; a case with no observation keeps its
	// prior entry rather than degrading to unmeasured. Timing lives on the
	// tree, so it rides the same trusted publish path as impact evidence —
	// and an incomplete tree never reaches that path.
	const now = new Date();
	const history = options.history;
	for (const [id, entry] of Object.entries(tests)) {
		const timing = mergeTiming(history?.tests[id]?.timing, durations.get(id), now);
		if (timing !== undefined) entry.timing = timing;
	}
	const overhead = mergeOverhead(
		history?.overhead,
		options.overheadMs ?? observedOverheadMs(options.artifactsDir, durations) ?? undefined,
	);

	return {
		schemaVersion: SCHEMA_VERSION,
		suite: rules.suite,
		platform,
		snapshotSha: options.snapshotSha,
		collectorVersion: rules.collectorVersion,
		collectedAtUtc: now.toISOString(),
		complete,
		sourceUnits,
		sourceFiles,
		sourceFingerprints,
		...(sharedFiles !== undefined ? { sharedFiles } : {}),
		...(memberGaps !== undefined ? { memberGaps } : {}),
		tests: Object.fromEntries(
			Object.entries(tests).sort(([a], [b]) => a.localeCompare(b)),
		),
		...(overhead !== undefined ? { overhead } : {}),
		...(unmatchedEvidence.length > 0
			? { unmatchedEvidence: unmatchedEvidence.sort() }
			: {}),
	};
}

export function writeTree(tree: CoverageTree, outPath: string): void {
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(tree, null, 2)}\n`);
}
