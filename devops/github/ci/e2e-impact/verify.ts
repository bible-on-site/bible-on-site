/**
 * Shadow-mode parity verification (#2085).
 *
 * The rollout gate for deterministic selection is evidence: while suites run
 * in shadow mode every test executes, so the selection manifest can be scored
 * against the outcomes the run actually observed. `verifySelection` answers
 * one question — would the computed subset have missed a real failure?
 *
 * The join is deliberately narrow: the manifest's `selected`/`unselected`
 * lists against `CoverageTreeTest.outcome` from the same run. An unselected
 * test that failed is a `missed` parity break — the evidence under-selected.
 * Unselected tests without an outcome (skipped, unknown, absent from the
 * tree) are `unobserved`: nothing proven either way. Flaky outcomes are
 * reported separately — a flake the subset would have hidden is a signal,
 * not a proven failure. Inputs that cannot be joined (suite, platform or
 * revision mismatch) report a `problem` instead of a verdict; diagnostics
 * must never fabricate a clean comparison.
 *
 * The report is deterministic: sorted lists, no clocks, no environment.
 */
import { existsSync, readFileSync } from "node:fs";
import { SCHEMA_VERSION, type CoverageTree } from "./model.ts";
import type { SelectionManifest } from "./select.ts";

export const VERIFY_KIND = "e2e-impact-verify";

export interface VerifyCounts {
	/** Manifest membership. */
	selected: number;
	unselected: number;
	/** Selected tests whose run outcome was a failure. */
	caught: number;
	/** Unselected tests whose run outcome was a failure — the parity break. */
	missed: number;
	/** Selected/unselected tests that flaked (failed then passed on retry). */
	flakyCaught: number;
	flakyMissed: number;
	/** Selected tests the run never observed — runner-fidelity anomaly. */
	selectedUnobserved: number;
	/** Unselected tests with no usable outcome (skipped/unknown/absent). */
	unobserved: number;
	/** Pass counts — the correctly-skipped win metric. */
	passedSelected: number;
	passedUnselected: number;
}

export interface VerifyReport {
	kind: typeof VERIFY_KIND;
	schemaVersion: number;
	suite: string;
	platform: string;
	/** Manifest fields — the selection being scored. */
	testedSha: string | null;
	snapshotSha: string | null;
	/** Coverage tree's snapshot — the run that produced the outcomes. */
	treeSha: string | null;
	mode: "full" | "subset" | null;
	/**
	 * Non-null when the inputs could not be joined — no evaluation ran and
	 * every list/count stays empty. Diagnostics report problems, never throw.
	 */
	problem: string | null;
	counts: VerifyCounts;
	caught: string[];
	missed: string[];
	flakyCaught: string[];
	flakyMissed: string[];
	selectedUnobserved: string[];
	unobserved: string[];
}

/**
 * Outcomes that carry no pass/fail evidence for parity: the test did not
 * produce a verdict this run (skipped outright, recorded mid-run, reporter
 * saw no result). Anything else non-pass — `failed`, `timedOut`,
 * `unexpected` — is failure evidence; an unknown future failure string must
 * never silently read as "not a failure".
 */
const UNOBSERVED_OUTCOMES = new Set(["skipped", "unknown", "running"]);

type Observed = "passed" | "flaky" | "failed" | "unobserved";

function classify(outcome: string | undefined): Observed {
	if (outcome === undefined) return "unobserved";
	if (outcome === "passed") return "passed";
	if (outcome === "flaky") return "flaky";
	if (UNOBSERVED_OUTCOMES.has(outcome)) return "unobserved";
	return "failed";
}

const EMPTY_COUNTS: VerifyCounts = {
	selected: 0,
	unselected: 0,
	caught: 0,
	missed: 0,
	flakyCaught: 0,
	flakyMissed: 0,
	selectedUnobserved: 0,
	unobserved: 0,
	passedSelected: 0,
	passedUnselected: 0,
};

function report(
	header: Pick<
		VerifyReport,
		"suite" | "platform" | "testedSha" | "snapshotSha" | "treeSha" | "mode"
	>,
	problem: string | null,
	body: Partial<Pick<VerifyReport, "counts">> &
		Partial<
			Pick<
				VerifyReport,
				| "caught"
				| "missed"
				| "flakyCaught"
				| "flakyMissed"
				| "selectedUnobserved"
				| "unobserved"
			>
		> = {},
): VerifyReport {
	return {
		kind: VERIFY_KIND,
		schemaVersion: SCHEMA_VERSION,
		problem,
		counts: body.counts ?? { ...EMPTY_COUNTS },
		caught: body.caught ?? [],
		missed: body.missed ?? [],
		flakyCaught: body.flakyCaught ?? [],
		flakyMissed: body.flakyMissed ?? [],
		selectedUnobserved: body.selectedUnobserved ?? [],
		unobserved: body.unobserved ?? [],
		...header,
	};
}

