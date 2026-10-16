/**
 * Executable per-test coverage-tree extraction — CLI (#2085).
 *
 *   node e2e-coverage-trees.ts extract
 *       --artifacts <dir> --platform <key> --out <tree.json>
 *       [--suite app/mobile-e2e] [--baseline <tree.json>] [--incomplete]
 *       [--template <f>] [--report <f>] [--dumps <dir>] [--evidence <dir>]
 *       [--trx <f>] [--junit <f>] [--manifest <f>]
 *       [--snapshot-sha <sha>] [--configuration <c>] [--collector-version <v>]
 *       [--strip-prefix <p>]...
 *   node e2e-coverage-trees.ts validate
 *       --tree <tree.json> --platform <key> [--suite app/mobile-e2e]
 *
 * `extract` resolves the platform artifacts dir
 * (`app/.artifacts/mobile-e2e/<platform>/` layout — app-coverage/ dumps,
 * coverage-evidence/ records, coverage-app/ OpenCover template + applied
 * report, results/ TRX+JUnit, coverage-app/coverage-manifest.json
 * provenance) into the `exec-coverage-tree` documented in
 * docs/devops/e2e-test-selection.md. Every input path has an explicit flag
 * so the tool also runs against hand-assembled evidence dirs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, type SuiteRules } from "../github/ci/e2e-impact/model.ts";
import { discoverSuiteTests } from "../github/ci/e2e-impact/xunit-discovery.ts";
import {
	loadDumps,
	loadEvidenceRecords,
	loadJunit,
	loadTrx,
	type TestRunRecord,
} from "./evidence.ts";
import { extractTree, mergeTrees } from "./extract.ts";
import { type ExecCoverageTree, validateExecTree } from "./model.ts";
import { type OpenCoverModel, parseOpenCover } from "./opencover.ts";
import { parseXml } from "./xml.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

function parseArgs(argv: string[]): { command: string; flags: Map<string, string>; multi: Map<string, string[]> } {
	const [command, ...rest] = argv;
	const flags = new Map<string, string>();
	const multi = new Map<string, string[]>();
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
		const eq = arg.indexOf("=");
		const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
		let value: string;
		if (eq !== -1) {
			value = arg.slice(eq + 1);
		} else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
			value = rest[++i];
		} else {
			value = "true";
		}
		if (name === "strip-prefix") {
			multi.set(name, [...(multi.get(name) ?? []), value]);
		} else {
			flags.set(name, value);
		}
	}
	return { command: command ?? "", flags, multi };
}

const required = (flags: Map<string, string>, name: string): string => {
	const value = flags.get(name);
	if (value === undefined) throw new Error(`Missing required --${name}`);
	return value;
};

const existing = (...candidates: (string | undefined)[]): string | undefined =>
	candidates.find((path) => path !== undefined && existsSync(path));

function loadOpenCover(path: string | undefined): OpenCoverModel | null {
	if (path === undefined) return null;
	return parseOpenCover(parseXml(readFileSync(path, "utf8")));
}

interface BuildManifest {
	sourceSha?: string;
	collectorVersion?: string;
	configuration?: string;
	platform?: string;
}

function loadManifest(path: string | undefined): BuildManifest {
	if (path === undefined) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as BuildManifest;
	} catch (error) {
		throw new Error(`Coverage manifest ${path} is unreadable: ${String(error)}`);
	}
}

function loadBaseline(path: string): ExecCoverageTree | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ExecCoverageTree;
	} catch (error) {
		console.warn(`[e2e-coverage-trees] baseline ${path} unreadable: ${String(error)}`);
		return null;
	}
}

/**
 * Merges run-record lists given in priority order — the first writer wins
 * each field, theory case ids union across sources.
 */
