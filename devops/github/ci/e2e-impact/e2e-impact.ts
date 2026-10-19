/**
 * Deterministic E2E test impact selection — CLI (#2085).
 *
 *   node e2e-impact.ts discover --suite <dir> --platform <key>
 *   node e2e-impact.ts select  --suite <dir> --platform <key> --tested-sha <sha>
 *       --out <manifest.json> [--baseline <tree.json>]
 *       [--changed-file <list> | --base <sha> --head <sha> | --compare]
 *       [--force-full] [--ancestor-status <status>] [--allow-empty]
 *   node e2e-impact.ts plan --suite <dir> --platform <key>
 *       --manifest <manifest.json> --tested-sha <sha> --out <plan.json>
 *       --shard-dir <dir> --mode <shadow|enforce> [--history <tree.json>]
 *       [--max-shards <n>] [--target-minutes <m>] [--fallback-seconds <s>]
 *   node e2e-impact.ts collect-appium --suite <dir> --platform <key>
 *       --artifacts <dir> --snapshot-sha <sha> --out <tree.json> [--incomplete]
 *       [--exec-tree <exec-coverage-tree.json>] [--history <tree.json>]
 *       [--overhead-ms <n>]
 *   node e2e-impact.ts collect-playwright --suite <dir> --platform <key>
 *       --artifacts <e2e-impact evidence dir> --snapshot-sha <sha>
 *       --out <tree.json> [--incomplete]
 *   node e2e-impact.ts baseline-download --repo <owner/name> --name <artifact>
 *       --out <dir> [--file coverage-tree.json]
 *   node e2e-impact.ts verify --manifest <selection-manifest.json>
 *       --tree <coverage-tree.json> --out <verify.json>
 *
 * `verify` scores a shadow-mode selection against the outcomes the same run
 * actually observed: an unselected test that failed is a parity miss — the
 * evidence the rollout gate needs before enforcement (#2085). Inputs that
 * cannot be joined produce a problem report rather than a verdict, so the
 * diagnostics step never gates a run.

 * `select` emits a deterministic manifest (same inputs → same output) and, in
 * CI, also appends a markdown summary. Selection is advisory: the workflow
 * decides whether the manifest is consumed (enforcement) or only reported
 * (shadow mode, the rollout default).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	execSelectorView,
	execTreeCompatible,
	loadExecTree,
} from "../../../e2e-coverage-trees/to-selector-tree.ts";
import type { ExecCoverageTree } from "../../../e2e-coverage-trees/model.ts";
import { collectTree, writeTree } from "./collect-appium.ts";
import { collectPlaywrightTree } from "./collect-playwright.ts";
import { fingerprintSource, type SourceFingerprint } from "./fingerprint.ts";
import { compareRevisions, downloadArtifact, findArtifact } from "./github.ts";
import {
	canonicalize,
	loadBaselineTree,
	loadRules,
	SCHEMA_VERSION,
	type ChangedFile,
	type CoverageTree,
	type DiscoveredTest,
	type SuiteRules,
} from "./model.ts";
import { discoverPlaywrightTests } from "./playwright-discovery.ts";
import {
	applicableTests,
	repoFileReader,
	selectTests,
	type Baseline,
	type SelectionManifest,
} from "./select.ts";
import {
	buildPlan,
	DEFAULT_FALLBACK_MS,
	DEFAULT_MAX_SHARDS,
	DEFAULT_SETUP_MS,
	DEFAULT_TARGET_MS,
	shardManifest,
} from "./shard-plan.ts";
import { loadVerifyJson, verifyProblem, verifySelection } from "./verify.ts";
import { discoverSuiteTests } from "./xunit-discovery.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
	const [command, ...rest] = argv;
	const flags = new Map<string, string>();
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
		const eq = arg.indexOf("=");
		if (eq !== -1) {
			flags.set(arg.slice(2, eq), arg.slice(eq + 1));
		} else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
			flags.set(arg.slice(2), rest[++i]);
		} else {
			flags.set(arg.slice(2), "true");
		}
	}
	return { command: command ?? "", flags };
}

const required = (flags: Map<string, string>, name: string): string => {
	const value = flags.get(name);
	if (value === undefined) throw new Error(`Missing required --${name}`);
	return value;
};

const git = (args: string[]): string =>
	execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

interface DiffResolution {
	changedFiles: ChangedFile[] | null;
	/** Set when the baseline cannot be trusted for this comparison. */
	problem: Baseline | null;
}

