/**
 * Executable coverage-tree extraction (#2085): turns the AltCover OpenCover
 * template plus the per-test app-coverage dumps into the `exec-coverage-tree`
 * documented in docs/devops/e2e-test-selection.md.
 *
 * Attribution is deliberately conservative: anything that cannot be tied to
 * exactly one test lands in the tree's `shared` bucket — a change touching
 * shared nodes must widen selection, so unattributed coverage is never
 * dropped. When a run cannot split coverage per test at all (no dumps —
 * the pre-#2156 artifact shape), the shared path attributes every covered
 * node to every executed test as `shared` evidence.
 */
import {
	extractCSharpMembers,
	type SourceMember,
} from "../github/ci/e2e-impact/fingerprint.ts";
import type {
	CoverageDump,
	DumpError,
	TestRunRecord,
} from "./evidence.ts";
import {
	EXEC_TREE_KIND,
	EXEC_TREE_SCHEMA_VERSION,
	sha256,
	type CoveredNode,
	type ExecCoverageTest,
	type ExecCoverageTree,
	type ExecTreeDiagnostics,
	validateExecTree,
} from "./model.ts";
import type { MethodModel, OpenCoverModel } from "./opencover.ts";

/** Everything needed to attribute one run; loaders stay in the CLI layer. */
export interface ExtractInput {
	suite: string;
	platform: string;
	configuration: string;
	snapshotSha: string;
	collector: string;
	collectorVersion: string;
	complete: boolean;
	/** Parsed OpenCover document (template, or applied report for vc data). */
	cover: OpenCoverModel;
	/** Per-test dumps; absent/empty triggers shared-mode attribution. */
	dumps: CoverageDump[];
	dumpErrors: DumpError[];
	/** Executed tests (evidence + TRX/JUnit merged), used for join + listing. */
	runRecords: TestRunRecord[];
	/** `{fileBase}-{outcome}` → run record (the exact evidence join). */
	recordByStem: Map<string, TestRunRecord>;
	/** Method name → FQN when discovery resolved it uniquely. */
	fqnByMethod: Map<string, string>;
	/** Repo-relative source anchor for file normalization, e.g. app/BibleOnSite. */
	sourceRoot: string;
	/** Extra build-machine prefixes stripped before anchoring. */
	stripPrefixes: string[];
	/** Ids discovered at this revision — the staleness oracle for merge. */
	discoveredIds: string[];
	collectedAtUtc?: string;
	/**
	 * Reads repo-relative source at the snapshot revision so method nodes
	 * can be mapped onto source members (#2085 member granularity). When
	 * absent — or a file is missing/unparseable — nodes simply carry no
	 * `member` and the selector widens them to file level; never guessed.
	 */
	readSource?: (repoPath: string) => string | null;
}

/** A file path in normalized repo-relative shape; `external` when unmappable. */
interface NormalizedFile {
	path: string;
	external: boolean;
}

/**
 * Normalizes a build-machine `File@fullPath` to a repo-relative POSIX path:
 * first any `stripPrefixes`, then the first `<sourceRoot>/` segment becomes
 * the repo anchor. Paths matching neither stay raw and flag `external` —
 * external files widen later selection rather than pretending they do not
 * exist.
 */
export function normalizeSourcePath(
	fullPath: string,
	sourceRoot: string,
	stripPrefixes: string[],
): NormalizedFile {
	const posix = fullPath.replace(/\\/g, "/");
	for (const prefix of stripPrefixes) {
		const normalized = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
		if (posix.startsWith(`${normalized}/`)) {
			return { path: posix.slice(normalized.length + 1), external: false };
		}
	}
	const anchor = `${sourceRoot}/`;
	const index = posix.indexOf(anchor);
	if (index !== -1) return { path: posix.slice(index), external: false };
	return { path: posix, external: true };
}

interface PointRef {
	nodeId: string;
	file: NormalizedFile;
}

interface BuiltIndex {
	/** module hash → visit key → covered decl/file. */
	points: Map<string, Map<number, PointRef>>;
	/** Node definitions for every instrumented decl in the template. */
	nodes: Map<string, CoveredNode>;
	/** method node id → covered files (for entries). */
	methodFiles: Map<string, string[]>;
	/** method node id → true when any point file could not be repo-normalized. */
	methodExternal: Map<string, boolean>;
	modules: { name: string; hash: string }[];
}

