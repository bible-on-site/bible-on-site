/**
 * Shared model for deterministic E2E impact selection (#2085).
 *
 * The contract is suite-agnostic: a suite ships a `e2e-impact.json` config, a
 * collector writes a per-platform coverage tree, and the selector maps an
 * accumulated diff onto the tests that could observe the change.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SourceFingerprint } from "./fingerprint.ts";

export const SCHEMA_VERSION = 1;

/** A test discovered from the tested revision's sources. */
export interface DiscoveredTest {
	/**
	 * Stable identity: `Namespace.Class.Method` (xUnit FQN) or
	 * `<testDir-relative file> :: <describe/test titles>` (Playwright).
	 */
	id: string;
	/** Repo-relative file declaring the test. */
	file: string;
	/** `Shared`, `Android` or `iOS` — which platform jobs may run it. */
	platform: string;
	/** Suite category trait, e.g. `MobileE2E` (xUnit only). */
	category?: string;
}

/**
 * Rolling runtime statistics for one test case (#2263). `meanMs` is an
 * exponentially-anchored rolling mean capped at TIMING_SAMPLE_CAP samples'
 * weight so a permanently slower test overtakes old history instead of
 * averaging with it forever. `samples` saturates at the cap — it reports
 * observations seen, not the weight currently applied.
 */
export interface CaseTiming {
	samples: number;
	meanMs: number;
	/** Duration of the most recent observation (diagnostics). */
	lastMs: number;
	updatedAtUtc: string;
}

/**
 * Rolling mean of a run's non-case time: pilot supervision minus the summed
 * measured case durations (Appium/WDA/harness bring-up and teardown inside
 * the supervised pilot). Kept separate from case timings so setup is never
 * charged to an arbitrary test (#2263).
 */
export interface OverheadTiming {
	samples: number;
	meanMs: number;
}

/** Per-test evidence recorded for one suite on one platform. */
export interface CoverageTreeTest {
	/** Repo-relative test source file, when resolvable. */
	file?: string;
	/** Sorted repo-relative app files the test provably reached. */
	files: string[];
	/**
	 * The run produced no attributable evidence for this test (no page
	 * opened, a non-fixture transport, an unresolvable request log). Its
	 * `files` set is the union of every attributed file plus shared
	 * coverage, so any covered change runs it — never narrowed (#2085).
	 */
	unattributed?: boolean;
	/** Sorted automation ids the test queried through the driver. */
	automationIds: string[];
	/** Automation ids that no source file could claim (evidence gaps). */
	unmappedIds: string[];
	/** Driver session ids attributed to the test. */
	sessions: string[];
	/** last recorded outcome: passed | failed | running */
	outcome: string;
	/**
	 * Observed wall-clock runtime for this case on this platform (#2263).
	 * Scheduling data only — its absence means "unmeasured", never "free".
	 */
	timing?: CaseTiming;
	/**
	 * Executable evidence at member granularity: covered file → source-member
	 * keys (`Ns.Type.Member#<sig>` — the `SourceFingerprint.members` key
	 * space) the test's executed nodes mapped into. A file key is present —
	 * possibly with an empty list — only when the test's executable coverage
	 * for that file is member-qualified; files covered only by the
	 * automation-id channel (or older baselines) are absent, and any change
	 * there still selects the test at file granularity (#2085).
	 */
	members?: Record<string, string[]>;
}

export interface CoverageTree {
	schemaVersion: number;
	suite: string;
	platform: string;
	/** Commit SHA whose code produced this evidence. */
	snapshotSha: string;
	collectorVersion: string;
	collectedAtUtc: string;
	/** false when the run did not complete — tree is partial evidence. */
	complete: boolean;
	/**
	 * Logical units of app source: `dir/Stem` groups `Stem.xaml`,
	 * `Stem.xaml.cs` and verified `Stem.*.cs` partials of the same class.
	 */
	sourceUnits: Record<string, string[]>;
	/** Every app source file scanned at the snapshot. */
	sourceFiles: string[];
	/**
	 * Trivia-insensitive structural fingerprints of `sourceFiles` at the
	 * snapshot (see `fingerprint.ts`). Files that could not be fingerprinted
	 * are absent and therefore always read as changed — never the reverse.
	 * Optional so older baselines stay compatible.
	 */
	sourceFingerprints?: Record<string, SourceFingerprint>;
	/**
	 * App files the executable-coverage channel could not attribute to a
	 * single test — the exec tree's `shared` bucket (startup code,
	 * unmatched/untimed dumps, whole-report shared mode). A change touching
	 * one widens to every applicable test rather than trusting a per-test
	 * covering claim. Optional: automation-id-only trees predate the merge.
	 */
	sharedFiles?: string[];
	/**
	 * Exec evidence that could not be mapped to a single source member:
	 * `file → source-level type names` containing unmapped covered nodes.
	 * A changed member inside a gapped type widens to the file's tests —
	 * partial member evidence never narrows a type the extractor admitted
	 * it could not fully map (#2085).
	 */
	memberGaps?: Record<string, string[]>;
	tests: Record<string, CoverageTreeTest>;
	/** Evidence records that no discovered test claimed (diagnostics). */
	unmatchedEvidence?: string[];
	/**
	 * Rolling mean of the run's non-case pilot time (#2263). The shard
	 * planner prices a new shard as job setup plus this value.
	 */
	overhead?: OverheadTiming;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
	path: string;
	status: FileStatus;
	/** For renamed entries — the path at the snapshot revision. */
	previousPath?: string;
}

