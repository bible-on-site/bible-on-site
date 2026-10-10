/**
 * Deterministic selection of affected E2E tests (#2085).
 *
 * `selectTests` is a pure function over a suite's rules, a trusted baseline
 * coverage tree, the accumulated diff and the tests discovered at the tested
 * revision. Identical inputs produce identical manifests.
 *
 * Selection order per changed file:
 *   1. Under the test root: a runnable test file selects its declared tests;
 *      any other file is shared harness and selects everything.
 *   2. `noImpact` globs select nothing.
 *   3. `runAllOnChange` globs select every applicable test.
 *   4. A file recorded in the baseline tree selects the tests covering it.
 *   5. Its logical unit (partial-class/code-behind grouping) does the same.
 *   6. Any other in-scope change conservatively selects every applicable test.
 *   7. Everything else is out of this suite's scope and selects nothing.
 *
 * Missing, corrupt, incompatible or non-ancestor baselines, unavailable or
 * truncated diffs, discovery failures and empty selections all fall back to
 * the full applicable suite — missing evidence is never proof of safety.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFingerprint } from "./fingerprint.ts";
import { globMatcher } from "./glob.ts";
import { isPartialClassOf } from "./xunit-discovery.ts";
import {
	fingerprint,
	SCHEMA_VERSION,
	validateTree,
	type ChangedFile,
	type CoverageTree,
	type DiscoveredTest,
	type SuiteRules,
} from "./model.ts";

export type Baseline =
	| { kind: "ok"; tree: CoverageTree }
	| { kind: "missing" | "corrupt" | "incompatible" | "not-ancestor" | "unknown"; reason: string };

export interface SelectionInput {
	rules: SuiteRules;
	baseline: Baseline;
	/** Accumulated snapshot→tested changes; null when the diff is unavailable. */
	changedFiles: ChangedFile[] | null;
	discovered: DiscoveredTest[];
	/** Suite platform key, e.g. `android`. */
	platform: string;
	testedSha: string;
	forceFull?: boolean;
	/** Reads file contents at the tested revision (partial-class detection). */
	readFile?: (repoRelativePath: string) => string | null;
	/**
	 * Tested-revision structural fingerprints keyed by repo-relative path,
	 * `null` where the file could not be fingerprinted. A modified file whose
	 * baseline and tested fingerprints match resolves as `unchanged-structural`
	 * and selects nothing — formatting and comment-only edits stop
	 * invalidating coverage. Any missing entry fails safe: the file is
	 * treated as changed.
	 */
	currentFingerprints?: ReadonlyMap<string, SourceFingerprint | null>;
}

export interface FileResolution {
	path: string;
	status: string;
	resolution: "tests" | "all" | "none" | "ignored";
	reason: string;
	tests?: string[];
}

export interface SelectionManifest {
	schemaVersion: number;
	suite: string;
	platform: string;
	mode: "full" | "subset";
	selectAll: boolean;
	snapshotSha: string | null;
	testedSha: string;
	fingerprint: string;
	forced: boolean;
	fallbacks: string[];
	changedFiles: FileResolution[];
	selected: { id: string; reasons: string[] }[];
	unselected: { id: string; reasons: string[] }[];
	/** Tests discovered but absent from the baseline tree. */
	newTests: string[];
	/** Baseline entries no longer discovered on this platform/revision. */
	staleTreeTests: string[];
	/**
	 * Modified files proven trivia-identical to their baseline fingerprint —
	 * they contributed no test selections.
	 */
	unchangedStructural: string[];
	/**
	 * Changed test files whose declared tests are not candidates on this
	 * platform (other platform or another test category) — diagnostics only.
	 */
	nonApplicableTestChanges: string[];
	filter: { vstest: string | null };
}

/** Test ids applicable to a platform job (its own tests plus shared ones). */
export function applicableTests(
	discovered: DiscoveredTest[],
	platform: string,
): DiscoveredTest[] {
	const wanted = platform.toLowerCase();
	return discovered.filter(
		(test) =>
			test.platform.toLowerCase() === "shared" ||
			test.platform.toLowerCase() === wanted,
	);
}

/** Maps a repo-relative file to its logical unit using snapshot evidence. */
export function fileToUnit(
	path: string,
	tree: CoverageTree,
	readFile: (p: string) => string | null,
): string {
	for (const [unit, files] of Object.entries(tree.sourceUnits)) {
		if (files.includes(path)) return unit;
	}
	const stem = stripExtension(path);
	const slash = stem.lastIndexOf("/");
	const base = stem.slice(slash + 1);
	const dot = base.indexOf(".");
	if (dot === -1) return stem;
	const parent = `${stem.slice(0, slash + 1)}${base.slice(0, dot)}`;
	if (tree.sourceUnits[parent] === undefined) return stem;
	const content = readFile(path);
	if (content === null) {
		// Deleted file: the snapshot's units may still claim the parent.
		return tree.sourceUnits[parent] ? parent : stem;
	}
	return isPartialClassOf(content, base.slice(0, dot)) ? parent : stem;
}