const NO_FILE: NormalizedFile = { path: "", external: false };

/**
 * Builds the decl index from the OpenCover document. Node ids are
 * `method:Namespace.Type.Name` with a `#<metadata-token>` suffix only when a
 * type overloads one method name — position-independent decls stay the join
 * surface for the AST comparison layer.
 */
export function buildIndex(
	cover: OpenCoverModel,
	sourceRoot: string,
	stripPrefixes: string[],
): BuiltIndex {
	const points = new Map<string, Map<number, PointRef>>();
	const nodes = new Map<string, CoveredNode>();
	const methodFiles = new Map<string, string[]>();
	const methodExternal = new Map<string, boolean>();
	const modules: { name: string; hash: string }[] = [];

	for (const module of cover.modules) {
		const fileOf = (fileId: string): NormalizedFile =>
			fileId === ""
				? NO_FILE
				: normalizeSourcePath(module.files.get(fileId) ?? fileId, sourceRoot, stripPrefixes);
		// Overloads: count bare decls per module so only real collisions get a
		// token suffix — ids stay clean for the overwhelmingly common case.
		const declCounts = new Map<string, number>();
		for (const method of module.methods) {
			const decl = `${method.className}.${method.name}`;
			declCounts.set(decl, (declCounts.get(decl) ?? 0) + 1);
		}
		const modulePoints = new Map<number, PointRef>();
		for (const method of module.methods) {
			const nodeId = methodNodeId(method, declCounts);
			const files = new Map<string, NormalizedFile>();
			let minSl = Number.POSITIVE_INFINITY;
			let maxEl = 0;
			let external = false;
			const addFile = (fileId: string): NormalizedFile => {
				const cached = files.get(fileId);
				if (cached !== undefined) return cached;
				const normalized = fileOf(fileId);
				files.set(fileId, normalized);
				if (normalized.external) external = true;
				return normalized;
			};
			for (const point of method.sequencePoints) {
				const file = addFile(point.fileId);
				modulePoints.set(point.uspid, { nodeId, file });
				minSl = Math.min(minSl, point.sl);
				maxEl = Math.max(maxEl, point.el);
			}
			for (const point of method.branchPoints) {
				const file = addFile(point.fileId);
				// Recorder contract: branch visits arrive as `uspid | int.MinValue`,
				// i.e. a negative key whose low 31 bits hold the uspid.
				modulePoints.set(point.uspid | -2147483648, { nodeId, file });
			}
			if (method.tokenKey !== null) {
				// Method-entry visits arrive keyed by the metadata token.
				modulePoints.set(method.tokenKey, {
					nodeId,
					file: addFile(method.fileRef ?? firstFileId(method)),
				});
			}
			if (method.sequencePoints.length === 0 && method.branchPoints.length === 0) {
				continue; // decl carries no instrumented points — cannot be observed
			}
			const sortedFiles = [...files.values()]
				.map((file) => file.path)
				.filter((path) => path.length > 0)
				.sort();
			const primary = normalizedPrimary(method, files);
			nodes.set(nodeId, {
				kind: "method",
				decl: `${method.className}.${method.name}`,
				...(method.token !== null ? { token: method.token } : {}),
				...(primary !== null ? { file: primary } : {}),
				...(sortedFiles.length > 0 ? { files: sortedFiles } : {}),
				...(minSl !== Number.POSITIVE_INFINITY
					? { span: [minSl, maxEl] as [number, number] }
					: {}),
				parents: [`type:${method.className}`],
				points: {
					sequence: method.sequencePoints.length,
					branch: method.branchPoints.length,
				},
			});
			methodFiles.set(nodeId, sortedFiles);
			methodExternal.set(nodeId, external);
		}
		if (modulePoints.size > 0) points.set(module.hash.toLowerCase(), modulePoints);
		modules.push({ name: module.name, hash: module.hash });
	}
	return { points, nodes, methodFiles, methodExternal, modules };
}

const firstFileId = (method: MethodModel): string =>
	method.sequencePoints[0]?.fileId ?? method.branchPoints[0]?.fileId ?? "";