const STATUS_OF: Record<string, ChangedFile["status"]> = {
	A: "added",
	M: "modified",
	D: "deleted",
	R: "renamed",
};

function gitDiffFiles(base: string, head: string): ChangedFile[] {
	return git(["diff", "--name-status", "-z", base, head])
		.split("\0")
		.filter((entry) => entry.length > 0)
		.flatMap((entry) => {
			const [status, ...paths] = entry.split("\t");
			const kind = status[0];
			const files: ChangedFile[] = kind === "R"
				? [{ path: paths[1], status: "renamed", previousPath: paths[0] }]
				: [{ path: paths[0], status: STATUS_OF[kind] ?? "modified" }];
			return files;
		});
}

function gitAncestorStatus(base: string, head: string): "ancestor" | "not-ancestor" | "unknown" {
	try {
		execFileSync("git", ["merge-base", "--is-ancestor", base, head], { cwd: REPO_ROOT });
		return "ancestor";
	} catch (error) {
		if ((error as { status?: number }).status === 1) return "not-ancestor";
		return "unknown";
	}
}

/** Resolves the diff against the baseline snapshot through one of the modes. */
async function resolveDiff(
	flags: Map<string, string>,
	snapshotSha: string,
	testedSha: string,
): Promise<DiffResolution> {
	const changedFile = flags.get("changed-file");
	const base = flags.get("base");
	const head = flags.get("head") ?? testedSha;
	const compare = flags.has("compare");
	const ancestorOverride = flags.get("ancestor-status");

	if (changedFile !== undefined) {
		const files: ChangedFile[] = readFileSync(changedFile, "utf8")
			.split(/\r?\n/)
			.filter((line) => line.trim().length > 0)
			.map((path) => ({ path: path.trim(), status: "modified" }));
		return { changedFiles: files, problem: null };
	}
	if (base !== undefined) {
		const ancestor =
			(ancestorOverride as "ancestor" | "not-ancestor" | "unknown" | undefined) ??
			gitAncestorStatus(base, head);
		return {
			changedFiles: ancestor === "not-ancestor" ? [] : gitDiffFiles(base, head),
			problem:
				ancestor === "not-ancestor"
					? { kind: "not-ancestor", reason: `${base} is not an ancestor of ${head}` }
					: ancestor === "unknown"
						? { kind: "unknown", reason: "merge-base unavailable (shallow history?)" }
						: null,
		};
	}
	if (compare) {
		const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
		const repo = flags.get("repo") ?? process.env.GITHUB_REPOSITORY;
		if (!token || !repo) {
			return {
				changedFiles: null,
				problem: { kind: "unknown", reason: "compare needs GH_TOKEN and GITHUB_REPOSITORY" },
			};
		}
		try {
			const result = await compareRevisions(repo, snapshotSha, head, token);
			if (result.status === "identical") {
				return { changedFiles: [], problem: null };
			}
			if (result.status === "diverged" || result.status === "behind") {
				return {
					changedFiles: [],
					problem: {
						kind: "not-ancestor",
						reason: `snapshot ${snapshotSha} ${result.status} from ${head}`,
					},
				};
			}
			return {
				changedFiles: result.truncated ? null : result.files,
				problem: result.truncated
					? { kind: "unknown", reason: "compare diff truncated at 300 files" }
					: null,
			};
		} catch (error) {
			return {
				changedFiles: null,
				problem: { kind: "unknown", reason: `compare failed: ${String(error)}` },
			};
		}
	}
	return {
		changedFiles: null,
		problem: { kind: "unknown", reason: "no diff mode selected" },
	};
}