/** `dir/Foo.xaml.cs` → `dir/Foo`; `dir/Foo.xaml` → `dir/Foo`; `dir/Foo.cs` → `dir/Foo`. */
export function stripExtension(path: string): string {
	for (const suffix of [".xaml.cs", ".xaml", ".cs", ".ts", ".tsx", ".js", ".mjs", ".mts", ".rs"]) {
		if (path.endsWith(suffix)) return path.slice(0, -suffix.length);
	}
	const dot = path.lastIndexOf(".");
	return dot === -1 ? path : path.slice(0, dot);
}

export function selectTests(input: SelectionInput): SelectionManifest {
	const { rules, discovered, platform } = input;
	const readFile = input.readFile ?? (() => null);
	const candidates = applicableTests(discovered, platform);
	const candidateIds = new Set(candidates.map((test) => test.id));
	const fallbacks: string[] = [];
	const reasons = new Map<string, Set<string>>();

	const addReason = (id: string, reason: string) => {
		if (!candidateIds.has(id)) return;
		reasons.get(id)?.add(reason) ?? reasons.set(id, new Set([reason]));
	};
	const selectAll = (reason: string) => {
		fallbacks.push(reason);
		for (const test of candidates) addReason(test.id, `fallback:${reason}`);
	};

	// ── Baseline and diff sanity → conservative full suite ────────────────
	const tree = input.baseline.kind === "ok" ? input.baseline.tree : null;
	if (input.forceFull) {
		selectAll("forced-full-run");
	} else if (input.baseline.kind !== "ok") {
		selectAll(`${input.baseline.kind}-baseline:${input.baseline.reason}`);
	} else {
		const incompatible = validateTree(tree, rules, platform);
		if (incompatible !== null) selectAll(`incompatible-baseline:${incompatible}`);
	}
	const changedFiles =
		input.changedFiles === null
			? null
			: [...input.changedFiles].sort(
					(a, b) =>
						a.path.localeCompare(b.path) || a.status.localeCompare(b.status),
				);
	if (changedFiles === null && fallbacks.length === 0) {
		selectAll("diff-unavailable");
	}

	// ── Per-file resolution ───────────────────────────────────────────────
	const resolutions: FileResolution[] = [];
	const nonApplicableTestChanges: string[] = [];
	const inTestRoot = (path: string) =>
		path === rules.tests.root || path.startsWith(`${rules.tests.root}/`);
	const isTestFile = globMatcher([rules.tests.glob]);
	const noImpact = globMatcher(rules.noImpact);
	const runAll = globMatcher(rules.runAllOnChange);
	const inScope = globMatcher(rules.scope);
	const testRootRelative = (path: string) => path.slice(rules.tests.root.length + 1);

	const mappedByFile = new Map<string, string[]>();
	const mappedByUnit = new Map<string, string[]>();
	if (tree) {
		for (const [id, entry] of Object.entries(tree.tests)) {
			for (const file of entry.files) {
				mappedByFile.set(file, [...(mappedByFile.get(file) ?? []), id]);
			}
			for (const file of entry.files) {
				const unit = fileToUnit(file, tree, readFile);
				mappedByUnit.set(unit, [...(mappedByUnit.get(unit) ?? []), id]);
			}
		}
	}

	const resolveOne = (rawPath: string, status: string): FileResolution => {
		const path = rawPath.replace(/\\/g, "/");
		const finish = (
			resolution: FileResolution["resolution"],
			reason: string,
			tests?: string[],
		): FileResolution => ({ path, status, resolution, reason, tests });

		if (inTestRoot(path)) {
			if (isTestFile(testRootRelative(path))) {
				const declared = candidates.filter((test) => test.file === path);
				const declaredIds = declared.map((test) => test.id);
				if (declared.length === 0 && status !== "deleted") {
					nonApplicableTestChanges.push(path);
				}
				return finish(
					declared.length > 0 ? "tests" : "none",
					status === "deleted" ? "deleted-test-file" : "changed-test-file",
					declaredIds,
				);
			}
			return finish("all", "changed-test-harness");
		}
		if (noImpact(path)) return finish("ignored", "no-impact-rule");
		if (runAll(path)) return finish("all", "global-trigger");
		// Structural equivalence: a modified file whose baseline and tested
		// fingerprints are identical could only have changed in trivia. Broad
		// patterns (above) stay absolute — bootstrap/config edits always run.
		if (status === "modified") {
			const baselineFp = tree?.sourceFingerprints?.[path];
			const currentFp = input.currentFingerprints?.get(path);
			if (
				baselineFp !== undefined &&
				currentFp != null &&
				baselineFp.version === currentFp.version &&
				baselineFp.semantic === currentFp.semantic
			) {
				return finish("none", "unchanged-structural");
			}
		}
		if (tree) {
			const fileTests = mappedByFile.get(path);
			if (fileTests !== undefined && fileTests.length > 0) {
				return finish("tests", "covered-file", [...fileTests].sort());
			}
			const unit = fileToUnit(path, tree, readFile);
			const unitTests = mappedByUnit.get(unit);
			if (unitTests !== undefined && unitTests.length > 0) {
				return finish("tests", "covered-unit", [...unitTests].sort());
			}
		}
		if (inScope(path)) return finish("all", "unmapped-in-scope");
		return finish("none", "out-of-scope");
	};

	if (changedFiles !== null) {
		for (const change of changedFiles) {
			const resolution = resolveOne(change.path, change.status);
			resolutions.push(resolution);
			for (const id of resolution.tests ?? []) {
				addReason(id, `${resolution.reason}:${resolution.path}`);
			}
			if (resolution.resolution === "all" && fallbacks.length === 0) {
				selectAll(`${resolution.reason}:${resolution.path}`);
			}
			if (change.previousPath !== undefined) {
				const previous = resolveOne(change.previousPath, "renamed-from");
				for (const id of previous.tests ?? []) {
					addReason(id, `renamed:${change.previousPath}`);
				}
				if (previous.resolution === "all" && fallbacks.length === 0) {
					selectAll(`renamed:${change.previousPath}`);
				}
			}
		}
	}

	// ── Always-run smoke set and previously-failing policy ────────────────
	for (const id of rules.alwaysRun) addReason(id, "always-run");
	if (tree && fallbacks.length === 0) {
		for (const [id, entry] of Object.entries(tree.tests)) {
			if (entry.outcome !== "passed") addReason(id, "previously-failing");
		}
	}

	// ── Compose the manifest ──────────────────────────────────────────────
	const staleTreeTests = tree
		? Object.keys(tree.tests).filter((id) => !candidateIds.has(id)).sort()
		: [];
	const newTests = tree
		? candidates.filter((test) => tree.tests[test.id] === undefined).map((test) => test.id)
		: [];
	for (const id of newTests) addReason(id, "new-test");

	let selected = candidates.filter((test) => reasons.has(test.id));
	if (selected.length === 0 && fallbacks.length === 0) {
		// Empty selection is a selection bug, never a green light to skip all.
		selectAll("empty-selection-guard");
		selected = candidates;
	}
	const selectAllMode = fallbacks.length > 0;
	const sortedReasons = (id: string) => [...(reasons.get(id) ?? new Set<string>())].sort();
	const fingerprintInputs = input.currentFingerprints
		? [...input.currentFingerprints.entries()]
				.map(([path, fp]) => [path, fp?.semantic ?? null])
				.sort(([a], [b]) => a.localeCompare(b))
		: null;
	const manifest: SelectionManifest = {
		schemaVersion: SCHEMA_VERSION,
		suite: rules.suite,
		platform,
		mode: selectAllMode ? "full" : "subset",
		selectAll: selectAllMode,
		snapshotSha: tree?.snapshotSha ?? null,
		testedSha: input.testedSha,
		fingerprint: fingerprint([
			rules,
			tree ?? input.baseline,
			changedFiles,
			fingerprintInputs,
		]),
		forced: input.forceFull === true,
		fallbacks: fallbacks.sort(),
		changedFiles: resolutions.sort((a, b) => a.path.localeCompare(b.path)),
		selected: selected
			.map((test) => ({ id: test.id, reasons: sortedReasons(test.id) }))
			.sort((a, b) => a.id.localeCompare(b.id)),
		unselected: candidates
			.filter((test) => !reasons.has(test.id))
			.map((test) => ({ id: test.id, reasons: [] }))
			.sort((a, b) => a.id.localeCompare(b.id)),
		newTests: newTests.sort(),
		staleTreeTests,
		unchangedStructural: resolutions
			.filter((resolution) => resolution.reason === "unchanged-structural")
			.map((resolution) => resolution.path)
			.sort(),
		nonApplicableTestChanges: nonApplicableTestChanges.sort(),
		filter: {
			vstest: selectAllMode
				? null
				: selected.map((test) => `FullyQualifiedName=${test.id}`).join("|"),
		},
	};
	return manifest;
}

/** Convenience loader for the tested-revision file reader used by fileToUnit. */
export function repoFileReader(repoRoot: string): (path: string) => string | null {
	return (path) => {
		try {
			return readFileSync(join(repoRoot, path), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	};
}
