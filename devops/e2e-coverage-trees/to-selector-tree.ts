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
	/**
	 * Member-granularity uncertainty: `file → source-level type names` whose
	 * covered nodes could not be mapped to one member (no span, unparsable
	 * file, `#if`-twin spans, file-scope code). A changed member inside a
	 * gapped type widens to the file's tests rather than trusting partial
	 * member evidence.
	 */
	memberGaps: Record<string, string[]>;
}

/**
 * Reduces a node's `type:` parent to the source-level type name: `+`/`/`
 * become `.`, compiler-generated `<>…` segments drop out, and generic
 * arity suffixes (`Foo\`1`) strip to the source name — the key must match
 * the `typeKey` member fingerprints emit for the same type.
 */
const gapTypeOf = (node: { parents?: string[] }): string | null => {
	const typeParent = node.parents?.find((parent) => parent.startsWith("type:"));
	if (typeParent === undefined) return null;
	const normalized = typeParent.slice("type:".length).replace(/[+/]/g, ".");
	const kept = normalized
		.split(".")
		.filter((segment) => !segment.includes("<"))
		.map((segment) => segment.replace(/`\d+$/, ""));
	return kept.join(".");
};

/** Maps an exec tree onto selector-tree evidence — pure, no I/O. */
export function execSelectorView(exec: ExecCoverageTree): ExecSelectorView {
	const tests: Record<string, CoverageTreeTest> = {};
	const gapSets = new Map<string, Set<string>>();
	const recordGaps = (nodeIds: string[]) => {
		for (const nodeId of nodeIds) {
			const node = exec.nodes[nodeId];
			// Only repo-file method nodes could ever carry a member; a node
			// whose points leave its file (multi-file span, external path)
			// is exactly the evidence that could not map — record the gap.
			if (
				node === undefined ||
				node.kind !== "method" ||
				node.member !== undefined ||
				node.file === undefined ||
				node.file.includes("\\") ||
				node.file.includes(":") ||
				node.file.startsWith("/")
			) continue;
			const type = gapTypeOf(node) ?? node.file;
			const set = gapSets.get(node.file) ?? new Set<string>();
			set.add(type);
			gapSets.set(node.file, set);
		}
	};
	for (const [id, entry] of Object.entries(exec.tests)) {
		// Only per-test evidence can be claimed by one test. `shared`
		// entries stay in the shared bucket below; `unmeasured`/`error`
		// carry no coverage by construction. `stale` baseline entries name
		// a test the current revision no longer runs — a file covered only
		// by one would select nothing real, so they map nowhere either.
		if (entry.attribution !== "per-test" || entry.stale === true) continue;
		// file → member keys the test's nodes map into. The file key's
		// presence marks the test's exec coverage as member-qualified for
		// that file — even when every node mapped to nothing (empty list).
		// Node ids come from the merged tree (a carried baseline entry may
		// resolve through a node attached against the newer source). That is
		// coherent: member keys are name-anchored (`Ns.Type.M#sig`), so the
		// decl a baseline test covered maps to the same member name in the
		// current revision — a renamed/removed decl keeps its baseline node
		// and its added/removed member keys widen by rule anyway.
		const members = new Map<string, Set<string>>();
		for (const nodeId of entry.nodes) {
			const node = exec.nodes[nodeId];
			if (node === undefined || node.kind !== "method" || node.file === undefined) continue;
			const keys = members.get(node.file) ?? new Set<string>();
			if (node.member !== undefined) keys.add(node.member);
			members.set(node.file, keys);
		}
		recordGaps(entry.nodes);
		tests[id] = {
			files: [...new Set(entry.files)].sort(),
			automationIds: [],
			unmappedIds: [],
			sessions: [...new Set(entry.sessions)].sort(),
			outcome: entry.outcome,
			...(members.size > 0
				? {
						members: Object.fromEntries(
							[...members.entries()]
								.sort(([a], [b]) => a.localeCompare(b))
								.map(([file, keys]) => [file, [...keys].sort()]),
						),
					}
				: {}),
		};
	}
	recordGaps(exec.shared.nodes);
	return {
		tests: Object.fromEntries(
			Object.entries(tests).sort(([a], [b]) => a.localeCompare(b)),
		),
		sharedFiles: [...new Set(exec.shared.files)].sort(),
		unmatchedEvidence: [...new Set(exec.unmatchedEvidence)].sort(),
		memberGaps: Object.fromEntries(
			[...gapSets.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([file, types]) => [file, [...types].sort()]),
		),
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
