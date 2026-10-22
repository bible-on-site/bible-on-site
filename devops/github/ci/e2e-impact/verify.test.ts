import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { SCHEMA_VERSION, type CoverageTree, type CoverageTreeTest } from "./model.ts";
import type { SelectionManifest } from "./select.ts";
import { verifySelection, type VerifyReport } from "./verify.ts";

// ── Fixtures ────────────────────────────────────────────────────────────

const SNAP = "1111111111111111111111111111111111111111";
const TESTED = "2222222222222222222222222222222222222222";

function makeManifest(overrides: Partial<SelectionManifest> = {}): SelectionManifest {
	return {
		schemaVersion: SCHEMA_VERSION,
		suite: "suite-e2e",
		platform: "web",
		mode: "subset",
		selectAll: false,
		snapshotSha: SNAP,
		testedSha: TESTED,
		fingerprint: "f".repeat(64),
		forced: false,
		fallbacks: [],
		changedFiles: [],
		selected: [
			{ id: "T.Selected.Passed", reasons: ["covered-file:src/x.ts"] },
			{ id: "T.Selected.Failed", reasons: ["always-run"] },
		],
		unselected: [
			{ id: "T.Unselected.Passed", reasons: [] },
			{ id: "T.Unselected.Failed", reasons: [] },
			{ id: "T.Unselected.Flaky", reasons: [] },
			{ id: "T.Unselected.Skipped", reasons: [] },
			{ id: "T.Unselected.Absent", reasons: [] },
		],
		newTests: [],
		staleTreeTests: [],
		unchangedStructural: [],
		nonApplicableTestChanges: [],
		dynamicTestFiles: [],
		filter: { vstest: null, playwright: null },
		...overrides,
	};
}

function makeTree(
	outcomes: Record<string, string>,
	overrides: Partial<CoverageTree> = {},
): CoverageTree {
	const tests: Record<string, CoverageTreeTest> = {};
	for (const [id, outcome] of Object.entries(outcomes)) {
		tests[id] = {
			files: [],
			automationIds: [],
			unmappedIds: [],
			sessions: [],
			outcome,
		};
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		suite: "suite-e2e",
		platform: "web",
		// The tree is collected from the tested revision, never the baseline.
		snapshotSha: TESTED,
		collectorVersion: "1.0.0",
		collectedAtUtc: "2026-01-01T00:00:00Z",
		complete: true,
		sourceUnits: {},
		sourceFiles: [],
		tests,
		...overrides,
	};
}

const FULL_OUTCOMES = {
	"T.Selected.Passed": "passed",
	"T.Selected.Failed": "failed",
	"T.Unselected.Passed": "passed",
	"T.Unselected.Failed": "failed",
	"T.Unselected.Flaky": "flaky",
	"T.Unselected.Skipped": "skipped",
	// T.Unselected.Absent records no outcome at all.
};

// ── verification ────────────────────────────────────────────────────────