function mergeRunRecords(lists: TestRunRecord[][]): TestRunRecord[] {
	const byId = new Map<string, TestRunRecord>();
	for (const list of lists) {
		for (const record of list) {
			const existing = byId.get(record.id);
			if (existing === undefined) {
				byId.set(record.id, { ...record, cases: [...record.cases] });
				continue;
			}
			for (const caseId of record.cases) {
				if (!existing.cases.includes(caseId)) existing.cases.push(caseId);
			}
			existing.cases.sort();
		}
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function extract(flags: Map<string, string>, multi: Map<string, string[]>): Promise<void> {
	const platform = required(flags, "platform");
	const out = required(flags, "out");
	const artifacts = flags.get("artifacts");

	let rules: SuiteRules | null = null;
	const suiteDir = flags.get("suite");
	if (suiteDir !== undefined) {
		rules = loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json"));
		if (rules.platforms[platform] === undefined) {
			throw new Error(
				`--platform ${platform} is not one of ${rules.suite}: ${Object.keys(rules.platforms).join(", ")}`,
			);
		}
	}

	const templatePath = existing(
		flags.get("template"),
		artifacts === undefined ? undefined : join(artifacts, "coverage-app", "template.opencover.xml"),
	);
	const reportPath = existing(
		flags.get("report"),
		artifacts === undefined ? undefined : join(artifacts, "coverage-app", "coverage.opencover.xml"),
	);
	// The applied report is the template superset (same points plus real `vc`
	// values) — prefer it: shared mode draws its covered set from `vc`, and a
	// template-only fallback is the structure-only pre-#2156 shape.
	const cover = loadOpenCover(reportPath) ?? loadOpenCover(templatePath);
	if (cover === null) {
		throw new Error(
			"No OpenCover input: provide --template, --report, or an --artifacts dir with coverage-app/*.opencover.xml",
		);
	}

	const dumpsDir = existing(flags.get("dumps"), artifacts === undefined ? undefined : join(artifacts, "app-coverage"));
	const evidenceDir = existing(flags.get("evidence"), artifacts === undefined ? undefined : join(artifacts, "coverage-evidence"));
	const trxPath = existing(flags.get("trx"), artifacts === undefined ? undefined : join(artifacts, "results", "mobile-e2e.trx"));
	const junitPath = existing(flags.get("junit"), artifacts === undefined ? undefined : join(artifacts, "results", "mobile-e2e.xml"));
	const manifest = loadManifest(
		existing(
			flags.get("manifest"),
			artifacts === undefined ? undefined : join(artifacts, "coverage-app", "coverage-manifest.json"),
			artifacts === undefined ? undefined : join(artifacts, "coverage-app", "coverage-report-manifest.json"),
		),
	);

	const { dumps, errors } = dumpsDir === undefined ? { dumps: [], errors: [] } : loadDumps(dumpsDir);
	const evidence: { byStem: Map<string, TestRunRecord>; records: TestRunRecord[] } =
		evidenceDir === undefined ? { byStem: new Map(), records: [] } : loadEvidenceRecords(evidenceDir);
	const trxRecords = trxPath === undefined ? [] : loadTrx(trxPath);
	const junitRecords = junitPath === undefined ? [] : loadJunit(junitPath);
	const runRecords = mergeRunRecords([evidence.records, trxRecords, junitRecords]);

	const platformTrait = rules?.platforms[platform] ?? platform;
	const discovered = rules === null
		? []
		: discoverSuiteTests(REPO_ROOT, rules.tests.root, rules.tests.glob, rules.tests.category ?? "")
				.filter(
					(test) =>
						test.platform.toLowerCase() === "shared" ||
						test.platform.toLowerCase() === platformTrait.toLowerCase(),
				);
	const fqnByMethod = new Map<string, string>();
	{
		const nameCounts = new Map<string, number>();
		for (const test of discovered) {
			const method = test.id.slice(test.id.lastIndexOf(".") + 1);
			nameCounts.set(method, (nameCounts.get(method) ?? 0) + 1);
		}
		for (const test of discovered) {
			const method = test.id.slice(test.id.lastIndexOf(".") + 1);
			if (nameCounts.get(method) === 1) fqnByMethod.set(method, test.id);
		}
	}

	const snapshotSha = flags.get("snapshot-sha") ?? manifest.sourceSha;
	if (snapshotSha === undefined || snapshotSha === "") {
		throw new Error("No snapshot sha: provide --snapshot-sha or a coverage manifest with sourceSha");
	}
	const sourceRoot = flags.get("source-root") ?? rules?.sources.root ?? "";
	if (sourceRoot === "") {
		throw new Error("No source root for path normalization: provide --source-root or --suite");
	}

	const run = extractTree({
		suite: rules?.suite ?? flags.get("suite-name") ?? "app-mobile-e2e",
		platform,
		configuration: flags.get("configuration") ?? manifest.configuration ?? "Debug",
		snapshotSha,
		collector: "altcover-app-dump",
		collectorVersion: flags.get("collector-version") ?? manifest.collectorVersion ?? "unknown",
		complete: !flags.has("incomplete"),
		cover,
		dumps,
		dumpErrors: errors,
		runRecords,
		recordByStem: evidence.byStem,
		fqnByMethod,
		sourceRoot,
		stripPrefixes: multi.get("strip-prefix") ?? [],
		discoveredIds: discovered.map((test) => test.id),
		// Member granularity (#2085): map method nodes onto source members of
		// the snapshot revision. Missing/unparseable files leave the node
		// unmapped — the selector widens them rather than guesses.
		readSource: (repoPath) => {
			try {
				return readFileSync(join(REPO_ROOT, repoPath), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
	});

	const baselinePath = flags.get("baseline");
	const baseline = baselinePath === undefined ? null : loadBaseline(baselinePath);
	const { tree, warnings } = mergeTrees(run, baseline, {
		discoveredIds: discovered.map((test) => test.id),
	});
	for (const warning of warnings) console.warn(`[e2e-coverage-trees] ${warning}`);

	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(tree, null, 2)}\n`);

	const measured = Object.values(tree.tests).filter((test) => test.measured).length;
	console.log(
		`[e2e-coverage-trees] ${tree.suite}/${tree.platform}: ${measured} measured, ` +
			`${Object.keys(tree.tests).length} entries, ${Object.keys(tree.nodes).length} nodes ` +
			`(attribution ${tree.diagnostics.attribution}, complete=${tree.complete}) → ${out}`,
	);
	const githubOutput = process.env.GITHUB_OUTPUT;
	if (githubOutput) {
		appendFileSync(githubOutput, `exec-coverage-tree=${out}\n`);
		appendFileSync(githubOutput, `attribution=${tree.diagnostics.attribution}\n`);
		appendFileSync(githubOutput, `evidence-tests=${measured}\n`);
	}
}

async function validate(flags: Map<string, string>): Promise<void> {
	const treePath = required(flags, "tree");
	const platform = required(flags, "platform");
	const suiteDir = flags.get("suite");
	const suite =
		suiteDir === undefined
			? flags.get("suite-name") ?? "app-mobile-e2e"
			: loadRules(join(REPO_ROOT, suiteDir, "e2e-impact.json")).suite;
	const problem = validateExecTree(
		JSON.parse(readFileSync(treePath, "utf8")) as ExecCoverageTree,
		{ suite, platform },
	);
	if (problem !== null) {
		console.error(`[e2e-coverage-trees] ${treePath} is incompatible: ${problem}`);
		process.exit(1);
	}
	console.log(`[e2e-coverage-trees] ${treePath} is a valid ${suite}/${platform} tree`);
}

async function main(): Promise<void> {
	const { command, flags, multi } = parseArgs(process.argv.slice(2));
	switch (command) {
		case "extract":
			return await extract(flags, multi);
		case "validate":
			return await validate(flags);
		default:
			throw new Error(`Unknown command "${command}". Expected extract | validate`);
	}
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`[e2e-coverage-trees] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
