/**
 * Deterministic E2E test impact selection — CLI (#2085).
 *
 *   node e2e-impact.ts discover --suite <dir> --platform <key>
 *   node e2e-impact.ts select  --suite <dir> --platform <key> --tested-sha <sha>
 *       --out <manifest.json> [--baseline <tree.json>]
 *       [--changed-file <list> | --base <sha> --head <sha> | --compare]
 *       [--force-full] [--ancestor-status <status>]
 *   node e2e-impact.ts collect-appium --suite <dir> --platform <key>
 *       --artifacts <dir> --snapshot-sha <sha> --out <tree.json> [--incomplete]
 *   node e2e-impact.ts baseline-download --repo <owner/name> --name <artifact>
 *       --out <dir> [--file coverage-tree.json]
 *
 * `select` emits a deterministic manifest (same inputs → same output) and, in
 * CI, also appends a markdown summary. Selection is advisory: the workflow
 * decides whether the manifest is consumed (enforcement) or only reported
 * (shadow mode, the rollout default).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectTree, writeTree } from "./collect-appium.ts";
import { compareRevisions, downloadArtifact, findArtifact } from "./github.ts";
import { loadBaselineTree, loadRules, type ChangedFile } from "./model.ts";
import { applicableTests, repoFileReader, selectTests, type Baseline } from "./select.ts";
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

async function select(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const testedSha = required(flags, "tested-sha");
	const out = required(flags, "out");
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));

	const discovered = discoverSuiteTests(
		REPO_ROOT,
		rules.tests.root,
		rules.tests.glob,
		rules.tests.category,
	);
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

	const manifest = selectTests({
		rules,
		baseline,
		changedFiles,
		discovered,
		platform,
		testedSha,
		forceFull: flags.has("force-full") || process.env.FORCE_FULL_SUITE === "true",
		readFile: repoFileReader(REPO_ROOT),
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
			``,
			...(rows.length > 0
				? ["| selected test | reasons |", "| --- | --- |", ...rows]
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
	const tree = collectTree({
		repoRoot: REPO_ROOT,
		rules,
		platform,
		artifactsDir: artifacts,
		snapshotSha,
		complete: !flags.has("incomplete"),
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

async function discover(flags: Map<string, string>): Promise<void> {
	const suiteDir = required(flags, "suite");
	const platform = required(flags, "platform");
	const rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));
	const tests = applicableTests(
		discoverSuiteTests(REPO_ROOT, rules.tests.root, rules.tests.glob, rules.tests.category),
		platform,
	);
	for (const test of tests) console.log(`${test.id}  [${test.platform}]  ${test.file}`);
	writeGithubOutput("test-count", String(tests.length));
}

async function main(): Promise<void> {
	const { command, flags } = parseArgs(process.argv.slice(2));
	switch (command) {
		case "select":
			return await select(flags);
		case "collect-appium":
			return await collectAppium(flags);
		case "baseline-download":
			return await baselineDownload(flags);
		case "discover":
			return await discover(flags);
		default:
			throw new Error(
				`Unknown command "${command}". Expected select | collect-appium | baseline-download | discover`,
			);
	}
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`[e2e-impact] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