/**
 * Attaches `member`/`memberType` to method nodes whose point span is
 * contained by exactly one innermost source member in the node's primary
 * file (#2085 member granularity). Nodes that cannot map — no span, no
 * repo-normalized file, unparsable or missing source, or members with
 * identical spans (`#if` twins) — are left unmapped: the selector records
 * their type in `memberGaps` and widens rather than guesses.
 */
function attachMembers(
	index: BuiltIndex,
	sourceRoot: string,
	readSource: (repoPath: string) => string | null,
): void {
	const membersByFile = new Map<string, SourceMember[] | null>();
	const membersOf = (file: string): SourceMember[] | null => {
		let members = membersByFile.get(file);
		if (members === undefined) {
			const content = readSource(file);
			members = content === null ? null : extractCSharpMembers(file, content);
			membersByFile.set(file, members);
		}
		return members;
	};
	for (const node of index.nodes.values()) {
		if (node.kind !== "method" || node.file === undefined) continue;
		const span = node.span;
		if (span === undefined) continue;
		if (!node.file.startsWith(`${sourceRoot}/`)) continue;
		// A node whose points span multiple files mixes two line-number
		// spaces (e.g. `#line`-mapped generated code) — containment against
		// the primary file's members would be meaningless, so it stays
		// unmapped and widens via memberGaps instead.
		const nodeFiles = node.files ?? [node.file];
		if (nodeFiles.length !== 1 || nodeFiles[0] !== node.file) continue;
		const members = membersOf(node.file);
		if (members === null) continue;
		const sourceMembers = members.filter((member) => member.kind === "member");
		// Member spans are disjoint (a member body never emits members), so
		// at most one member contains the node's whole point span.
		let target = sourceMembers.find(
			(member) => member.span[0] <= span[0] && span[1] <= member.span[1],
		);
		if (
			target === undefined &&
			(node.decl.endsWith(".ctor") || node.decl.endsWith(".cctor"))
		) {
			// Constructor nodes gather field/property initializer points from
			// earlier member declarations — the span crosses member lines by
			// construction. The node's tail is the ctor's own body, which
			// sits inside exactly one member.
			target = sourceMembers.find(
				(member) => member.span[0] <= span[1] && span[1] <= member.span[1],
			);
		}
		if (target === undefined) continue;
		node.member = target.key;
		node.memberType = target.typeKey;
	}
}

function methodNodeId(method: MethodModel, declCounts: Map<string, number>): string {
	const decl = `${method.className}.${method.name}`;
	const duplicated = (declCounts.get(decl) ?? 0) > 1;
	return duplicated && method.token !== null
		? `method:${decl}#${method.token}`
		: `method:${decl}`;
}

/** Primary file: the method's declared FileRef, else its first point's file. */
function normalizedPrimary(
	method: MethodModel,
	files: Map<string, NormalizedFile>,
): string | null {
	const ref = method.fileRef !== null ? files.get(method.fileRef) : undefined;
	if (ref !== undefined && ref.path !== "") return ref.path;
	const first = files.get(firstFileId(method));
	return first !== undefined && first.path !== "" ? first.path : null;
}

interface Attribution {
	nodeIds: Set<string>;
	files: Set<string>;
	visits: { sequence: number; branch: number; methodEntries: number };
	unknown: number;
	matchedModules: boolean;
}

/** Applies one dump's hit map to the index; the E2ECoverageApply key rules. */
function attributeDump(dump: CoverageDump, index: BuiltIndex): Attribution {
	const nodeIds = new Set<string>();
	const files = new Set<string>();
	const visits = { sequence: 0, branch: 0, methodEntries: 0 };
	let unknown = 0;
	let matchedModules = false;
	for (const [hash, points] of dump.modules) {
		const modulePoints = index.points.get(hash.toLowerCase());
		if (modulePoints === undefined) continue;
		matchedModules = true;
		for (const [key, count] of points) {
			const ref = modulePoints.get(key);
			if (ref === undefined) {
				unknown += 1;
				continue;
			}
			if (count <= 0) continue;
			nodeIds.add(ref.nodeId);
			if (ref.file.path !== "") files.add(ref.file.path);
			// Recorder key space: <0 branch, >=0x06000000 method-entry, else sequence.
			if (key < 0) visits.branch += count;
			else if (key >= 0x6000000) visits.methodEntries += count;
			else visits.sequence += count;
		}
	}
	return { nodeIds, files, visits, unknown, matchedModules };
}

