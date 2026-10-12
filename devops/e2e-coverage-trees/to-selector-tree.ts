/**
 * Bridge from the executable coverage tree to the selector's
 * `coverage-tree.json` (#2085): maps `exec-coverage-tree` evidence onto the
 * `CoverageTree` shape `e2e-impact select` consumes, so the deterministic
 * selector consults real executed-code coverage alongside the
 * automation-id channel.
 *
 * Channel semantics (docs/devops/e2e-test-selection.md):
 *   - `per-test` entries map onto `CoverageTreeTest` — the executed file
 *     set unions with the automation-id channel's view-reachability files
 *     in the collector, so a file covered by either channel selects the
 *     test. `measured: false` per-test entries (baseline-carried evidence)
 *     still record real execution and map the same way — except `stale`
 *     ones: a baseline-carried test id no longer discovered cannot run,
 *     so its files must not narrow to a ghost selection.
 *   - `shared`, `unmeasured` and `error` entries never map onto a test —
 *     they carry no single test's claim. The `shared` bucket's files
 *     surface as `sharedFiles`, which selection widens to every applicable
 *     test instead of trusting a per-test claim.
 *   - `loadExecTree` + `execTreeCompatible` are the consumer's guard: a
 *     missing, corrupt or mismatched (kind/schema/suite/platform/snapshot)
 *     exec tree is diagnosed and skipped — exec evidence may widen but
 *     never replaces or shrinks the automation-id channel.
 *
 * Decl-level detail the selector schema cannot express (node ids,
 * `parents` containment edges, visit counts, per-entry `evidenceSha`) is
 * intentionally dropped here — the exec tree stays the rich artifact and
 * the AST-comparison slice consumes it directly.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CoverageTreeTest } from "../github/ci/e2e-impact/model.ts";
import { type ExecCoverageTree, validateExecTree } from "./model.ts";

/** Exec evidence expressed in selector-tree shape. */
export interface ExecSelectorView {
	/**
	 * `per-test` entries keyed by xUnit FQN. `automationIds`/`unmappedIds`
	 * stay empty — the exec channel records executed files, not queried
	 * ids; `file` is left for the collector's discovery lookup.
	 */
	tests: Record<string, CoverageTreeTest>;
	/**
	 * Files no single test could claim (the `shared` bucket): startup
	 * coverage, unmatched/untimed dumps and whole-report shared mode.
	 * Selection widens a change touching them to every applicable test.
	 */
	sharedFiles: string[];
	/** Evidence names the exec extraction resolved to no known test. */
	unmatchedEvidence: string[];
}

/** Maps an exec tree onto selector-tree evidence — pure, no I/O. */
export function execSelectorView(exec: ExecCoverageTree): ExecSelectorView {
	const tests: Record<string, CoverageTreeTest> = {};
	for (const [id, entry] of Object.entries(exec.tests)) {
		// Only per-test evidence can be claimed by one test. `shared`
		// entries stay in the shared bucket below; `unmeasured`/`error`
		// carry no coverage by construction. `stale` baseline entries name
		// a test the current revision no longer runs — a file covered only
		// by one would select nothing real, so they map nowhere either.
		if (entry.attribution !== "per-test" || entry.stale === true) continue;
		tests[id] = {
			files: [...new Set(entry.files)].sort(),
			automationIds: [],
			unmappedIds: [],
			sessions: [...new Set(entry.sessions)].sort(),
			outcome: entry.outcome,
		};
	}
	return {
		tests: Object.fromEntries(
			Object.entries(tests).sort(([a], [b]) => a.localeCompare(b)),
		),
		sharedFiles: [...new Set(exec.shared.files)].sort(),
		unmatchedEvidence: [...new Set(exec.unmatchedEvidence)].sort(),
	};
}

/**
 * The gate before exec evidence may join a selector tree: the exec
 * schema/suite/platform rules (`validateExecTree`) plus the snapshot —
 * coverage measured on another commit would attach wrong-revision files
 * to tests. Returns the incompatibility reason, `null` when compatible.
 */
export function execTreeCompatible(
	exec: ExecCoverageTree,
	expect: { suite: string; platform: string; snapshotSha: string },
): string | null {
	const problem = validateExecTree(exec, expect);
	if (problem !== null) return problem;
	if (exec.snapshotSha !== expect.snapshotSha) {
		return `snapshotSha ${exec.snapshotSha}`;
	}
	return null;
}

/** Loads an exec tree; missing or corrupt files are reported, never thrown. */
export function loadExecTree(
	path: string,
):
	| { kind: "ok"; tree: ExecCoverageTree }
	| { kind: "missing" | "corrupt"; reason: string } {
	if (!existsSync(path)) {
		return { kind: "missing", reason: `${path} does not exist` };
	}
	try {
		return {
			kind: "ok",
			tree: JSON.parse(readFileSync(path, "utf8")) as ExecCoverageTree,
		};
	} catch (error) {
		return { kind: "corrupt", reason: `${path}: ${String(error)}` };
	}
}