export interface SuiteRules {
	schemaVersion: number;
	/** Stable suite name, e.g. `app-mobile-e2e`. */
	suite: string;
	/** Collector identifier, e.g. `appium-automation-id`. */
	collector: string;
	collectorVersion: string;
	/** Maps CI artifact keys (`android`) onto test platform traits (`Android`). */
	platforms: Record<string, string>;
	tests: {
		/**
		 * Repo-relative root holding the suite's runnable test files.
		 * Other files under it (helpers, fixtures) are shared harness —
		 * a change selects every applicable test.
		 */
		root: string;
		/**
		 * Repo-relative Playwright `testDir`: the file part of a test id is
		 * relative to it (`tests/e2e/x.test.ts` → `e2e/x.test.ts` when the
		 * root is `tests/`). Defaults to `root` (suites whose testDir is
		 * the root itself, e.g. `tests/e2e`).
		 */
		testDir?: string;
		/** Glob (relative to root) matching files that declare runnable tests. */
		glob: string;
		framework: "csharp-xunit" | "playwright";
		/** xUnit only: tests must carry this `Category` trait to be in the suite. */
		category?: string;
	};
	sources: {
		/** App source root scanned for automation ids. */
		root: string;
		globs: string[];
	};
	/** Always selected on every applicable platform (documented smoke set). */
	alwaysRun: string[];
	/**
	 * Globs whose change cannot be narrowed to evidence and must run every
	 * applicable test — bootstrap, navigation shell, styles, resources, native
	 * code, build tooling, CI definitions, packaged data and harness internals.
	 */
	runAllOnChange: string[];
	/** Globs that provably cannot affect the suite (docs, other test projects). */
	noImpact: string[];
	/**
	 * Repo scope whose unmapped changes conservatively select every test.
	 * Files outside it and outside `runAllOnChange`/`noImpact` select nothing.
	 */
	scope: string[];
}

export function loadRules(path: string): SuiteRules {
	const raw = JSON.parse(readFileSync(path, "utf8")) as SuiteRules;
	const missing: string[] = [];
	if (raw.schemaVersion !== SCHEMA_VERSION)
		throw new Error(`${path}: unsupported schemaVersion ${raw.schemaVersion}`);
	for (const field of [
		"suite",
		"collector",
		"collectorVersion",
		"platforms",
		"tests",
		"sources",
		"alwaysRun",
		"runAllOnChange",
		"noImpact",
		"scope",
	] as const) {
		if (raw[field] === undefined || raw[field] === null) missing.push(field);
	}
	if (missing.length > 0)
		throw new Error(`${path}: missing fields: ${missing.join(", ")}`);
	if (!raw.tests.root || !raw.tests.glob)
		throw new Error(`${path}: tests.root and tests.glob are required`);
	if (raw.tests.framework === "csharp-xunit" && !raw.tests.category)
		throw new Error(`${path}: tests.category is required for csharp-xunit`);
	return raw;
}

/** `^[0-9a-f]{40}$` without the regex engine — snapshot ids are plain data. */
function isHexSha(value: string): boolean {
	if (value.length !== 40) return false;
	for (const char of value) {
		const hex =
			(char >= "0" && char <= "9") ||
			(char >= "a" && char <= "f") ||
			(char >= "A" && char <= "F");
		if (!hex) return false;
	}
	return true;
}

export function validateTree(
	tree: CoverageTree,
	rules: SuiteRules,
	platform: string,
): string | null {
	if (tree.schemaVersion !== SCHEMA_VERSION) return `schemaVersion ${tree.schemaVersion}`;
	if (tree.suite !== rules.suite) return `suite ${tree.suite}`;
	if (tree.platform !== platform) return `platform ${tree.platform}`;
	if (!isHexSha(tree.snapshotSha)) return `snapshotSha ${tree.snapshotSha}`;
	if (typeof tree.tests !== "object" || tree.tests === null) return "missing tests";
	// A partial-evidence tree can never back a narrowing selection — the
	// publish step gates on `complete` too, so reaching this means an older
	// or hand-built artifact; treat it as an untrusted baseline.
	if (tree.complete !== true) return "incomplete tree";
	return null;
}

/** Loads a baseline tree; corrupt or absent files are reported, never thrown. */
export function loadBaselineTree(path: string):
	| { kind: "ok"; tree: CoverageTree }
	| { kind: "missing" | "corrupt"; reason: string } {
	if (!existsSync(path)) {
		return { kind: "missing", reason: `${path} does not exist` };
	}
	try {
		return { kind: "ok", tree: JSON.parse(readFileSync(path, "utf8")) };
	} catch (error) {
		return { kind: "corrupt", reason: `${path}: ${String(error)}` };
	}
}

/** Canonical serialization: sorted keys, sorted arrays — stable fingerprints. */
export function canonicalize(value: unknown): string {
	return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortRecursively);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, sortRecursively(entry)]),
		);
	}
	return value;
}

export function fingerprint(parts: unknown[]): string {
	return createHash("sha256")
		.update(parts.map((part) => canonicalize(part)).join("\n"))
		.digest("hex");
}