function writeGithubOutput(name: string, value: string): void {
	const output = process.env.GITHUB_OUTPUT;
	if (output) appendFileSync(output, `${name}=${value}\n`);
}

function appendSummary(markdown: string): void {
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary) appendFileSync(summary, `${markdown}\n`);
}

/** Framework-dispatched static test discovery for a suite's rules. */
function discoverFor(rules: SuiteRules): {
	tests: DiscoveredTest[];
	dynamicFiles: string[];
} {
	if (rules.tests.framework === "playwright") {
		return discoverPlaywrightTests(
			REPO_ROOT,
			rules.tests.root,
			rules.tests.glob,
			rules.tests.testDir,
		);
	}
	return {
		tests: discoverSuiteTests(
			REPO_ROOT,
			rules.tests.root,
			rules.tests.glob,
			rules.tests.category ?? "",
		),
		dynamicFiles: [],
	};
}

async function select(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const testedSha = required(flags, "tested-sha");
	const out = required(flags, "out");
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));

	const discovery = discoverFor(rules);
	const discovered = discovery.tests;
	const candidates = applicableTests(discovered, platform);

	const baselinePath = flags.get("baseline");
	const loaded =
		baselinePath === undefined
			? { kind: "missing" as const, reason: "no --baseline path provided" }
			: loadBaselineTree(baselinePath);

	let baseline: Baseline;
	let changedFiles: ChangedFile[] | null;
	if (loaded.kind !== "ok") {
		baseline = { kind: loaded.kind, reason: loaded.reason };
		changedFiles = [];
	} else {
		const diff = await resolveDiff(flags, loaded.tree.snapshotSha, testedSha);
		baseline = diff.problem ?? { kind: "ok", tree: loaded.tree };
		changedFiles = diff.changedFiles;
	}

	// Structural fingerprints of modified files at the tested revision —
	// compared against baseline-persisted fingerprints to prove trivia-only
	// edits. Unreadable/unparseable files map to `null` (treated as changed).
	const currentFingerprints = new Map<string, SourceFingerprint | null>();
	if (changedFiles !== null) {
		for (const change of changedFiles) {
			if (change.status !== "modified") continue;
			let fp: SourceFingerprint | null = null;
			try {
				fp = fingerprintSource(
					change.path,
					readFileSync(join(REPO_ROOT, change.path), "utf8"),
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			currentFingerprints.set(change.path, fp);
		}
	}

	const manifest = selectTests({
		rules,
		baseline,
		changedFiles,
		discovered,
		platform,
		testedSha,
		forceFull: flags.has("force-full") || process.env.FORCE_FULL_SUITE === "true",
		allowEmpty: flags.has("allow-empty"),
		readFile: repoFileReader(REPO_ROOT),
		currentFingerprints,
		dynamicTestFiles: new Set(discovery.dynamicFiles),
	});

	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

	const selectedSet = new Set(manifest.selected.map((entry) => entry.id));
	const wouldRun = manifest.selectAll
		? candidates.map((test) => test.id)
		: manifest.selected.map((entry) => entry.id);
	const wouldSkip = candidates
		.map((test) => test.id)
		.filter((id) => !selectedSet.has(id) && !manifest.selectAll);
	console.log(
		`[e2e-impact] ${manifest.mode.toUpperCase()} ${manifest.suite}/${platform}: ` +
			`${wouldRun.length} of ${candidates.length} tests selected ` +
			`(snapshot ${manifest.snapshotSha ?? "none"}, fallbacks: ${manifest.fallbacks.join(", ") || "none"})`,
	);
	writeGithubOutput("select-all", String(manifest.selectAll));
	writeGithubOutput("selected-count", String(wouldRun.length));
	writeGithubOutput("skipped-count", String(wouldSkip.length));
	writeGithubOutput("manifest", out);

	const rows = manifest.selected
		.slice(0, 50)
		.map((entry) => `| \`${entry.id}\` | ${entry.reasons.join("<br>")} |`);
	appendSummary(
		[
			`### E2E impact selection — ${manifest.suite} (${platform}) — ${manifest.mode} mode`,
			``,
			`- snapshot: \`${manifest.snapshotSha ?? "none"}\``,
			`- tested: \`${manifest.testedSha}\``,
			`- selected: **${wouldRun.length}** / ${candidates.length} tests${manifest.selectAll ? " (full suite)" : ""}`,
			`- fallbacks: ${manifest.fallbacks.join(", ") || "none"}`,
			`- changed files: ${manifest.changedFiles.length}`,
			`- structurally unchanged (trivia-only): ${manifest.unchangedStructural.length}`,
			``,
			...(rows.length > 0
				? ["| selected test | reasons |", "| --- | --- |", ...rows]
				: []),
		].join("\n"),
	);
}

const intFlag = (flags: Map<string, string>, name: string, fallback: number): number => {
	const raw = flags.get(name);
	if (raw === undefined) return fallback;
	const value = Number.parseFloat(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`--${name} must be a positive number, got '${raw}'`);
	}
	return value;
};