const sortedStrings = (values: Iterable<string>): string[] => [...values].sort();

/** The conservative bucket for coverage no single test could claim. */
interface Shared {
	reasons: Set<string>;
	nodeIds: Set<string>;
	files: Set<string>;
}

function addShared(shared: Shared, attribution: Attribution, reason: string): void {
	shared.reasons.add(reason);
	for (const id of attribution.nodeIds) shared.nodeIds.add(id);
	for (const file of attribution.files) shared.files.add(file);
}

const zeroVisits = () => ({ sequence: 0, branch: 0, methodEntries: 0 });

/**
 * The extraction proper — pure over already-loaded inputs so the unit tests
 * never touch the filesystem or a clock.
 */
export function extractTree(input: ExtractInput): ExecCoverageTree {
	const index = buildIndex(input.cover, input.sourceRoot, input.stripPrefixes);
	if (input.readSource !== undefined) {
		attachMembers(index, input.sourceRoot, input.readSource);
	}
	const shared: Shared = { reasons: new Set(), nodeIds: new Set(), files: new Set() };
	const tests = new Map<string, ExecCoverageTest>();
	const unmatchedEvidence: string[] = [];
	const diagnostics: ExecTreeDiagnostics = {
		attribution: "per-test",
		dumpsTotal: input.dumps.length,
		dumpsApplied: 0,
		errorDumps: input.dumpErrors.map((error) => `${error.fileBase}-${error.outcome}`).sort(),
		incompatibleDumps: [],
		unknownPointIds: 0,
		missingDumps: [],
	};

	// The exact join: `{fileBase}-{outcome}` evidence record, else a record of
	// the same fileBase with any outcome (identity only — the dump's outcome
	// stays authoritative for its own attempt), else unique-method discovery.
	const resolveRecord = (
		fileBase: string,
		outcome: string,
	): { record?: TestRunRecord; exact: boolean } => {
		const exact = input.recordByStem.get(`${fileBase}-${outcome}`);
		if (exact !== undefined) return { record: exact, exact: true };
		const other = input.recordByStem.get(`${fileBase}-passed`) ?? input.recordByStem.get(`${fileBase}-failed`);
		return { record: other, exact: false };
	};

	// ── Per-test dump attribution ───────────────────────────────────────
	for (const dump of input.dumps) {
		const attribution = attributeDump(dump, index);
		diagnostics.unknownPointIds += attribution.unknown;
		if (dump.untimed) {
			addShared(shared, attribution, `untimed-dump:${dump.name}`);
			continue;
		}
		if (!attribution.matchedModules) {
			// A dump keyed to a different build proves nothing — diagnosed, never
			// applied, and never silently dropped.
			diagnostics.incompatibleDumps.push(dump.name);
			continue;
		}
		diagnostics.dumpsApplied += 1;
		if (dump.fileBase === "_startup") {
			// Launch code (App.xaml.cs, MauiProgram, startup navigation) runs
			// before the post-connect reset — shared evidence by construction.
			addShared(shared, attribution, "app-startup");
			continue;
		}
		const { record, exact } = resolveRecord(dump.fileBase, dump.outcome);
		const fqn = record?.id ?? input.fqnByMethod.get(dump.fileBase);
		if (fqn === undefined) {
			addShared(shared, attribution, `unmatched-dump:${dump.name}`);
			unmatchedEvidence.push(dump.name);
			continue;
		}
		const previous = tests.get(fqn);
		tests.set(fqn, {
			id: fqn,
			cases: record?.cases ?? previous?.cases ?? [],
			attribution: "per-test",
			measured: true,
			outcome: exact && record !== undefined ? record.outcome : dump.outcome,
			evidenceSha: input.snapshotSha,
			sessions: record?.sessions ?? [],
			...(record?.startedUtc !== undefined ? { startedUtc: record.startedUtc } : {}),
			...(record?.endedUtc !== undefined ? { endedUtc: record.endedUtc } : {}),
			nodes: sortedStrings(new Set([...(previous?.nodes ?? []), ...attribution.nodeIds])),
			files: sortedStrings(new Set([...(previous?.files ?? []), ...attribution.files])),
			visits: {
				sequence: (previous?.visits.sequence ?? 0) + attribution.visits.sequence,
				branch: (previous?.visits.branch ?? 0) + attribution.visits.branch,
				methodEntries: (previous?.visits.methodEntries ?? 0) + attribution.visits.methodEntries,
			},
		});
	}

	// ── Failed pulls: real gaps, never measured evidence ────────────────
	for (const error of input.dumpErrors) {
		const { record } = resolveRecord(error.fileBase, error.outcome);
		const fqn = record?.id ?? input.fqnByMethod.get(error.fileBase) ?? error.fileBase;
		if (tests.has(fqn)) continue; // a retried attempt already produced evidence
		tests.set(fqn, {
			id: fqn,
			cases: record?.cases ?? [],
			attribution: "error",
			// measured stays false: a merge must never overwrite measured
			// baseline evidence with a void pull.
			measured: false,
			outcome: record?.outcome ?? error.outcome,
			evidenceSha: input.snapshotSha,
			sessions: record?.sessions ?? [],
			...(record?.startedUtc !== undefined ? { startedUtc: record.startedUtc } : {}),
			...(record?.endedUtc !== undefined ? { endedUtc: record.endedUtc } : {}),
			nodes: [],
			files: [],
			visits: zeroVisits(),
			coverageError: error.message,
		});
	}

	// ── Tests that ran but left no dump or error ────────────────────────
	for (const record of input.runRecords) {
		if (tests.has(record.id)) continue;
		tests.set(record.id, {
			id: record.id,
			cases: record.cases,
			attribution: "unmeasured",
			measured: false,
			outcome: record.outcome,
			evidenceSha: input.snapshotSha,
			sessions: record.sessions,
			...(record.startedUtc !== undefined ? { startedUtc: record.startedUtc } : {}),
			...(record.endedUtc !== undefined ? { endedUtc: record.endedUtc } : {}),
			nodes: [],
			files: [],
			visits: zeroVisits(),
		});
		if (input.dumps.length > 0) diagnostics.missingDumps.push(record.id);
	}

	// ── Shared mode: coverage that is not split per test ────────────────
	// TODO(#2085): the only per-test channel is `app-coverage/` (#2156); until
	// it lands on both platforms this fallback attributes the whole covered
	// set to every executed test — coarse but never silently empty.
	// TODO(#2085): `fileBase` is the method name, so theory cases sharing a
	// method overwrite one dump file — per-case coverage cannot exist with
	// this naming. The harness should fold a case hash into `fileBase` so
	// `cases[]` can carry per-case evidence.
	if (diagnostics.dumpsApplied === 0) {
		const covered = coveredByVc(input.cover, index);
		addShared(shared, covered, "whole-suite-report");
		const executed: TestRunRecord[] =
			input.runRecords.length > 0
				? input.runRecords
				: input.discoveredIds.map((id) => ({
						id,
						outcome: "unknown",
						sessions: [],
						cases: [],
						source: "evidence",
					}));
		// `measured` follows the actual covered set: a run whose report carries
		// zero hits (or a void pull) must never overwrite measured baseline
		// evidence through the merge — see mergeTrees.
		const hasCovered = covered.nodeIds.size > 0;
		for (const record of executed) {
			// A void (error/unmeasured) entry is overwritten — the whole-suite
			// report does cover this test, just coarsely; keep its diagnostic.
			const coverageError =
				tests.get(record.id)?.attribution === "error"
					? tests.get(record.id)?.coverageError
					: undefined;
			tests.set(record.id, {
				id: record.id,
				cases: record.cases,
				attribution: "shared",
				measured: hasCovered,
				outcome: record.outcome,
				evidenceSha: input.snapshotSha,
				sessions: record.sessions,
				...(record.startedUtc !== undefined ? { startedUtc: record.startedUtc } : {}),
				...(record.endedUtc !== undefined ? { endedUtc: record.endedUtc } : {}),
				nodes: sortedStrings(covered.nodeIds),
				files: sortedStrings(covered.files),
				visits: { ...covered.visits },
				...(coverageError !== undefined ? { coverageError } : {}),
			});
		}
		diagnostics.attribution = "shared";
	}
	diagnostics.missingDumps.sort();
	diagnostics.incompatibleDumps.sort();

	// ── Assemble the tree: nodes pruned to referenced decls + parents ──
	const referenced = new Set<string>();
	for (const entry of tests.values()) for (const id of entry.nodes) referenced.add(id);
	for (const id of shared.nodeIds) referenced.add(id);
	const nodes: Record<string, CoveredNode> = {};
	const typeFiles = new Map<string, Set<string>>();
	for (const id of [...referenced].sort()) {
		const node = index.nodes.get(id);
		if (node === undefined) continue;
		nodes[id] = index.methodExternal.get(id) === true ? { ...node, external: true } : node;
		for (const parent of node.parents ?? []) {
			const files = typeFiles.get(parent) ?? new Set<string>();
			for (const file of node.files ?? (node.file !== undefined ? [node.file] : [])) {
				files.add(file);
			}
			typeFiles.set(parent, files);
		}
	}
	for (const [parent, files] of [...typeFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const parents = [...files].sort().map((file) => `file:${file}`);
		nodes[parent] = {
			kind: "type",
			decl: parent.slice("type:".length),
			...(files.size > 0 ? { files: [...files].sort() } : {}),
			...(parents.length > 0 ? { parents } : {}),
		};
		for (const file of files) {
			nodes[`file:${file}`] = { kind: "file", decl: file };
		}
	}

	return {
		kind: EXEC_TREE_KIND,
		schemaVersion: EXEC_TREE_SCHEMA_VERSION,
		suite: input.suite,
		platform: input.platform,
		configuration: input.configuration,
		snapshotSha: input.snapshotSha,
		collector: input.collector,
		collectorVersion: input.collectorVersion,
		collectedAtUtc: input.collectedAtUtc ?? new Date().toISOString(),
		complete: input.complete,
		envFingerprint: envFingerprint(input, index.modules),
		modules: index.modules.sort((a, b) => a.name.localeCompare(b.name)),
		nodes,
		tests: Object.fromEntries([...tests.entries()].sort(([a], [b]) => a.localeCompare(b))),
		shared: {
			reasons: sortedStrings(shared.reasons),
			nodes: sortedStrings(shared.nodeIds),
			files: sortedStrings(shared.files),
		},
		unmatchedEvidence: unmatchedEvidence.sort(),
		diagnostics,
	};
}

/** Decl-level coverage from `vc` attributes — the shared-mode covered set. */
function coveredByVc(
	cover: OpenCoverModel,
	index: BuiltIndex,
): Attribution {
	const nodeIds = new Set<string>();
	const files = new Set<string>();
	const visits = { sequence: 0, branch: 0, methodEntries: 0 };
	for (const module of cover.modules) {
		for (const method of module.methods) {
			const hit =
				method.visited ||
				method.sequencePoints.some((point) => point.vc > 0) ||
				method.branchPoints.some((point) => point.vc > 0);
			if (!hit) continue;
			const nodeId = findNodeId(index, `${method.className}.${method.name}`, method.token);
			if (nodeId === null) continue;
			nodeIds.add(nodeId);
			for (const file of index.methodFiles.get(nodeId) ?? []) files.add(file);
			visits.sequence += method.sequencePoints.reduce((sum, point) => sum + Math.max(point.vc, 0), 0);
			visits.branch += method.branchPoints.reduce((sum, point) => sum + Math.max(point.vc, 0), 0);
			if (method.visited) visits.methodEntries += 1;
		}
	}
	return { nodeIds, files, visits, unknown: 0, matchedModules: true };
}

function findNodeId(index: BuiltIndex, decl: string, token: string | null): string | null {
	const bare = `method:${decl}`;
	if (index.nodes.has(bare)) return bare;
	if (token !== null && index.nodes.has(`method:${decl}#${token}`)) {
		return `method:${decl}#${token}`;
	}
	for (const id of index.nodes.keys()) {
		if (id.startsWith(`${bare}#`)) return id;
	}
	return null;
}

/** sha256 over the suite/platform/collector coordinates + module hashes. */
export function envFingerprint(
	input: Pick<ExtractInput, "suite" | "platform" | "collector" | "collectorVersion">,
	modules: { name: string; hash: string }[],
): string {
	return sha256([
		input.suite,
		input.platform,
		input.collector,
		input.collectorVersion,
		[...modules].map((module) => `${module.name}:${module.hash}`).sort(),
	]);
}

/**
 * Merges a fresh extraction into a trusted baseline tree (#2085):
 *   - only entries actually measured this run replace baseline entries;
 *   - unmeasured entries keep their baseline evidence and `evidenceSha`;
 *   - baseline entries no longer discovered are kept but flagged `stale`;
 *   - the shared bucket unions across runs.
 * A cross-platform or cross-suite baseline never merges — it is reported
 * and the run's tree stands alone (the caller falls back conservatively).
 */
export function mergeTrees(
	run: ExecCoverageTree,
	baseline: ExecCoverageTree | null,
	options: { discoveredIds?: string[] } = {},
): { tree: ExecCoverageTree; warnings: string[] } {
	const warnings: string[] = [];
	if (baseline === null) return { tree: run, warnings };
	const incompatible = validateExecTree(baseline, {
		suite: run.suite,
		platform: run.platform,
	});
	if (incompatible !== null) {
		warnings.push(`baseline ignored: ${incompatible}`);
		return { tree: run, warnings };
	}

	const discovered = new Set(options.discoveredIds ?? []);
	const isStale = (id: string): boolean => discovered.size > 0 && !discovered.has(id);
	const tests: Record<string, ExecCoverageTest> = { ...run.tests };
	for (const [id, entry] of Object.entries(baseline.tests)) {
		const current = tests[id];
		if (current !== undefined && current.measured) continue; // fresh evidence wins
		// A void run entry never overwrites measured baseline evidence.
		const merged: ExecCoverageTest = { ...entry, measured: false };
		delete merged.stale;
		if (isStale(id)) merged.stale = true;
		tests[id] = merged;
	}

	const sharedBaseline = baseline.shared ?? { reasons: [], nodes: [], files: [] };
	const shared = {
		reasons: sortedStrings(new Set([...sharedBaseline.reasons, ...run.shared.reasons])),
		nodes: sortedStrings(new Set([...sharedBaseline.nodes, ...run.shared.nodes])),
		files: sortedStrings(new Set([...sharedBaseline.files, ...run.shared.files])),
	};

	// Node definitions union across both trees, pruned to referenced ids plus
	// the containment chain (type parents, then their file parents).
	const nodes: Record<string, CoveredNode> = {};
	const referenced = new Set<string>(shared.nodes);
	for (const entry of Object.values(tests)) for (const id of entry.nodes) referenced.add(id);
	const take = (id: string): CoveredNode | undefined => run.nodes[id] ?? baseline.nodes[id];
	for (const id of [...referenced].sort()) {
		const node = take(id);
		if (node !== undefined) nodes[id] = node;
	}
	for (const id of [...referenced].sort()) {
		for (const parent of nodes[id]?.parents ?? []) {
			const node = take(parent);
			if (node !== undefined) {
				nodes[parent] = nodes[parent] ?? node;
				for (const fileParent of node.parents ?? []) {
					const fileNode = take(fileParent);
					if (fileNode !== undefined) nodes[fileParent] = nodes[fileParent] ?? fileNode;
				}
			}
		}
	}

	const modules = [...run.modules];
	for (const module of baseline.modules ?? []) {
		if (!modules.some((entry) => entry.name === module.name && entry.hash === module.hash)) {
			modules.push(module);
		}
	}
	modules.sort((a, b) => a.name.localeCompare(b.name));

	return {
		tree: {
			...run,
			modules,
			nodes,
			tests: Object.fromEntries(
				Object.entries(tests).sort(([a], [b]) => a.localeCompare(b)),
			),
			shared,
			unmatchedEvidence: sortedStrings(
				new Set([...(baseline.unmatchedEvidence ?? []), ...run.unmatchedEvidence]),
			),
			diagnostics: {
				...run.diagnostics,
				mergedFromBaseline: baseline.snapshotSha,
				...(warnings.length > 0 ? { mergeWarnings: warnings.sort() } : {}),
			},
		},
		warnings,
	};
}
