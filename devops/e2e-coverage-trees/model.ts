/**
 * Executable coverage-tree model (#2085) — `exec-coverage-tree` schema v1.
 *
 * Where the e2e-impact `coverage-tree.json` records which automation ids a
 * scenario queried (view-reachability evidence), this tree records the real
 * IL sequence/branch points the instrumented app executed per scenario —
 * the per-test execution evidence the issue's deterministic selection is
 * built on. The schema is documented in `docs/devops/e2e-test-selection.md`.
 *
 * Identity contract: test ids are xUnit fully-qualified names; node ids are
 * declaration names (`method:Namespace.Type.Name`), never line numbers or
 * traversal indices. Position-independence is what lets the AST comparison
 * layer join nodes across revisions.
 */
import { createHash } from "node:crypto";

export const EXEC_TREE_KIND = "exec-coverage-tree";
export const EXEC_TREE_SCHEMA_VERSION = 1;

/** Canonical serialization: sorted keys — stable hashing and diffs. */
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

export function sha256(parts: unknown[]): string {
	return createHash("sha256")
		.update(parts.map((part) => canonicalize(part)).join("\n"))
		.digest("hex");
}

/** `^[0-9a-f]{40}$` without the regex engine — snapshot ids are plain data. */
export function isHexSha(value: string): boolean {
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

/** A source declaration covered by execution evidence. */
export interface CoveredNode {
	kind: "method" | "type" | "file";
	/**
	 * Position-independent identity: `Namespace.Type.Method`,
	 * `Namespace.Type` or a repo-relative file path.
	 */
	decl: string;
	/** Method metadata token — snapshot-local overload disambiguator only. */
	token?: string;
	/** Repo-relative primary file (methods/types); raw when external. */
	file?: string;
	/** Every file the declaration's points span (partial classes). */
	files?: string[];
	/** `[minSl, maxEl]` of the declaration's sequence points. */
	span?: [number, number];
	/** Containment edges — the only edge kind this slice emits. */
	parents?: string[];
	/** Instrumented points the decl carries in the template. */
	points?: { sequence: number; branch: number };
	/** Raw build-machine path when it could not be repo-normalized. */
	external?: boolean;
}

export type TestAttribution = "per-test" | "shared" | "unmeasured" | "error";

/** Per-test execution evidence for one suite on one platform. */
export interface ExecCoverageTest {
	/** Stable xUnit identity: `Namespace.Class.Method`. */
	id: string;
	/** Theory case display suffixes observed in the run's reports. */
	cases: string[];
	attribution: TestAttribution;
	/** Whether THIS tree's run produced the entry's evidence. */
	measured: boolean;
	outcome: string;
	/** Commit whose run measured the entry (baseline entries keep theirs). */
	evidenceSha: string;
	sessions: string[];
	startedUtc?: string;
	endedUtc?: string;
	/** Covered `method:*` node ids, sorted. */
	nodes: string[];
	/** Covered repo-relative app files, sorted. */
	files: string[];
	visits: { sequence: number; branch: number; methodEntries: number };
	/** First line of the dump's `.coverage-error.txt`, when attribution=error. */
	coverageError?: string;
	/** Baseline entry whose test id is no longer discovered. */
	stale?: boolean;
}

export interface ExecTreeDiagnostics {
	/** per-test | shared | mixed — how this tree's evidence was attributed. */
	attribution: "per-test" | "shared" | "mixed";
	dumpsTotal: number;
	dumpsApplied: number;
	/** Dump fileBase names whose pull failed (`.coverage-error.txt`). */
	errorDumps: string[];
	/** Dumps whose module hashes match no template module (stale build). */
	incompatibleDumps: string[];
	/** Visit keys that resolved to no known point in the template. */
	unknownPointIds: number;
	/** Tests that ran but produced neither a dump nor an error file. */
	missingDumps: string[];
	/** Snapshot sha a baseline was merged from. */
	mergedFromBaseline?: string;
	mergeWarnings?: string[];
}

export interface ExecCoverageTree {
	kind: typeof EXEC_TREE_KIND;
	schemaVersion: number;
	suite: string;
	/** One platform per tree — `android` | `ios`, never mixed. */
	platform: string;
	configuration: string;
	/** Commit SHA whose instrumented build produced this evidence. */
	snapshotSha: string;
	collector: string;
	/** AltCover version (or `unknown`) from the build manifest. */
	collectorVersion: string;
	collectedAtUtc: string;
	/** false when the run did not complete — tree is partial evidence. */
	complete: boolean;
	/** sha256 over suite+platform+collector+version+module hashes. */
	envFingerprint: string;
	modules: { name: string; hash: string }[];
	/** Union of every decl covered by any entry or the shared bucket. */
	nodes: Record<string, CoveredNode>;
	tests: Record<string, ExecCoverageTest>;
	/** Coverage no single test could claim — widens selection, never drops. */
	shared: { reasons: string[]; nodes: string[]; files: string[] };
	/** Dump names that resolved to no known test. */
	unmatchedEvidence: string[];
	diagnostics: ExecTreeDiagnostics;
}

/** Validates a loaded tree against the expected suite/platform identity. */
export function validateExecTree(
	tree: ExecCoverageTree,
	expect: { suite: string; platform: string },
): string | null {
	if (tree.kind !== EXEC_TREE_KIND) return `kind ${String(tree.kind)}`;
	if (tree.schemaVersion !== EXEC_TREE_SCHEMA_VERSION) {
		return `schemaVersion ${tree.schemaVersion}`;
	}
	if (tree.suite !== expect.suite) return `suite ${tree.suite}`;
	if (tree.platform !== expect.platform) return `platform ${tree.platform}`;
	if (!isHexSha(tree.snapshotSha)) return `snapshotSha ${tree.snapshotSha}`;
	if (typeof tree.tests !== "object" || tree.tests === null) return "missing tests";
	return null;
}