/**
 * Turns a selection manifest into a bounded, runtime-balanced shard plan
 * (#2263). Planning runs once before the matrix expands; every shard then
 * executes the manifest it was assigned rather than re-selecting. History
 * is advisory — a missing or corrupt baseline yields fallback weights —
 * while an inconsistent manifest fails the job outright: planning errors
 * must never degrade into a silently green run.
 */
async function plan(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const manifestPath = required(flags, "manifest");
	const out = required(flags, "out");
	const shardDir = required(flags, "shard-dir");
	const mode = flags.get("mode") ?? "shadow";
	if (mode !== "shadow" && mode !== "enforce") {
		throw new Error(`--mode must be shadow|enforce, got '${mode}'`);
	}
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SelectionManifest;
	if (manifest.suite !== rules.suite || manifest.platform !== platform) {
		throw new Error(
			`Manifest ${manifestPath} is for ${manifest.suite}/${manifest.platform}, ` +
				`not ${rules.suite}/${platform}.`,
		);
	}
	if (manifest.testedSha !== required(flags, "tested-sha")) {
		throw new Error(`Manifest tested SHA does not match --tested-sha.`);
	}
	// The manifest must enumerate the suite discovered at this revision —
	// a stale or hand-edited manifest would partition a different run set
	// than the runner can execute.
	const discovered = applicableTests(discoverFor(rules).tests, platform)
		.map((test) => test.id)
		.sort();
	const manifestIds = [
		...manifest.selected.map((entry) => entry.id),
		...manifest.unselected.map((entry) => entry.id),
	].sort();
	if (canonicalize(manifestIds) !== canonicalize(discovered)) {
		throw new Error(
			`Manifest does not cover the discovered ${platform} suite ` +
				`(${manifestIds.length} manifest ids vs ${discovered.length} discovered).`,
		);
	}
	// Timing influences scheduling only: enforce runs the selected set,
	// shadow always the full applicable suite — never a narrowed membership.
	const runSet =
		mode === "enforce" ? manifest.selected.map((entry) => entry.id) : manifestIds;

	const historyPath = flags.get("history");
	let history: CoverageTree | undefined;
	if (historyPath !== undefined) {
		const loaded = loadBaselineTree(historyPath);
		if (loaded.kind === "ok") {
			history = loaded.tree;
		} else {
			console.warn(`[e2e-impact] timing history ignored: ${loaded.reason}`);
		}
	}
	const fallbackMs = intFlag(flags, "fallback-seconds", DEFAULT_FALLBACK_MS / 1000) * 1000;
	// A schema-valid baseline could still carry a malformed timing entry;
	// anything that is not a positive finite mean reads as unmeasured.
	const estimates = runSet.map((id) => {
		const meanMs = history?.tests[id]?.timing?.meanMs;
		const measured = typeof meanMs === "number" && Number.isFinite(meanMs) && meanMs > 0;
		return { id, estimatedMs: measured ? meanMs : fallbackMs, measured };
	});
	const overheadMeanMs = history?.overhead?.meanMs;
	const config = {
		maxShards: Math.floor(intFlag(flags, "max-shards", DEFAULT_MAX_SHARDS)),
		targetMs: intFlag(flags, "target-minutes", DEFAULT_TARGET_MS / 60_000) * 60_000,
		// Job bring-up (caches, workload, app build, sim boot) plus the measured
		// in-pilot non-case time — the price of one more shard.
		setupMs:
			DEFAULT_SETUP_MS +
			(typeof overheadMeanMs === "number" && Number.isFinite(overheadMeanMs) && overheadMeanMs > 0
				? overheadMeanMs
				: 0),
		fallbackMs,
	};
	const result = buildPlan({
		suite: rules.suite,
		platform,
		mode,
		testedSha: manifest.testedSha,
		snapshotSha: manifest.snapshotSha,
		runSet,
		estimates,
		config,
	});
	mkdirSync(shardDir, { recursive: true });
	mkdirSync(dirname(out), { recursive: true });
	const reasons = new Map(
		manifest.selected.map((entry) => [entry.id, entry.reasons] as const),
	);
	for (const shard of result.shards) {
		writeFileSync(
			join(shardDir, `shard-${shard.shard}.json`),
			`${JSON.stringify(shardManifest(result, shard, reasons), null, 2)}\n`,
		);
	}
	writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
	writeGithubOutput("shards", String(result.shards.length));
	writeGithubOutput(
		"estimated-minutes",
		String(Math.ceil(result.totals.makespanMs / 60_000)),
	);
	writeGithubOutput("plan", out);
	console.log(
		`[e2e-impact] ${platform} plan (${mode}): ${runSet.length} cases over ` +
			`${result.shards.length} shard(s), est. makespan ` +
			`${Math.round(result.totals.makespanMs / 60_000)}min ` +
			`(${result.totals.unmeasuredIds.length} unmeasured)`,
	);
	appendSummary(
		[
			`### iOS shard plan — ${mode} mode`,
			``,
			`- cases: **${runSet.length}** over **${result.shards.length}** shard(s)`,
			`- estimated case time: ${(result.totals.caseMs / 60_000).toFixed(1)}min, makespan ~${Math.ceil(result.totals.makespanMs / 60_000)}min`,
			`- unmeasured cases (fallback ${config.fallbackMs / 1000}s): ${result.totals.unmeasuredIds.length}`,
			``,
			...(result.shards.length > 0
				? [
						"| shard | cases | estimated |",
						"| --- | --- | --- |",
						...result.shards.map(
							(shard) =>
								`| ${shard.shard} | ${shard.tests.length} | ${(shard.estimatedMs / 60_000).toFixed(1)}min |`,
						),
					]
				: []),
		].join("\n"),
	);
}