function headerOf(
	manifest: SelectionManifest | null,
	tree: CoverageTree | null,
): Pick<
	VerifyReport,
	"suite" | "platform" | "testedSha" | "snapshotSha" | "treeSha" | "mode"
> {
	return {
		suite: manifest?.suite ?? tree?.suite ?? "unknown",
		platform: manifest?.platform ?? tree?.platform ?? "unknown",
		testedSha: manifest?.testedSha ?? null,
		snapshotSha: manifest?.snapshotSha ?? null,
		treeSha: tree?.snapshotSha ?? null,
		mode: manifest?.mode ?? null,
	};
}

/** Problem report for inputs that could not even be loaded. */
export function verifyProblem(
	problem: string,
	manifest: SelectionManifest | null,
	tree: CoverageTree | null,
): VerifyReport {
	return report(headerOf(manifest, tree), problem);
}

/**
 * Joins a selection manifest against the outcomes the same run observed.
 * Both inputs must describe the same suite, platform and tested revision —
 * a tree collected from another commit cannot score this manifest.
 */
export function verifySelection(
	manifest: SelectionManifest,
	tree: CoverageTree,
): VerifyReport {
	const header = headerOf(manifest, tree);
	if (manifest.suite !== tree.suite) {
		return report(
			header,
			`suite-mismatch: manifest ${manifest.suite} vs tree ${tree.suite}`,
		);
	}
	if (manifest.platform !== tree.platform) {
		return report(
			header,
			`platform-mismatch: manifest ${manifest.platform} vs tree ${tree.platform}`,
		);
	}
	if (manifest.testedSha !== tree.snapshotSha) {
		return report(
			header,
			`snapshot-mismatch: tree evidence ${tree.snapshotSha} vs tested ${manifest.testedSha}`,
		);
	}

	const caught: string[] = [];
	const missed: string[] = [];
	const flakyCaught: string[] = [];
	const flakyMissed: string[] = [];
	const selectedUnobserved: string[] = [];
	const unobserved: string[] = [];
	let passedSelected = 0;
	let passedUnselected = 0;

	for (const entry of manifest.selected) {
		switch (classify(tree.tests[entry.id]?.outcome)) {
			case "failed":
				caught.push(entry.id);
				break;
			case "flaky":
				flakyCaught.push(entry.id);
				break;
			case "passed":
				passedSelected += 1;
				break;
			case "unobserved":
				selectedUnobserved.push(entry.id);
				break;
		}
	}
	for (const entry of manifest.unselected) {
		switch (classify(tree.tests[entry.id]?.outcome)) {
			case "failed":
				missed.push(entry.id);
				break;
			case "flaky":
				flakyMissed.push(entry.id);
				break;
			case "passed":
				passedUnselected += 1;
				break;
			case "unobserved":
				unobserved.push(entry.id);
				break;
		}
	}
	for (const list of [caught, missed, flakyCaught, flakyMissed, selectedUnobserved, unobserved]) {
		list.sort();
	}
	const counts: VerifyCounts = {
		selected: manifest.selected.length,
		unselected: manifest.unselected.length,
		caught: caught.length,
		missed: missed.length,
		flakyCaught: flakyCaught.length,
		flakyMissed: flakyMissed.length,
		selectedUnobserved: selectedUnobserved.length,
		unobserved: unobserved.length,
		passedSelected,
		passedUnselected,
	};
	return report(header, null, {
		counts,
		caught,
		missed,
		flakyCaught,
		flakyMissed,
		selectedUnobserved,
		unobserved,
	});
}

/**
 * Loads a JSON input for verification; absent or corrupt files are reported,
 * never thrown — a diagnostics step must not turn evidence gaps into a red
 * job (same contract as `loadBaselineTree`).
 */
export function loadVerifyJson(
	path: string,
): { kind: "ok"; value: unknown } | { kind: "missing" | "corrupt"; reason: string } {
	if (!existsSync(path)) {
		return { kind: "missing", reason: `${path} does not exist` };
	}
	try {
		return { kind: "ok", value: JSON.parse(readFileSync(path, "utf8")) };
	} catch (error) {
		return { kind: "corrupt", reason: `${path}: ${String(error)}` };
	}
}