describe("verifySelection", () => {
	test("flags unselected tests that failed as missed", () => {
		const report = verifySelection(makeManifest(), makeTree(FULL_OUTCOMES));
		assert.equal(report.problem, null);
		assert.equal(report.kind, "e2e-impact-verify");
		assert.equal(report.mode, "subset");
		assert.deepEqual(report.missed, ["T.Unselected.Failed"]);
		assert.deepEqual(report.caught, ["T.Selected.Failed"]);
		assert.equal(report.counts.missed, 1);
		assert.equal(report.counts.caught, 1);
		assert.equal(report.counts.selected, 2);
		assert.equal(report.counts.unselected, 5);
	});

	test("a clean shadow run reports no misses", () => {
		const report = verifySelection(
			makeManifest(),
			makeTree({
				"T.Selected.Passed": "passed",
				"T.Selected.Failed": "failed",
				"T.Unselected.Passed": "passed",
				"T.Unselected.Failed": "passed",
				"T.Unselected.Flaky": "passed",
				"T.Unselected.Skipped": "passed",
				"T.Unselected.Absent": "passed",
			}),
		);
		assert.equal(report.problem, null);
		assert.deepEqual(report.missed, []);
		assert.equal(report.counts.passedUnselected, 5);
		assert.equal(report.counts.unobserved, 0);
	});

	test("flaky and skipped outcomes are not failures but are reported", () => {
		const report = verifySelection(makeManifest(), makeTree(FULL_OUTCOMES));
		assert.deepEqual(report.flakyMissed, ["T.Unselected.Flaky"]);
		assert.deepEqual(report.missed, ["T.Unselected.Failed"]);
		assert.deepEqual(
			report.unobserved,
			["T.Unselected.Absent", "T.Unselected.Skipped"].sort(),
		);
	});

	test("any non-pass evidence outcome counts as a missed failure", () => {
		const report = verifySelection(
			makeManifest(),
			makeTree({
				...FULL_OUTCOMES,
				"T.Unselected.Failed": "timedOut",
			}),
		);
		assert.deepEqual(report.missed, ["T.Unselected.Failed"]);
	});

	test("a selected test the run never observed is reported", () => {
		const report = verifySelection(
			makeManifest(),
			makeTree({
				...FULL_OUTCOMES,
				"T.Selected.Failed": "unknown",
				"T.Unselected.Failed": "passed",
			}),
		);
		assert.deepEqual(report.selectedUnobserved, ["T.Selected.Failed"]);
	});

	test("a full-suite manifest verifies trivially — nothing was narrowed", () => {
		const report = verifySelection(
			makeManifest({
				mode: "full",
				selectAll: true,
				selected: [
					{ id: "T.Selected.Passed", reasons: ["fallback:x"] },
					{ id: "T.Selected.Failed", reasons: ["fallback:x"] },
				],
				unselected: [],
			}),
			makeTree(FULL_OUTCOMES),
		);
		assert.equal(report.problem, null);
		assert.equal(report.mode, "full");
		assert.equal(report.counts.unselected, 0);
		assert.deepEqual(report.missed, []);
	});

	test("suite mismatch reports a problem without evaluating", () => {
		const report = verifySelection(
			makeManifest(),
			makeTree(FULL_OUTCOMES, { suite: "other-e2e" }),
		);
		assert.ok(report.problem?.includes("suite-mismatch"));
		assert.equal(report.counts.missed, 0);
		assert.deepEqual(report.missed, []);
	});

	test("platform mismatch reports a problem without evaluating", () => {
		const report = verifySelection(
			makeManifest(),
			makeTree(FULL_OUTCOMES, { platform: "android" }),
		);
		assert.ok(report.problem?.includes("platform-mismatch"));
		assert.deepEqual(report.missed, []);
	});

	test("a tree from another revision reports a problem", () => {
		const report = verifySelection(
			makeManifest(),
			makeTree(FULL_OUTCOMES, { snapshotSha: SNAP }),
		);
		assert.ok(report.problem?.includes("snapshot-mismatch"));
		assert.deepEqual(report.missed, []);
	});

	test("identical inputs produce identical reports", () => {
		const manifest = makeManifest();
		const tree = makeTree(FULL_OUTCOMES);
		const first = verifySelection(manifest, tree);
		const second = verifySelection(manifest, tree);
		assert.equal(JSON.stringify(first), JSON.stringify(second));
	});
});

// ── CLI ─────────────────────────────────────────────────────────────────

describe("verify CLI", () => {
	const IMPACT = fileURLToPath(new URL("./e2e-impact.ts", import.meta.url));

	const runVerify = (args: string[]) =>
		spawnSync(process.execPath, [IMPACT, "verify", ...args], { encoding: "utf8" });

	test("missing inputs still emit a problem report — diagnostics never gate", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-impact-verify-"));
		try {
			const out = join(dir, "verify.json");
			const result = runVerify([
				"--manifest", join(dir, "no-manifest.json"),
				"--tree", join(dir, "no-tree.json"),
				"--out", out,
			]);
			assert.equal(result.status, 0, result.stderr);
			const report = JSON.parse(readFileSync(out, "utf8")) as VerifyReport;
			assert.equal(report.kind, "e2e-impact-verify");
			assert.ok(report.problem !== null);
			assert.deepEqual(report.missed, []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a manifest and tree from the same run produce a parity report", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-impact-verify-"));
		try {
			const manifestPath = join(dir, "selection-manifest.json");
			const treePath = join(dir, "coverage-tree.json");
			const out = join(dir, "verify.json");
			writeFileSync(manifestPath, JSON.stringify(makeManifest()));
			writeFileSync(treePath, JSON.stringify(makeTree(FULL_OUTCOMES)));
			const result = runVerify([
				"--manifest", manifestPath,
				"--tree", treePath,
				"--out", out,
			]);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /1 missed/);
			const report = JSON.parse(readFileSync(out, "utf8")) as VerifyReport;
			assert.equal(report.problem, null);
			assert.deepEqual(report.missed, ["T.Unselected.Failed"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