async function collectAppium(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const artifacts = required(flags, "artifacts");
	const snapshotSha = required(flags, "snapshot-sha");
	const out = required(flags, "out");
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));
	// The exec channel is optional: a missing, corrupt or mismatched tree is
	// diagnosed and the automation-id collection proceeds untouched — exec
	// evidence may widen the selection surface, never shrink it.
	let execTree: ExecCoverageTree | undefined;
	const execTreePath = flags.get("exec-tree");
	if (execTreePath !== undefined) {
		const loaded = loadExecTree(execTreePath);
		if (loaded.kind !== "ok") {
			console.warn(`[e2e-impact] exec tree ignored: ${loaded.reason}`);
		} else {
			const problem = execTreeCompatible(loaded.tree, {
				suite: rules.suite,
				platform,
				snapshotSha,
			});
			if (problem !== null) {
				console.warn(`[e2e-impact] exec tree ${execTreePath} ignored: ${problem}`);
			} else {
				execTree = loaded.tree;
				const view = execSelectorView(execTree);
				console.log(
					`[e2e-impact] exec tree: ${Object.keys(view.tests).length} per-test entries, ` +
						`${view.sharedFiles.length} shared files`,
				);
			}
		}
	}
	// Timing history (#2263): the platform's published baseline carries the
	// rolling per-case means this run updates. Mismatched/absent history is
	// ignored — it refines scheduling metadata, never the evidence itself.
	let history: CoverageTree | undefined;
	const historyPath = flags.get("history");
	if (historyPath !== undefined) {
		const loaded = loadBaselineTree(historyPath);
		if (
			loaded.kind === "ok" &&
			loaded.tree.suite === rules.suite &&
			loaded.tree.platform === platform &&
			loaded.tree.schemaVersion === SCHEMA_VERSION
		) {
			history = loaded.tree;
		} else {
			console.warn(
				`[e2e-impact] timing history ignored: ` +
					(loaded.kind === "ok" ? "suite/platform mismatch" : loaded.reason),
			);
		}
	}
	const tree = collectTree({
		repoRoot: REPO_ROOT,
		rules,
		platform,
		artifactsDir: artifacts,
		snapshotSha,
		complete: !flags.has("incomplete"),
		execTree,
		history,
		overheadMs: flags.has("overhead-ms")
			? Number.parseFloat(required(flags, "overhead-ms"))
			: undefined,
	});
	writeTree(tree, out);
	const count = Object.keys(tree.tests).length;
	console.log(
		`[e2e-impact] collected ${count} test evidence entr${count === 1 ? "y" : "ies"} ` +
			`for ${rules.suite}/${platform} (complete=${tree.complete}) → ${out}`,
	);
	writeGithubOutput("coverage-tree", out);
	writeGithubOutput("evidence-tests", String(count));
}

