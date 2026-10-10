/**
 * Collector for the Appium suites (#2085): turns per-scenario evidence
 * recorded by the C# harness into a platform coverage tree.
 *
 * Evidence: `coverage-evidence/*.json` inside the run's artifacts directory,
 * written by `CoverageEvidence` in `app/BibleOnSite.Tests.MobileE2E` — each
 * record lists the automation ids a test queried through its driver and the
 * Appium session ids attributed to it.
 *
 * The collector resolves automation ids to the app source files declaring
 * them (XAML `AutomationId="X"`, C# `AutomationId = "X"` including
 * interpolated `$"Prefix{n}"` forms, and `SetAutomationId` calls), groups
 * files into logical units (`X.xaml` + `X.xaml.cs` + verified `X.*.cs`
 * partials), and emits the deterministic tree consumed by `select`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { globMatcher } from "./glob.ts";
import { stripExtension } from "./select.ts";
import { listFiles, discoverSuiteTests } from "./xunit-discovery.ts";
import { SCHEMA_VERSION, type CoverageTree, type SuiteRules } from "./model.ts";

export interface EvidenceRecord {
	test: string;
	platform?: string;
	outcome?: string;
	sessions?: string[];
	automationIds?: string[];
	startedUtc?: string;
	endedUtc?: string;
}

interface IdPattern {
	/** `literal` for exact ids, `wildcard` for `Prefix{...}` interpolations. */
	kind: "literal" | "wildcard";
	pattern: string;
	regex: RegExp;
	file: string;
}

const XAML_ID = /\bAutomationId="([^"]+)"/g;
const CSHARP_ID = /\bAutomationId\s*=\s*(\$?)"([^"]+)"/g;
const SET_ID = /SetAutomationId\s*\(\s*[^,]+,\s*"([^"]+)"\s*\)/g;
const PARTIAL_CLASS = (name: string) =>
	new RegExp(`\\bpartial\\s+class\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

/** Scans app sources for automation-id declarations. */
export function scanAutomationIds(
	files: { path: string; content: string }[],
): IdPattern[] {
	const patterns: IdPattern[] = [];
	for (const { path, content } of files) {
		const add = (kind: IdPattern["kind"], raw: string) => {
			if (raw.startsWith("{")) return; // bound value — not a stable id
			const pattern = kind === "wildcard" ? raw.replace(/\{[^}]*\}/g, "*") : raw;
			const regex =
				kind === "wildcard"
					? new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
					: new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
			patterns.push({ kind, pattern, regex, file: path });
		};
		for (const match of content.matchAll(XAML_ID)) add("literal", match[1]);
		for (const match of content.matchAll(CSHARP_ID)) {
			add(match[1] === "$" ? "wildcard" : "literal", match[2]);
		}
		for (const match of content.matchAll(SET_ID)) add("literal", match[1]);
	}
	return patterns;
}

/**
 * Groups scanned source files into logical units. `X.xaml`, `X.xaml.cs` and
 * `X.*.cs` files that declare `partial class X` share unit `dir/X`; every
 * other file is its own unit `dir/File`.
 */
export function computeSourceUnits(
	files: { path: string; content: string }[],
): Record<string, string[]> {
	const stems = new Set(files.map(({ path }) => stripExtension(path)));
	const unitOf = new Map<string, string>();
	for (const { path, content } of files) {
		const stem = stripExtension(path);
		const base = basename(stem);
		const dot = base.indexOf(".");
		let unit = stem;
		if (dot > 0 && !path.endsWith(".xaml.cs")) {
			const dir = stem.includes("/") ? `${stem.slice(0, stem.lastIndexOf("/"))}/` : "";
			const parent = `${dir}${base.slice(0, dot)}`;
			if (stems.has(parent) && PARTIAL_CLASS(base.slice(0, dot)).test(content)) {
				unit = parent;
			}
		}
		unitOf.set(path, unit);
	}
	const units: Record<string, string[]> = {};
	for (const [file, unit] of unitOf) {
		units[unit] = [...(units[unit] ?? []), file].sort();
	}
	return Object.fromEntries(Object.entries(units).sort(([a], [b]) => a.localeCompare(b)));
}

/** Loads every evidence record in an artifacts `coverage-evidence` directory. */
export function loadEvidence(dir: string): EvidenceRecord[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.flatMap((name) => {
			try {
				return [JSON.parse(readFileSync(join(dir, name), "utf8")) as EvidenceRecord];
			} catch (error) {
				throw new Error(`Corrupt evidence file ${name}: ${String(error)}`);
			}
		});
}

export interface CollectOptions {
	repoRoot: string;
	rules: SuiteRules;
	platform: string;
	artifactsDir: string;
	snapshotSha: string;
	/** Mark false when the test run did not finish — evidence stays partial. */
	complete: boolean;
}

export function collectTree(options: CollectOptions): CoverageTree {
	const { repoRoot, rules, platform } = options;
	const sourceRoot = join(repoRoot, rules.sources.root);
	const sourceMatches = globMatcher(rules.sources.globs);
	const sourceFiles = listFiles(sourceRoot, "**/*")
		.filter((file) =>
			sourceMatches(relative(sourceRoot, file).replaceAll("\\", "/")),
		)
		.map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
		.sort();
	const sources = sourceFiles.map((file) => ({
		path: file,
		content: readFileSync(join(repoRoot, file), "utf8"),
	}));

	const idIndex = scanAutomationIds(sources);
	const sourceUnits = computeSourceUnits(sources);
	const discovered = discoverSuiteTests(
		repoRoot,
		rules.tests.root,
		rules.tests.glob,
		rules.tests.category,
	);
	const fileByTest = new Map(discovered.map((test) => [test.id, test.file]));

	const matchId = (id: string) =>
		idIndex.filter((entry) => entry.regex.test(id)).map((entry) => entry.file);

	const tests: CoverageTree["tests"] = {};
	const unmatchedEvidence: string[] = [];
	for (const record of loadEvidence(join(options.artifactsDir, "coverage-evidence"))) {
		const ids = [...new Set(record.automationIds ?? [])].sort();
		const files = new Set<string>();
		const unmapped: string[] = [];
		for (const id of ids) {
			const mapped = matchId(id);
			if (mapped.length === 0) unmapped.push(id);
			for (const file of mapped) files.add(file);
		}
		if (fileByTest.get(record.test) === undefined) unmatchedEvidence.push(record.test);
		tests[record.test] = {
			...(fileByTest.has(record.test) ? { file: fileByTest.get(record.test) } : {}),
			files: [...files].sort(),
			automationIds: ids,
			unmappedIds: unmapped.sort(),
			sessions: [...new Set(record.sessions ?? [])].sort(),
			outcome: record.outcome ?? "unknown",
		};
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		suite: rules.suite,
		platform,
		snapshotSha: options.snapshotSha,
		collectorVersion: rules.collectorVersion,
		collectedAtUtc: new Date().toISOString(),
		complete: options.complete,
		sourceUnits,
		sourceFiles,
		tests: Object.fromEntries(
			Object.entries(tests).sort(([a], [b]) => a.localeCompare(b)),
		),
		...(unmatchedEvidence.length > 0
			? { unmatchedEvidence: unmatchedEvidence.sort() }
			: {}),
	};
}

export function writeTree(tree: CoverageTree, outPath: string): void {
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(tree, null, 2)}\n`);
}