async function baselineDownload(flags: Map<string, string>): Promise<void> {
	const repo = flags.get("repo") ?? process.env.GITHUB_REPOSITORY;
	const name = required(flags, "name");
	const out = required(flags, "out");
	const file = flags.get("file") ?? "coverage-tree.json";
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	if (!repo) throw new Error("Set --repo or GITHUB_REPOSITORY");
	if (!token) throw new Error("Set GH_TOKEN or GITHUB_TOKEN");

	const artifact = await findArtifact(repo, name, token);
	if (artifact === null) {
		console.log(`[e2e-impact] baseline artifact ${name} not found`);
		writeGithubOutput("available", "false");
		return;
	}
	const extracted = await downloadArtifact(repo, artifact, token, out);
	console.log(
		`[e2e-impact] baseline ${name} (artifact ${artifact.id}, ${artifact.createdAt}) → ${extracted.join(", ")}`,
	);
	writeGithubOutput("available", "true");
	const treePath = join(out, file);
	writeGithubOutput("baseline-file", treePath);
	if (existsSync(treePath)) {
		try {
			const tree = JSON.parse(readFileSync(treePath, "utf8")) as { snapshotSha?: string };
			if (tree.snapshotSha) writeGithubOutput("snapshot-sha", tree.snapshotSha);
		} catch (error) {
			console.log(`[e2e-impact] baseline tree unreadable: ${String(error)}`);
		}
	}
}

async function collectPlaywright(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const artifacts = required(flags, "artifacts");
	const snapshotSha = required(flags, "snapshot-sha");
	const out = required(flags, "out");
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));
	const tree = collectPlaywrightTree({
		repoRoot: REPO_ROOT,
		rules,
		platform,
		artifactsDir: artifacts,
		snapshotSha,
		complete: !flags.has("incomplete"),
	});
	writeTree(tree, out);
	const count = Object.keys(tree.tests).length;
	const unattributed = Object.values(tree.tests).filter(
		(test) => test.unattributed === true,
	).length;
	console.log(
		`[e2e-impact] collected ${count} test evidence entr${count === 1 ? "y" : "ies"} ` +
			`(${unattributed} unattributed, complete=${tree.complete}) ` +
			`for ${rules.suite}/${platform} → ${out}`,
	);
	writeGithubOutput("coverage-tree", out);
	writeGithubOutput("evidence-tests", String(count));
}

async function discover(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));
	const discovery = discoverFor(rules);
	const tests = applicableTests(discovery.tests, platform);
	for (const test of tests) console.log(`${test.id}  [${test.platform}]  ${test.file}`);
	for (const file of discovery.dynamicFiles) console.log(`dynamic: ${file}`);
	writeGithubOutput("test-count", String(tests.length));
}

/**
 * `verify` joins a selection manifest against the coverage tree the same run
 * collected — the shadow-mode parity score the rollout gate consumes (#2085).
 * Load or shape problems produce a `problem` report, never a thrown error:
 * this step is pure diagnostics and must not gate the job.
 */
async function verify(flags: Map<string, string>): Promise<void> {
	const manifestPath = required(flags, "manifest");
	const treePath = required(flags, "tree");
	const out = required(flags, "out");

	const loadedManifest = loadVerifyJson(manifestPath);
	const loadedTree = loadVerifyJson(treePath);
	const manifest =
		loadedManifest.kind === "ok"
			? (loadedManifest.value as SelectionManifest)
			: null;
	const tree =
		loadedTree.kind === "ok" ? (loadedTree.value as CoverageTree) : null;

	let problem: string | null = null;
	if (loadedManifest.kind !== "ok") {
		problem = `manifest-${loadedManifest.kind}: ${loadedManifest.reason}`;
	} else if (
		!Array.isArray(manifest?.selected) ||
		!Array.isArray(manifest?.unselected)
	) {
		problem = "manifest-shape: selected/unselected lists are absent";
	}
	if (problem === null && loadedTree.kind !== "ok") {
		problem = `tree-${loadedTree.kind}: ${loadedTree.reason}`;
	} else if (
		problem === null &&
		(tree === null || typeof tree.tests !== "object" || tree.tests === null)
	) {
		problem = "tree-shape: tests map is absent";
	}

	const report =
		problem !== null
			? verifyProblem(problem, manifest, tree)
			: verifySelection(manifest as SelectionManifest, tree as CoverageTree);

	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

	if (report.problem !== null) {
		console.log(`[e2e-impact] verify ${report.suite}/${report.platform}: ${report.problem}`);
	} else {
		const { counts } = report;
		console.log(
			`[e2e-impact] verify ${report.suite}/${report.platform}: ` +
				`${counts.selected} selected (${counts.caught} caught), ` +
				`${counts.unselected} unselected — ${counts.missed} missed, ` +
				`${counts.flakyMissed} flaky-missed, ${counts.unobserved} unobserved`,
		);
		if (counts.missed > 0) {
			console.log(
				`::warning::e2e-impact parity: ${counts.missed} unselected test(s) ` +
					`failed — ${report.missed.join(", ")}`,
			);
		}
	}
	writeGithubOutput("verify-report", out);
	writeGithubOutput("missed-count", String(report.counts.missed));
	appendSummary(
		[
			`### E2E impact shadow parity — ${report.suite} (${report.platform})`,
			``,
			...(report.problem !== null
				? [`- problem: \`${report.problem}\``]
				: [
						`- mode: **${report.mode}** — ${report.counts.selected} selected, ${report.counts.unselected} unselected`,
						`- missed failures: **${report.counts.missed}**${report.missed.length > 0 ? ` — ${report.missed.map((id) => `\`${id}\``).join(", ")}` : ""}`,
						`- caught failures: ${report.counts.caught}, flaky-missed: ${report.counts.flakyMissed}, unobserved: ${report.counts.unobserved}`,
					]),
		].join("\n"),
	);
}

async function main(): Promise<void> {
	const { command, flags } = parseArgs(process.argv.slice(2));
	switch (command) {
		case "select":
			return await select(flags);
		case "plan":
			return await plan(flags);
		case "collect-appium":
			return await collectAppium(flags);
		case "collect-playwright":
			return await collectPlaywright(flags);
		case "baseline-download":
			return await baselineDownload(flags);
		case "discover":
			return await discover(flags);
		case "verify":
			return await verify(flags);
		default:
			throw new Error(
				`Unknown command "${command}". Expected select | plan | collect-appium | collect-playwright | baseline-download | discover | verify`,
			);
	}
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`[e2e-impact] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
