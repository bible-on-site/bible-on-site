import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { describe, test } from "node:test";

import { matchesGlob } from "./glob.ts";
import {
	canonicalize,
	loadRules,
	SCHEMA_VERSION,
	type ChangedFile,
	type CoverageTree,
	type DiscoveredTest,
	type SuiteRules,
} from "./model.ts";
import {
	applicableTests,
	fileToUnit,
	selectTests,
	stripExtension,
} from "./select.ts";
import {
	collectTree,
	computeSourceUnits,
	loadEvidence,
	scanAutomationIds,
} from "./collect-appium.ts";
import { discoverSuiteTests, parseTestSource } from "./xunit-discovery.ts";
import { extractZip } from "./github.ts";
import { fingerprintSource } from "./fingerprint.ts";
import type {
	ExecCoverageTest,
	ExecCoverageTree,
} from "../../../e2e-coverage-trees/model.ts";

// ── Fixtures ────────────────────────────────────────────────────────────

const RULES: SuiteRules = {
	schemaVersion: 1,
	suite: "app-mobile-e2e",
	collector: "appium-automation-id",
	collectorVersion: "1.0.0",
	platforms: { android: "Android", ios: "iOS" },
	tests: {
		root: "app/BibleOnSite.Tests.MobileE2E",
		glob: "**/*Tests.cs",
		framework: "csharp-xunit",
		category: "MobileE2E",
	},
	sources: { root: "app/BibleOnSite", globs: ["**/*.xaml", "**/*.cs"] },
	alwaysRun: ["Suite.Pilot.Startup"],
	runAllOnChange: [
		"app/BibleOnSite/AppShell.xaml",
		"app/devops/**",
		"app/mobile-e2e/**",
		".github/**",
		"web/bible-on-site/src/lib/recitation-audio.ts",
	],
	noImpact: ["docs/**", "**/*.md", "app/BibleOnSite.Tests/**"],
	scope: ["app/**"],
};

const SNAPSHOT = "1111111111111111111111111111111111111111";
const TESTED = "2222222222222222222222222222222222222222";

const DISCOVERED: DiscoveredTest[] = [
	{ id: "Suite.Pilot.Startup", file: "app/BibleOnSite.Tests.MobileE2E/PilotTests.cs", platform: "Shared", category: "MobileE2E" },
	{ id: "Suite.Pilot.Search", file: "app/BibleOnSite.Tests.MobileE2E/PilotTests.cs", platform: "Shared", category: "MobileE2E" },
	{ id: "Suite.Ios.Scroll", file: "app/BibleOnSite.Tests.MobileE2E/IosTests.cs", platform: "iOS", category: "MobileE2E" },
];

function makeTree(overrides: Partial<CoverageTree> = {}): CoverageTree {
	return {
		schemaVersion: SCHEMA_VERSION,
		suite: "app-mobile-e2e",
		platform: "android",
		snapshotSha: SNAPSHOT,
		collectorVersion: "1.0.0",
		collectedAtUtc: "2026-01-01T00:00:00Z",
		complete: true,
		sourceUnits: {
			"app/BibleOnSite/Pages/PerekPage": [
				"app/BibleOnSite/Pages/PerekPage.Search.cs",
				"app/BibleOnSite/Pages/PerekPage.xaml",
				"app/BibleOnSite/Pages/PerekPage.xaml.cs",
			],
			"app/BibleOnSite/Controls/FloatingSearchBar": [
				"app/BibleOnSite/Controls/FloatingSearchBar.xaml",
				"app/BibleOnSite/Controls/FloatingSearchBar.xaml.cs",
			],
		},
		sourceFiles: [
			"app/BibleOnSite/Pages/PerekPage.xaml",
			"app/BibleOnSite/Pages/PerekPage.xaml.cs",
			"app/BibleOnSite/Pages/PerekPage.Search.cs",
			"app/BibleOnSite/Controls/FloatingSearchBar.xaml",
			"app/BibleOnSite/Controls/FloatingSearchBar.xaml.cs",
		],
		tests: {
			"Suite.Pilot.Search": {
				file: "app/BibleOnSite.Tests.MobileE2E/PilotTests.cs",
				files: ["app/BibleOnSite/Controls/FloatingSearchBar.xaml"],
				automationIds: ["PerekSearchInput", "SearchBook7"],
				unmappedIds: [],
				sessions: ["s1"],
				outcome: "passed",
			},
			"Suite.Pilot.Startup": {
				files: ["app/BibleOnSite/Pages/PerekPage.xaml"],
				automationIds: ["PerekSource"],
				unmappedIds: [],
				sessions: ["s2"],
				outcome: "passed",
			},
		},
		...overrides,
	};
}

function select(overrides: Partial<Parameters<typeof selectTests>[0]> = {}) {
	return selectTests({
		rules: RULES,
		baseline: { kind: "ok", tree: makeTree() },
		changedFiles: [],
		discovered: DISCOVERED,
		platform: "android",
		testedSha: TESTED,
		...overrides,
	});
}

const selectedIds = (m: ReturnType<typeof selectTests>) => m.selected.map((t) => t.id);

// ── glob ────────────────────────────────────────────────────────────────

describe("globToRegExp", () => {
	test("matches full directory trees and single segments", () => {
		assert.ok(matchesGlob("app/devops/Build.cs", "app/devops/**"));
		assert.ok(matchesGlob("app/devops", "app/devops/**"));
		assert.ok(matchesGlob("x/PilotTests.cs", "**/*Tests.cs"));
		assert.ok(matchesGlob("a/b/c/PilotTests.cs", "**/*Tests.cs"));
		assert.ok(!matchesGlob("x/PilotTests.csx", "**/*Tests.cs"));
		assert.ok(matchesGlob("docs/a/b.md", "docs/**"));
		assert.ok(matchesGlob("AGENTS.md", "**/*.md"));
		assert.ok(matchesGlob("a/b/AGENTS.md", "**/*.md"));
		assert.ok(!matchesGlob("a/b/AGENTS.mdx", "**/*.md"));
		assert.ok(matchesGlob("app/x.cs", "app/**"));
		assert.ok(!matchesGlob("appx/y.cs", "app/**"));
	});
});

// ── discovery ───────────────────────────────────────────────────────────

describe("parseTestSource", () => {
	test("extracts namespaced FQNs, traits and categories", () => {
		const parsed = parseTestSource(`namespace BibleOnSite.Tests.MobileE2E;

[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PilotTests
{
    [Fact]
    public void Startup() => Run();

    [Theory]
    [InlineData(1)]
    public void Sizes(int x) {}

    private void Helper() {}
    public void NoFact() {}
}
`);
		assert.equal(parsed.namespace, "BibleOnSite.Tests.MobileE2E");
		assert.equal(parsed.tests.length, 2);
		assert.equal(parsed.tests[0].className, "PilotTests");
		assert.equal(parsed.tests[0].traits.get("Platform"), "Shared");
		assert.equal(parsed.tests[1].method, "Sizes");
	});

	test("comments inside attribute blocks do not reset traits", () => {
		const parsed = parseTestSource(`namespace N;
[Trait("Category", "MobileE2E")]
// reason for the trait
public class T
{
    [Fact]
    // regression note
    public void M() {}
}
`);
		assert.equal(parsed.tests[0].traits.get("Category"), "MobileE2E");
	});
});

describe("discoverSuiteTests", () => {
	test("discovers only the suite category from real sources", () => {
		const repo = mkdtempSync(join(tmpdir(), "e2e-impact-"));
		try {
			const root = join(repo, "app/BibleOnSite.Tests.MobileE2E");
			mkdirSync(root, { recursive: true });
			writeFileSync(
				join(root, "PilotTests.cs"),
				`namespace N;
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public class PilotTests { [Fact] public void Startup() {} }
`,
			);
			writeFileSync(
				join(root, "UnitTests.cs"),
				`namespace N;
[Trait("Category", "Unit")]
public class UnitTests { [Fact] public void Config() {} }
`,
			);
			const tests = discoverSuiteTests(repo, "app/BibleOnSite.Tests.MobileE2E", "**/*Tests.cs", "MobileE2E");
			assert.deepEqual(
				tests.map((t) => t.id),
				["N.PilotTests.Startup"],
			);
			assert.equal(tests[0].platform, "Shared");
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

// ── selection ───────────────────────────────────────────────────────────

describe("applicableTests", () => {
	test("keeps shared tests plus the current platform", () => {
		const android = applicableTests(DISCOVERED, "android");
		assert.deepEqual(
			android.map((t) => t.id),
			["Suite.Pilot.Startup", "Suite.Pilot.Search"],
		);
		const ios = applicableTests(DISCOVERED, "ios");
		assert.deepEqual(
			ios.map((t) => t.id),
			["Suite.Pilot.Startup", "Suite.Pilot.Search", "Suite.Ios.Scroll"],
		);
	});
});

describe("selectTests fallbacks", () => {
	test("missing baseline runs the full applicable suite", () => {
		const manifest = select({
			baseline: { kind: "missing", reason: "artifact not found" },
			platform: "ios",
		});
		assert.equal(manifest.selectAll, true);
		assert.equal(manifest.mode, "full");
		assert.equal(manifest.filter.vstest, null);
		assert.equal(manifest.selected.length, 3);
		assert.ok(manifest.fallbacks[0].startsWith("missing-baseline"));
	});

	test("corrupt baseline runs everything", () => {
		const manifest = select({ baseline: { kind: "corrupt", reason: "bad json" } });
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks[0].startsWith("corrupt-baseline"));
	});

	test("incompatible snapshot (wrong platform) runs everything", () => {
		const manifest = select({
			baseline: { kind: "ok", tree: makeTree({ platform: "ios" }) },
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks[0].startsWith("incompatible-baseline"));
	});

	test("non-ancestor baseline runs everything", () => {
		const manifest = select({
			baseline: { kind: "not-ancestor", reason: "diverged" },
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks[0].startsWith("not-ancestor-baseline"));
	});

	test("unavailable diff runs everything", () => {
		const manifest = select({ changedFiles: null });
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.includes("diff-unavailable"));
	});

	test("force-full runs everything", () => {
		const manifest = select({ forceFull: true });
		assert.equal(manifest.selectAll, true);
		assert.equal(manifest.forced, true);
	});
});

describe("selectTests mapping", () => {
	test("a covered file selects only the tests that recorded it", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite/Controls/FloatingSearchBar.xaml", status: "modified" }],
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Search", "Suite.Pilot.Startup"]);
		assert.deepEqual(
			manifest.selected.find((t) => t.id === "Suite.Pilot.Search")?.reasons,
			["covered-file:app/BibleOnSite/Controls/FloatingSearchBar.xaml"],
		);
		assert.ok(
			manifest.selected
				.find((t) => t.id === "Suite.Pilot.Startup")
				?.reasons.includes("always-run"),
		);
		assert.deepEqual(
			manifest.unselected.map((t) => t.id),
			[],
		);
		assert.ok(manifest.filter.vstest?.includes("FullyQualifiedName=Suite.Pilot.Search"));
	});

	test("ios platform also selects ios-only tests missing baseline evidence", () => {
		const manifest = select({
			platform: "ios",
			baseline: { kind: "ok", tree: makeTree({ platform: "ios" }) },
			changedFiles: [{ path: "app/BibleOnSite/Controls/FloatingSearchBar.xaml", status: "modified" }],
		});
		assert.equal(manifest.selectAll, false);
		// Scroll has no baseline evidence on iOS, so it counts as a new test.
		assert.deepEqual(
			selectedIds(manifest),
			["Suite.Ios.Scroll", "Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
		assert.deepEqual(
			manifest.unselected.map((t) => t.id),
			[],
		);
	});

	test("a partial-class companion file selects the unit's tests", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite/Pages/PerekPage.Search.cs", status: "modified" }],
		});
		// PerekPage.Search.cs belongs to unit PerekPage → Startup covers PerekPage.xaml.
		assert.equal(manifest.selectAll, false);
		assert.ok(selectedIds(manifest).includes("Suite.Pilot.Startup"));
	});

	test("an in-scope unmapped change runs the full suite", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite/ViewModels/SearchViewModel.cs", status: "modified" }],
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.startsWith("unmapped-in-scope")));
	});

	test("a shared test helper change runs every test", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite.Tests.MobileE2E/Pages/PerekPage.cs", status: "modified" }],
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.startsWith("changed-test-harness")));
	});

	test("a changed test file selects exactly its declared tests", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite.Tests.MobileE2E/IosTests.cs", status: "modified" }],
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Startup"]);
		assert.equal(manifest.platform, "android");
	});

	test("same test file on ios selects the ios test", () => {
		const manifest = select({
			platform: "ios",
			baseline: { kind: "ok", tree: makeTree({ platform: "ios" }) },
			changedFiles: [{ path: "app/BibleOnSite.Tests.MobileE2E/IosTests.cs", status: "modified" }],
		});
		assert.deepEqual(
			selectedIds(manifest),
			["Suite.Ios.Scroll", "Suite.Pilot.Startup"],
		);
	});

	test("a non-suite test file change is noted, not selected", () => {
		const discovered: DiscoveredTest[] = [
			...DISCOVERED,
			{ id: "N.UnitTests.Config", file: "app/BibleOnSite.Tests.MobileE2E/UnitTests.cs", platform: "Shared", category: "Unit" },
		];
		const manifest = select({
			discovered: discovered.filter((t) => t.category === "MobileE2E"),
			changedFiles: [{ path: "app/BibleOnSite.Tests.MobileE2E/UnitTests.cs", status: "modified" }],
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(manifest.nonApplicableTestChanges, ["app/BibleOnSite.Tests.MobileE2E/UnitTests.cs"]);
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Startup"]);
	});

	test("global triggers always run everything", () => {
		for (const path of [
			".github/workflows/app-mobile-e2e.yml",
			"app/devops/Build.Test.cs",
			"app/mobile-e2e/run.mjs",
			"web/bible-on-site/src/lib/recitation-audio.ts",
		]) {
			const manifest = select({ changedFiles: [{ path, status: "modified" }] });
			assert.equal(manifest.selectAll, true, path);
		}
	});

	test("out-of-scope and no-impact files select nothing new", () => {
		const manifest = select({
			changedFiles: [
				{ path: "web/api/src/lib.rs", status: "modified" },
				{ path: "docs/tests/app/coverage.md", status: "modified" },
				{ path: "AGENTS.md", status: "modified" },
			],
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Startup"]); // smoke only
		assert.deepEqual(
			manifest.changedFiles.map((f) => f.resolution),
			["ignored", "ignored", "none"],
		);
	});

	test("deleted covered file still selects its tests", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite/Controls/FloatingSearchBar.xaml", status: "deleted" }],
		});
		assert.ok(selectedIds(manifest).includes("Suite.Pilot.Search"));
	});

	test("renamed file evaluates both paths", () => {
		const manifest = select({
			changedFiles: [
				{
					path: "app/BibleOnSite/Controls/SearchBar.xaml",
					status: "renamed",
					previousPath: "app/BibleOnSite/Controls/FloatingSearchBar.xaml",
				},
			],
		});
		assert.ok(selectedIds(manifest).includes("Suite.Pilot.Search"));
	});

	test("deleted test file selects nothing and is not an error", () => {
		const manifest = select({
			changedFiles: [{ path: "app/BibleOnSite.Tests.MobileE2E/IosTests.cs", status: "deleted" }],
		});
		assert.equal(manifest.selectAll, false);
		const resolution = manifest.changedFiles.find((f) => f.path.endsWith("IosTests.cs"));
		assert.equal(resolution?.reason, "deleted-test-file");
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Startup"]);
	});

	test("new tests without baseline evidence always run", () => {
		const manifest = select({ changedFiles: [] });
		// Suite.Ios.Scroll is not in the android platform candidates
		const iosManifest = select({
			platform: "ios",
			baseline: { kind: "ok", tree: makeTree({ platform: "ios" }) },
			changedFiles: [{ path: "web/api/src/lib.rs", status: "modified" }],
		});
		assert.ok(selectedIds(iosManifest).includes("Suite.Ios.Scroll"));
		assert.ok(iosManifest.newTests.includes("Suite.Ios.Scroll"));
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Startup"]);
	});

	test("previously failing tests are re-run under policy", () => {
		const tree = makeTree();
		tree.tests["Suite.Pilot.Search"].outcome = "failed";
		const manifest = select({
			baseline: { kind: "ok", tree },
			changedFiles: [{ path: "docs/x.md", status: "modified" }],
		});
		assert.ok(selectedIds(manifest).includes("Suite.Pilot.Search"));
		assert.ok(
			manifest.selected
				.find((t) => t.id === "Suite.Pilot.Search")
				?.reasons.includes("previously-failing"),
		);
	});

	test("empty selection is guarded into a full run", () => {
		const manifest = selectTests({
			rules: { ...RULES, alwaysRun: [] },
			baseline: { kind: "ok", tree: makeTree() },
			changedFiles: [{ path: "docs/x.md", status: "modified" }],
			discovered: DISCOVERED,
			platform: "android",
			testedSha: TESTED,
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.includes("empty-selection-guard"));
	});

	test("stale tree entries are reported, not selected", () => {
		const tree = makeTree();
		tree.tests["Suite.Deleted.Test"] = {
			files: ["app/BibleOnSite/Pages/PerekPage.xaml"],
			automationIds: [],
			unmappedIds: [],
			sessions: [],
			outcome: "passed",
		};
		const manifest = select({ baseline: { kind: "ok", tree } });
		assert.deepEqual(manifest.staleTreeTests, ["Suite.Deleted.Test"]);
		assert.ok(!selectedIds(manifest).includes("Suite.Deleted.Test"));
	});
});

describe("selectTests determinism", () => {
	test("identical inputs produce identical manifests", () => {
		const changedFiles: ChangedFile[] = [
			{ path: "app/BibleOnSite/Controls/FloatingSearchBar.xaml", status: "modified" },
			{ path: "docs/x.md", status: "added" },
		];
		const first = select({ changedFiles });
		const second = select({ changedFiles: [...changedFiles].reverse() });
		assert.equal(JSON.stringify(first.selected), JSON.stringify(second.selected));
		assert.equal(first.fingerprint, second.fingerprint);
	});
});

// ── unit grouping ───────────────────────────────────────────────────────

describe("fileToUnit", () => {
	const tree = makeTree();
	test("files already recorded keep their snapshot unit", () => {
		assert.equal(
			fileToUnit("app/BibleOnSite/Pages/PerekPage.Search.cs", tree, () => null),
			"app/BibleOnSite/Pages/PerekPage",
		);
	});

	test("a new verified partial joins the parent unit", () => {
		assert.equal(
			fileToUnit(
				"app/BibleOnSite/Pages/PerekPage.New.cs",
				tree,
				() => "public partial class PerekPage { }",
			),
			"app/BibleOnSite/Pages/PerekPage",
		);
	});

	test("a dotted non-partial file stays its own unit", () => {
		assert.equal(
			fileToUnit(
				"app/BibleOnSite/Pages/PerekPage.Other.cs",
				tree,
				() => "public class SomethingElse { }",
			),
			"app/BibleOnSite/Pages/PerekPage.Other",
		);
	});
});

describe("computeSourceUnits", () => {
	test("groups xaml, code-behind and verified partials", () => {
		const units = computeSourceUnits([
			{ path: "p/P.xaml", content: "" },
			{ path: "p/P.xaml.cs", content: "public partial class P {}" },
			{ path: "p/P.Extra.cs", content: "public partial class P {}" },
			{ path: "p/Q.R.cs", content: "public class R {}" },
		]);
		assert.deepEqual(units["p/P"], ["p/P.Extra.cs", "p/P.xaml", "p/P.xaml.cs"]);
		assert.deepEqual(units["p/Q.R"], ["p/Q.R.cs"]);
	});
});

describe("stripExtension", () => {
	test("handles paired and single extensions", () => {
		assert.equal(stripExtension("a/Foo.xaml.cs"), "a/Foo");
		assert.equal(stripExtension("a/Foo.xaml"), "a/Foo");
		assert.equal(stripExtension("a/Foo.cs"), "a/Foo");
		assert.equal(stripExtension("a/Foo"), "a/Foo");
	});
});

// ── collector ───────────────────────────────────────────────────────────

describe("scanAutomationIds", () => {
	test("finds literal, interpolated and SetAutomationId ids", () => {
		const patterns = scanAutomationIds([
			{
				path: "A.xaml",
				content: `<Label AutomationId="PerekSource"/><Label AutomationId="{Binding X}"/>`,
			},
			{
				path: "B.cs",
				content: `new CheckBox { AutomationId = $"SearchBook{book.Id}" };
					x.AutomationId = "Fixed";
					AutomationProperties.SetAutomationId(y, "SetId");`,
			},
		]);
		const literals = patterns.filter((p) => p.kind === "literal").map((p) => p.pattern);
		const wildcards = patterns.filter((p) => p.kind === "wildcard").map((p) => p.pattern);
		assert.ok(literals.includes("PerekSource"));
		assert.ok(literals.includes("Fixed"));
		assert.ok(literals.includes("SetId"));
		assert.deepEqual(wildcards, ["SearchBook*"]);
		const wildcard = patterns.find((p) => p.pattern === "SearchBook*")?.matches;
		assert.ok(wildcard?.("SearchBook7"));
		// Prefix globs over-match by design — extra attribution is conservative.
		assert.ok(wildcard?.("SearchBooksX"));
		assert.ok(!wildcard?.("SearchBoo"));
	});
});

describe("collectTree", () => {
	test("maps recorded automation ids onto app files", () => {
		const repo = mkdtempSync(join(tmpdir(), "e2e-impact-collect-"));
		try {
			const sourceRoot = join(repo, "app/BibleOnSite/Pages");
			const testsRoot = join(repo, "app/BibleOnSite.Tests.MobileE2E");
			const artifacts = join(repo, "artifacts/coverage-evidence");
			mkdirSync(sourceRoot, { recursive: true });
			mkdirSync(testsRoot, { recursive: true });
			mkdirSync(artifacts, { recursive: true });
			writeFileSync(
				join(sourceRoot, "PerekPage.xaml"),
				`<Label AutomationId="PerekSource"/><Label AutomationId="PasukText"/>`,
			);
			writeFileSync(
				join(testsRoot, "PilotTests.cs"),
				`namespace N;
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public class PilotTests { [Fact] public void Startup() {} }
`,
			);
			writeFileSync(
				join(artifacts, "N.PilotTests.Startup.json"),
				JSON.stringify({
					test: "N.PilotTests.Startup",
					platform: "android",
					outcome: "passed",
					sessions: ["s1"],
					automationIds: ["PerekSource", "MissingId"],
				}),
			);
			const tree = collectTree({
				repoRoot: repo,
				rules: RULES,
				platform: "android",
				artifactsDir: join(repo, "artifacts"),
				snapshotSha: SNAPSHOT,
				complete: true,
			});
			const entry = tree.tests["N.PilotTests.Startup"];
			assert.deepEqual(entry.files, ["app/BibleOnSite/Pages/PerekPage.xaml"]);
			assert.deepEqual(entry.unmappedIds, ["MissingId"]);
			assert.equal(entry.file, "app/BibleOnSite.Tests.MobileE2E/PilotTests.cs");
			assert.deepEqual(tree.sourceUnits["app/BibleOnSite/Pages/PerekPage"], [
				"app/BibleOnSite/Pages/PerekPage.xaml",
			]);
			assert.equal(tree.complete, true);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("loadEvidence tolerates a missing directory", () => {
		assert.deepEqual(loadEvidence(join(tmpdir(), "does-not-exist-e2e-impact")), []);
	});
});

// ── zip ─────────────────────────────────────────────────────────────────

function makeZip(entries: { name: string; content: string }[]): Buffer {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;
	for (const { name, content } of entries) {
		const nameBytes = Buffer.from(name, "utf8");
		const compressed = deflateRawSync(content);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(0, 12);
		local.writeUInt32LE(0, 14); // crc (not validated by the reader)
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(Buffer.byteLength(content), 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28);
		localParts.push(local, nameBytes, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(0, 14);
		central.writeUInt32LE(0, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(Buffer.byteLength(content), 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		centralParts.push(central, nameBytes);
		offset += 30 + nameBytes.length + compressed.length;
	}
	const localData = Buffer.concat(localParts);
	const centralData = Buffer.concat(centralParts);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralData.length, 12);
	eocd.writeUInt32LE(localData.length, 16);
	return Buffer.concat([localData, centralData, eocd]);
}

describe("extractZip", () => {
	test("extracts deflated entries", () => {
		const out = mkdtempSync(join(tmpdir(), "e2e-impact-zip-"));
		try {
			const extracted = extractZip(
				makeZip([{ name: "coverage-tree.json", content: '{"a":1}' }]),
				out,
			);
			assert.deepEqual(extracted, ["coverage-tree.json"]);
			assert.equal(readFileSync(join(out, "coverage-tree.json"), "utf8"), '{"a":1}');
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
});

// ── misc ────────────────────────────────────────────────────────────────

describe("model helpers", () => {
	test("canonicalize sorts keys for stable fingerprints", () => {
		assert.equal(canonicalize({ b: [2, 1], a: { d: 1, c: 2 } }), canonicalize({ a: { c: 2, d: 1 }, b: [2, 1] }));
	});
	test("loadRules validates required fields", () => {
		const file = join(mkdtempSync(join(tmpdir(), "e2e-impact-rules-")), "bad.json");
		writeFileSync(file, JSON.stringify({ schemaVersion: 1, suite: "x" }));
		assert.throws(() => loadRules(file), /missing fields/);
	});
});

// ── structural fingerprints ─────────────────────────────────────────────

describe("fingerprintSource csharp", () => {
	const BASE = `namespace App;
public class PerekPage
{
    // navigates to a perek
    private readonly string title = "pasuk";
    public int Count { get; set; } = 7;
    public string GetTitle(int index)
    {
        var label = $"{title}:{index}";
        return label; // done
    }
}
`;
	test("trivia-only edits keep the semantic hash", () => {
		const base = fingerprintSource("PerekPage.cs", BASE);
		assert.ok(base !== null);
		const reformatted = fingerprintSource(
			"PerekPage.cs",
			BASE.replace("    // navigates to a perek\n", "")
				.replace("public int Count { get; set; } = 7;", "public int Count {\n\t\tget;\n\t\tset;\n\t} = 7;")
				.replace("return label; // done", "return   label;   /* done */"),
		);
		assert.ok(reformatted !== null);
		assert.equal(reformatted.semantic, base.semantic);
	});

	test("line endings and comments do not change the hash", () => {
		const base = fingerprintSource("PerekPage.cs", BASE);
		const crlf = fingerprintSource("PerekPage.cs", `${BASE.replace(/\n/g, "\r\n")}// trailing note\n`);
		assert.ok(crlf !== null && base !== null);
		assert.equal(crlf.semantic, base.semantic);
	});

	test("code edits change the hash", () => {
		const base = fingerprintSource("PerekPage.cs", BASE);
		assert.ok(base !== null);
		for (const edited of [
			BASE.replace("= 7;", "= 8;"),
			BASE.replace("GetTitle", "GetCaption"),
			BASE.replace('"pasuk"', '"other"'),
			BASE.replace('var label = $"{title}:{index}"', 'var label = $"{title}-{index}"'),
			BASE.replace("namespace App;", "#nullable enable\nnamespace App;"),
		]) {
			const fp = fingerprintSource("PerekPage.cs", edited);
			assert.ok(fp !== null);
			assert.notEqual(fp.semantic, base.semantic, edited.slice(0, 60));
		}
	});

	test("verbatim, interpolated and raw strings hash by content", () => {
		const withVerbatim = fingerprintSource("A.cs", 'var s = @"a  b";');
		const sameVerbatim = fingerprintSource("A.cs", 'var   s   =   @"a  b";   // note');
		assert.ok(withVerbatim !== null && sameVerbatim !== null);
		assert.equal(withVerbatim.semantic, sameVerbatim.semantic);
		const raw = fingerprintSource("A.cs", 'var s = """\nline "q" content\n""";');
		assert.ok(raw !== null);
		assert.equal(fingerprintSource("A.cs", 'var s = "never closed;'), null);
		assert.equal(fingerprintSource("A.cs", "/* never closed"), null);
	});

	test("extracts type and member declarations", () => {
		const fp = fingerprintSource("PerekPage.cs", BASE);
		assert.ok(fp !== null);
		assert.ok(fp.declarations.includes("ns:App"));
		assert.ok(fp.declarations.includes("type:class:PerekPage"));
		assert.ok(
			fp.declarations.some((d) => d.startsWith("member:") && d.includes("GetTitle")),
		);
		assert.ok(
			fp.declarations.some((d) => d.startsWith("member:") && d.includes("Count")),
		);
	});

	test("uncomputable inputs return null", () => {
		assert.equal(fingerprintSource("image.png", "fake-bytes"), null);
		assert.equal(fingerprintSource("data.yaml", "a: 1"), null);
		assert.equal(fingerprintSource("A.cs", "has \u0000 byte"), null);
	});
});

describe("fingerprintSource csharp members", () => {
	const SHAPES = `namespace App;
public class Widget
{
    private readonly string title = "pasuk";
    public int Count { get; set; } = 7;
    public void Render()
    {
        var x = 1;
    }
}
`;
	const memberKeys = (content: string) => {
		const fp = fingerprintSource("Widget.cs", content);
		assert.ok(fp !== null && fp.members !== undefined);
		return fp.members;
	};

	test("member keys carry the qualified name plus a signature hash", () => {
		const members = memberKeys(SHAPES);
		assert.ok(Object.keys(members).includes("type:App.Widget"));
		for (const name of ["title", "Count", "Render"]) {
			assert.ok(
				Object.keys(members).some((key) =>
					key.startsWith(`App.Widget.${name}#`),
				),
				`member ${name}`,
			);
		}
	});

	test("trivia edits keep members; body edits keep the key, change the digest", () => {
		const base = memberKeys(SHAPES);
		const trivia = memberKeys(`// note\n${SHAPES.replace("var x = 1;", "var   x   =   1; // hi")}`);
		assert.deepEqual(trivia, base);
		const body = memberKeys(SHAPES.replace("var x = 1;", "var x = 2;"));
		const renderKey = Object.keys(base).find((key) => key.includes(".Render#"));
		assert.ok(renderKey !== undefined);
		assert.notEqual(body[renderKey], base[renderKey]);
		assert.equal(
			body[Object.keys(base).find((key) => key.includes(".Count#"))!],
			base[Object.keys(base).find((key) => key.includes(".Count#"))!],
		);
	});

	test("a signature change reads as remove+add, never same-key", () => {
		const base = memberKeys(SHAPES);
		const edited = memberKeys(SHAPES.replace("void Render()", "void Render(int depth)"));
		const baseKeys = Object.keys(base).filter((key) => key.includes(".Render#"));
		const editedKeys = Object.keys(edited).filter((key) => key.includes(".Render#"));
		assert.equal(baseKeys.length, 1);
		assert.equal(editedKeys.length, 1);
		assert.notEqual(editedKeys[0], baseKeys[0]);
	});

	test("generic constraints are not type declarations (`where T : class`)", () => {
		const members = memberKeys(`namespace App;
public class Repo
{
    public static void Subscribe<T, TSource>(T target, TSource source,
        Action<TSource, EventHandler> add) where T : class
    {
        add(source, null!);
    }
}
`);
		assert.ok(
			Object.keys(members).some((key) => key.startsWith("App.Repo.Subscribe#")),
		);
		assert.equal(Object.keys(members).filter((key) => key.includes("?")).length, 0);
		assert.deepEqual(
			Object.keys(members).filter((key) => key.startsWith("type:")),
			["type:App.Repo"],
		);
	});

	test("post-body initializers join the member they belong to", () => {
		// `Prop { get; } = expr;` and `= new X() { …init… }` — the run after
		// the body's `}` is part of the same member, not a phantom `?` one.
		const members = memberKeys(`namespace App;
public class Vm
{
    public int Count { get; } = 7;
    public UITextView Text { get; } = new UITextView()
    {
        Editable = false,
    };
}
`);
		const keys = Object.keys(members);
		assert.equal(keys.filter((key) => key.includes("?")).length, 0);
		assert.ok(keys.some((key) => key.startsWith("App.Vm.Count#")));
		assert.ok(keys.some((key) => key.startsWith("App.Vm.Text#")));
		// Editing the initializer is the property's own change.
		const edited = memberKeys(`namespace App;
public class Vm
{
    public int Count { get; } = 7;
    public UITextView Text { get; } = new UITextView()
    {
        Editable = true,
    };
}
`);
		const textKey = keys.find((key) => key.includes(".Text#"));
		assert.ok(textKey !== undefined);
		assert.notEqual(edited[textKey], members[textKey]);
	});
});

describe("fingerprintSource xml", () => {
	const XAML = `<?xml version="1.0" encoding="utf-8" ?>
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             x:Class="App.PerekPage">
    <!-- search row -->
    <Entry AutomationId="PerekSearchInput"
           Placeholder="search" />
</ContentPage>
`;
	test("reformatting, comments and quote style keep the hash", () => {
		const base = fingerprintSource("PerekPage.xaml", XAML);
		assert.ok(base !== null);
		const edited = fingerprintSource(
			"PerekPage.xaml",
			XAML
				.replace("<!-- search row -->", "")
				.replace('Placeholder="search"', "Placeholder='search'")
				.replace("<Entry AutomationId", "<Entry\n            AutomationId"),
		);
		assert.ok(edited !== null);
		assert.equal(edited.semantic, base.semantic);
	});

	test("value and structure edits change the hash", () => {
		const base = fingerprintSource("PerekPage.xaml", XAML);
		assert.ok(base !== null);
		for (const edited of [
			XAML.replace("PerekSearchInput", "OtherId"),
			XAML.replace("<Entry", '<Entry AutomationId2="x"'),
		]) {
			const fp = fingerprintSource("PerekPage.xaml", edited);
			assert.ok(fp !== null);
			assert.notEqual(fp.semantic, base.semantic);
		}
		assert.equal(fingerprintSource("PerekPage.xaml", "<a><!-- never closed"), null);
	});

	test("identity attributes become declarations", () => {
		const fp = fingerprintSource("PerekPage.xaml", XAML);
		assert.ok(fp !== null);
		assert.ok(fp.declarations.includes("attr:x:Class:App.PerekPage"));
		assert.ok(fp.declarations.includes("attr:AutomationId:PerekSearchInput"));
	});
});

describe("fingerprintSource script and json", () => {
	test("comments and formatting are ignored", () => {
		const base = fingerprintSource("a.ts", "export const x = 1; // note\n");
		const edited = fingerprintSource("a.ts", "export const x=1;/*b*/\n");
		assert.ok(base !== null && edited !== null);
		assert.equal(base.semantic, edited.semantic);
	});

	test("ambiguous regex contexts bail to null", () => {
		assert.equal(fingerprintSource("a.ts", "const r = /a+b/g;"), null);
	});

	test("json reformats do not change the hash", () => {
		const base = fingerprintSource("x.json", '{"a": [1, 2],"b": "s"}');
		const edited = fingerprintSource("x.json", '{ "a" : [ 1,2 ], "b" :"s" }');
		assert.ok(base !== null && edited !== null);
		assert.equal(base.semantic, edited.semantic);
	});
});

describe("selectTests structural equivalence", () => {
	const BASE_CS = `namespace App;
public class FloatingSearchBar
{
    // the search box
    public string Query { get; set; }
}
`;
	const COVERED = "app/BibleOnSite/Controls/FloatingSearchBar.xaml.cs";
	const treeWithFp = () => {
		const tree = makeTree({
			sourceFingerprints: {
				[COVERED]: fingerprintSource(COVERED, BASE_CS) ?? undefined,
			} as CoverageTree["sourceFingerprints"],
		});
		tree.tests["Suite.Pilot.Search"].files = [COVERED];
		return tree;
	};
	const fpMap = (content: string | null) =>
		new Map([
			[COVERED, content === null ? null : fingerprintSource(COVERED, content)],
		]);

	test("a trivia-only covered change selects nothing by itself", () => {
		const reformatted = BASE_CS
			.replace("    // the search box\n", "        // moved comment\n")
			.replace("public string Query", "\tpublic   string   Query");
		const manifest = select({
			baseline: { kind: "ok", tree: treeWithFp() },
			changedFiles: [{ path: COVERED, status: "modified" }],
			currentFingerprints: fpMap(reformatted),
		});
		assert.equal(manifest.selectAll, false);
		assert.equal(
			manifest.changedFiles.find((f) => f.path === COVERED)?.reason,
			"unchanged-structural",
		);
		assert.deepEqual(manifest.unchangedStructural, [COVERED]);
		// Only the always-run smoke test remains selected.
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Startup"]);
	});

	test("a real edit still selects the covering tests", () => {
		const edited = BASE_CS.replace("public string Query", "public string QueryText");
		const manifest = select({
			baseline: { kind: "ok", tree: treeWithFp() },
			changedFiles: [{ path: COVERED, status: "modified" }],
			currentFingerprints: fpMap(edited),
		});
		assert.equal(
			manifest.changedFiles.find((f) => f.path === COVERED)?.reason,
			"covered-file",
		);
		assert.ok(selectedIds(manifest).includes("Suite.Pilot.Search"));
	});

	test("missing or uncomputable evidence keeps the change covered", () => {
		// Unfingerprintable current file → treated as changed.
		const uncomputable = select({
			baseline: { kind: "ok", tree: treeWithFp() },
			changedFiles: [{ path: COVERED, status: "modified" }],
			currentFingerprints: fpMap(null),
		});
		assert.ok(selectedIds(uncomputable).includes("Suite.Pilot.Search"));
		// Baseline collected before fingerprints existed → treated as changed.
		const oldBaseline = makeTree();
		oldBaseline.tests["Suite.Pilot.Search"].files = [COVERED];
		const noBaselineFp = select({
			baseline: { kind: "ok", tree: oldBaseline },
			changedFiles: [{ path: COVERED, status: "modified" }],
			currentFingerprints: fpMap(BASE_CS),
		});
		assert.ok(selectedIds(noBaselineFp).includes("Suite.Pilot.Search"));
	});

	test("structural equivalence never overrides broad-run patterns", () => {
		const shell = "app/BibleOnSite/AppShell.xaml";
		const tree = makeTree({
			sourceFingerprints: {
				[shell]: fingerprintSource(shell, "<Shell></Shell>") ?? undefined,
			} as CoverageTree["sourceFingerprints"],
		});
		const manifest = select({
			baseline: { kind: "ok", tree },
			changedFiles: [{ path: shell, status: "modified" }],
			currentFingerprints: new Map([
				[shell, fingerprintSource(shell, "<Shell>\n</Shell>")],
			]),
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.startsWith("global-trigger")));
	});

	test("unmapped in-scope trivia edits resolve as structurally unchanged", () => {
		const file = "app/BibleOnSite/ViewModels/SearchViewModel.cs";
		const content = "public class SearchViewModel { public int X; }";
		const tree = makeTree({
			sourceFingerprints: {
				[file]: fingerprintSource(file, content) ?? undefined,
			} as CoverageTree["sourceFingerprints"],
		});
		const manifest = select({
			baseline: { kind: "ok", tree },
			changedFiles: [{ path: file, status: "modified" }],
			currentFingerprints: new Map([
				[file, fingerprintSource(file, `// note\n${content}`)],
			]),
		});
		assert.equal(
			manifest.changedFiles.find((f) => f.path === file)?.reason,
			"unchanged-structural",
		);
		assert.equal(manifest.selectAll, false);
	});
});

describe("selectTests member granularity", () => {
	// No always-run noise — the assertions below are about the resolution
	// of the member diff alone.
	const MEMBER_RULES: SuiteRules = { ...RULES, alwaysRun: [] };
	const MEMBER_CS = `namespace App;
public class FloatingSearchBar
{
    public void Render()
    {
        var x = 1;
        var y = x;
    }

    public void Bind()
    {
        var z = 2;
    }
}
`;
	const MEMBER_FILE = "app/BibleOnSite/Controls/FloatingSearchBar.xaml.cs";
	const memberKeys = (content: string) => {
		const fp = fingerprintSource(MEMBER_FILE, content);
		assert.ok(fp !== null && fp.members !== undefined);
		return Object.keys(fp.members);
	};
	const memberKey = (name: string, content = MEMBER_CS) => {
		const key = memberKeys(content).find((k) => k.includes(`.${name}#`));
		assert.ok(key !== undefined, `${name} member key in fingerprint`);
		return key;
	};
	const RENDER = memberKey("Render");
	const BIND = memberKey("Bind");

	const memberTree = (
		options: {
			searchMembers?: Record<string, string[]>;
			startupMembers?: Record<string, string[]>;
			startupFiles?: string[];
			fingerprintMembers?: boolean;
			memberGaps?: Record<string, string[]>;
		} = {},
	) => {
		const fp = fingerprintSource(MEMBER_FILE, MEMBER_CS);
		assert.ok(fp !== null);
		if (options.fingerprintMembers === false) delete fp.members;
		const tree = makeTree({
			sourceFingerprints: { [MEMBER_FILE]: fp },
			...(options.memberGaps !== undefined ? { memberGaps: options.memberGaps } : {}),
		});
		tree.tests["Suite.Pilot.Search"].files = [MEMBER_FILE];
		if (options.searchMembers !== undefined) {
			tree.tests["Suite.Pilot.Search"].members = options.searchMembers;
		}
		tree.tests["Suite.Pilot.Startup"].files = options.startupFiles ?? [MEMBER_FILE];
		if (options.startupMembers !== undefined) {
			tree.tests["Suite.Pilot.Startup"].members = options.startupMembers;
		}
		return tree;
	};
	const memberFpMap = (content: string | null) =>
		new Map([
			[MEMBER_FILE, content === null ? null : fingerprintSource(MEMBER_FILE, content)],
		]);
	const memberSelect = (tree: CoverageTree, content: string | null) =>
		select({
			rules: MEMBER_RULES,
			baseline: { kind: "ok", tree },
			changedFiles: [{ path: MEMBER_FILE, status: "modified" }],
			currentFingerprints: memberFpMap(content),
		});
	const resolutionOf = (m: ReturnType<typeof selectTests>) =>
		m.changedFiles.find((f) => f.path === MEMBER_FILE);

	test("a covered member change selects only the tests that executed it", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		const edited = MEMBER_CS.replace("var x = 1;", "var x = 42; var w = x;");
		const manifest = memberSelect(tree, edited);
		const resolution = resolutionOf(manifest);
		assert.equal(resolution?.resolution, "tests");
		assert.equal(resolution?.reason, "covered-members");
		assert.deepEqual(resolution?.tests, ["Suite.Pilot.Search"]);
		assert.deepEqual(selectedIds(manifest), ["Suite.Pilot.Search"]);
	});

	test("member identity survives line shifts — an edit below is still member-level", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		// Five comment lines above the class move every member down;
		// position-independent keys keep the same member diff.
		const shifted = `// header\n// header\n// header\n// header\n// header\n${MEMBER_CS}`;
		const edited = shifted.replace("var z = 2;", "var z = 3;");
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "covered-members");
		assert.deepEqual(resolutionOf(manifest)?.tests, ["Suite.Pilot.Startup"]);
	});

	test("a change to both members selects both covering tests", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		const edited = MEMBER_CS
			.replace("var x = 1;", "var x = 9;")
			.replace("var z = 2;", "var z = 9;");
		const manifest = memberSelect(tree, edited);
		// Both covering tests execute changed members — the member pass ran
		// but could not narrow below the file's set, so it reads widened.
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("an added or removed member widens to the file's covering set", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		// Signature churn reads as remove+add — `Render` keeps its tests,
		// the added overload widens the rest.
		const edited = MEMBER_CS.replace(
			"    public void Render()\n",
			"    public void Render()\n    {\n    }\n\n    public void Render(int depth)\n",
		);
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("tests without member evidence for the file are never narrowed away", () => {
		// Startup covers the file through the automation-id channel only:
		// no member-qualified exec evidence, so it stays selected for ANY
		// member diff there — the union then equals the file set, which the
		// manifest reports as member-widened rather than narrowed.
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
		});
		const edited = MEMBER_CS.replace("var x = 1;", "var x = 42;");
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("a member change inside a gapped type widens to the file set", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
			memberGaps: { [MEMBER_FILE]: ["App.FloatingSearchBar"] },
		});
		const edited = MEMBER_CS.replace("var x = 1;", "var x = 42;");
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("a diff outside every member (using directive) widens to the file set", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		const edited = MEMBER_CS.replace(
			"namespace App;",
			"using System.Collections.Generic;\nnamespace App;",
		);
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("a directive edit beside a member edit still widens", () => {
		// The member diff explains only the member half — the `using` edit
		// touches no member key, so its blast radius is invisible to member
		// evidence and the file's whole covering set must run.
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		const edited = MEMBER_CS.replace(
			"namespace App;",
			"using System.Collections.Generic;\nnamespace App;",
		).replace("var x = 1;", "var x = 42;");
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("a gap on a type no fingerprint knows widens any member diff", () => {
		// Generated-type names can normalize to nothing the fingerprint
		// emitted — the gap then proves unmapped coverage exists but cannot
		// name its type, so every member diff in the file widens.
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
			memberGaps: { [MEMBER_FILE]: ["App.CompilerGenerated"] },
		});
		const edited = MEMBER_CS.replace("var x = 1;", "var x = 42;");
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
		assert.deepEqual(
			[...(resolutionOf(manifest)?.tests ?? [])].sort(),
			["Suite.Pilot.Search", "Suite.Pilot.Startup"],
		);
	});

	test("a member reorder keeps members identical and widens conservatively", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
			startupMembers: { [MEMBER_FILE]: [BIND] },
		});
		// Swapping member order changes the file hash but no member key or
		// digest — the diff sits between members, so the file set runs.
		const render = `    public void Render()\n    {\n        var x = 1;\n        var y = x;\n    }`;
		const bind = `    public void Bind()\n    {\n        var z = 2;\n    }`;
		const edited = MEMBER_CS.replace(`${render}\n\n${bind}`, `${bind}\n\n${render}`);
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "member-widened");
	});

	test("baselines without member data keep file-level selection", () => {
		// fingerprintMembers: false simulates a baseline collected before
		// member extraction existed; no members on entries either.
		const tree = memberTree({ fingerprintMembers: false });
		const edited = MEMBER_CS.replace("var x = 1;", "var x = 42;");
		const manifest = memberSelect(tree, edited);
		assert.equal(resolutionOf(manifest)?.reason, "covered-file");
	});

	test("uncomputable current source falls back to file-level selection", () => {
		const tree = memberTree({
			searchMembers: { [MEMBER_FILE]: [RENDER] },
		});
		const manifest = memberSelect(tree, null);
		assert.equal(resolutionOf(manifest)?.reason, "covered-file");
	});
});

// ── exec coverage merge ───────────────────────────────────────────────

const execEntry = (
	id: string,
	files: string[],
	overrides: Partial<ExecCoverageTest> = {},
): ExecCoverageTest => ({
	id,
	cases: [],
	attribution: "per-test",
	measured: true,
	outcome: "passed",
	evidenceSha: SNAPSHOT,
	sessions: [],
	startedUtc: "2026-01-01T00:00:00Z",
	endedUtc: "2026-01-01T00:00:40Z",
	nodes: [],
	files,
	visits: { sequence: 0, branch: 0, methodEntries: 0 },
	...overrides,
});

const execTree = (
	tests: Record<string, ExecCoverageTest>,
	overrides: Partial<ExecCoverageTree> = {},
): ExecCoverageTree => ({
	kind: "exec-coverage-tree",
	schemaVersion: 1,
	suite: "app-mobile-e2e",
	platform: "android",
	configuration: "Debug",
	snapshotSha: SNAPSHOT,
	collector: "altcover-app-dump",
	collectorVersion: "9.0.145",
	collectedAtUtc: "2026-01-01T00:00:00Z",
	complete: true,
	envFingerprint: "f".repeat(64),
	modules: [],
	nodes: {},
	tests,
	shared: { reasons: [], nodes: [], files: [] },
	unmatchedEvidence: [],
	diagnostics: {
		attribution: "per-test",
		dumpsTotal: 0,
		dumpsApplied: 0,
		errorDumps: [],
		incompatibleDumps: [],
		unknownPointIds: 0,
		missingDumps: [],
	},
	...overrides,
});

/**
 * A minimal repo: one XAML page + one discovered test class with two
 * facts, plus a single automation-id evidence record for `Startup`.
 */
function makeCollectRepo(): { repo: string; artifacts: string } {
	const repo = mkdtempSync(join(tmpdir(), "e2e-impact-exec-"));
	const sourceRoot = join(repo, "app/BibleOnSite/Pages");
	const testsRoot = join(repo, "app/BibleOnSite.Tests.MobileE2E");
	const evidenceDir = join(repo, "artifacts/coverage-evidence");
	mkdirSync(sourceRoot, { recursive: true });
	mkdirSync(testsRoot, { recursive: true });
	mkdirSync(evidenceDir, { recursive: true });
	writeFileSync(
		join(sourceRoot, "PerekPage.xaml"),
		`<Label AutomationId="PerekSource"/>`,
	);
	writeFileSync(join(sourceRoot, "PerekPage.xaml.cs"), `public partial class PerekPage {}`);
	writeFileSync(
		join(testsRoot, "PilotTests.cs"),
		`namespace N;
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public class PilotTests
{
    [Fact] public void Startup() {}
    [Fact] public void Scroll() {}
}
`,
	);
	writeFileSync(
		join(evidenceDir, "Startup-passed.json"),
		JSON.stringify({
			test: "N.PilotTests.Startup",
			platform: "android",
			outcome: "passed",
			sessions: ["s1"],
			automationIds: ["PerekSource"],
		}),
	);
	return { repo, artifacts: join(repo, "artifacts") };
}

const collect = (
	repo: string,
	artifacts: string,
	exec: ExecCoverageTree | undefined,
): CoverageTree =>
	collectTree({
		repoRoot: repo,
		rules: RULES,
		platform: "android",
		artifactsDir: artifacts,
		snapshotSha: SNAPSHOT,
		complete: true,
		...(exec !== undefined ? { execTree: exec } : {}),
	});

/** Strips the run timestamp — everything else must stay deterministic. */
const deterministic = (tree: CoverageTree) => {
	const { collectedAtUtc: _collectedAtUtc, ...rest } = tree;
	return rest;
};

describe("collectTree exec merge", () => {
	test("exec files and sessions union into the same test's entry", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const tree = collect(repo, artifacts, execTree({
				"N.PilotTests.Startup": execEntry(
					"N.PilotTests.Startup",
					["app/BibleOnSite/Controls/FloatingSearchBar.xaml.cs"],
					{ sessions: ["s2"] },
				),
			}));
			const entry = tree.tests["N.PilotTests.Startup"];
			assert.deepEqual(entry.files, [
				"app/BibleOnSite/Controls/FloatingSearchBar.xaml.cs",
				"app/BibleOnSite/Pages/PerekPage.xaml",
			]);
			assert.deepEqual(entry.sessions, ["s1", "s2"]);
			assert.deepEqual(entry.automationIds, ["PerekSource"]);
			assert.equal(entry.outcome, "passed");
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("exec-only tests join with the discovery-resolved file", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const tree = collect(repo, artifacts, execTree({
				"N.PilotTests.Scroll": execEntry(
					"N.PilotTests.Scroll",
					["app/BibleOnSite/Pages/PerekPage.xaml.cs"],
					{ sessions: ["s9"] },
				),
			}));
			const entry = tree.tests["N.PilotTests.Scroll"];
			assert.equal(entry.file, "app/BibleOnSite.Tests.MobileE2E/PilotTests.cs");
			assert.deepEqual(entry.files, ["app/BibleOnSite/Pages/PerekPage.xaml.cs"]);
			assert.deepEqual(entry.sessions, ["s9"]);
			assert.deepEqual(entry.automationIds, []);
			assert.equal(entry.outcome, "passed");
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("shared, unmeasured and error attributions create no per-test entries", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const tree = collect(repo, artifacts, execTree(
				{
					"N.PilotTests.Scroll": execEntry(
						"N.PilotTests.Scroll",
						["app/BibleOnSite/Pages/PerekPage.xaml.cs"],
						{ attribution: "shared", measured: false },
					),
					"N.PilotTests.Ghost": execEntry(
						"N.PilotTests.Ghost",
						["app/BibleOnSite/X.cs"],
						{ attribution: "unmeasured", measured: false },
					),
					"N.PilotTests.Broken": execEntry(
						"N.PilotTests.Broken",
						["app/BibleOnSite/Y.cs"],
						{ attribution: "error", measured: false, coverageError: "pull failed" },
					),
				},
				{
					shared: {
						reasons: ["app-startup"],
						nodes: [],
						files: ["app/BibleOnSite/App.xaml.cs"],
					},
				},
			));
			assert.equal(tree.tests["N.PilotTests.Scroll"], undefined);
			assert.equal(tree.tests["N.PilotTests.Ghost"], undefined);
			assert.equal(tree.tests["N.PilotTests.Broken"], undefined);
			assert.deepEqual(tree.sharedFiles, ["app/BibleOnSite/App.xaml.cs"]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("exec member evidence unions into the entry and surfaces memberGaps", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const file = "app/BibleOnSite/Pages/PerekPage.xaml.cs";
			const tree = collect(repo, artifacts, execTree(
				{
					"N.PilotTests.Startup": execEntry(
						"N.PilotTests.Startup",
						[file],
						{ nodes: ["method:N.PerekPage.Load", "method:N.PerekPage.Gap"] },
					),
				},
				{
					nodes: {
						"method:N.PerekPage.Load": {
							kind: "method",
							decl: "N.PerekPage.Load",
							file,
							span: [10, 20],
							member: "N.PerekPage.Load#abc123def456",
							memberType: "N.PerekPage",
							parents: ["type:N.PerekPage"],
						},
						"method:N.PerekPage.Gap": {
							kind: "method",
							decl: "N.PerekPage.Gap",
							file,
							span: [1, 2],
							parents: ["type:N.PerekPage"],
						},
						"type:N.PerekPage": {
							kind: "type",
							decl: "N.PerekPage",
							parents: [`file:${file}`],
						},
					},
				},
			));
			const entry = tree.tests["N.PilotTests.Startup"];
			// The member-qualified file key exists even though some nodes
			// mapped to nothing — and the unmapped node records its type gap.
			assert.deepEqual(entry.members, { [file]: ["N.PerekPage.Load#abc123def456"] });
			assert.deepEqual(tree.memberGaps, { [file]: ["N.PerekPage"] });
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("missing exec evidence leaves the output identical", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			assert.deepEqual(
				deterministic(collect(repo, artifacts, undefined)),
				deterministic(collect(repo, artifacts, undefined)),
			);
			// An empty (compatible) exec tree merges nothing.
			assert.deepEqual(
				deterministic(collect(repo, artifacts, execTree({}))),
				deterministic(collect(repo, artifacts, undefined)),
			);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("incompatible exec trees are ignored, not applied", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const baseline = deterministic(collect(repo, artifacts, undefined));
			for (const bad of [
				execTree({}, { platform: "ios" }),
				execTree({}, { suite: "other-suite" }),
				execTree({}, { snapshotSha: "3333333333333333333333333333333333333333" }),
				execTree({}, { schemaVersion: 2 }),
			]) {
				assert.deepEqual(deterministic(collect(repo, artifacts, bad)), baseline);
			}
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("an incomplete exec tree keeps the merged tree incomplete", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const tree = collect(
				repo,
				artifacts,
				execTree({}, { complete: false }),
			);
			assert.equal(tree.complete, false);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("a failed exec outcome survives the union", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const tree = collect(repo, artifacts, execTree({
				"N.PilotTests.Startup": execEntry("N.PilotTests.Startup", [], {
					outcome: "failed",
				}),
			}));
			assert.equal(tree.tests["N.PilotTests.Startup"].outcome, "failed");
			// The automation file set is untouched by the union.
			assert.deepEqual(tree.tests["N.PilotTests.Startup"].files, [
				"app/BibleOnSite/Pages/PerekPage.xaml",
			]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("exec entries for undiscovered tests join as unmatched evidence", () => {
		const { repo, artifacts } = makeCollectRepo();
		try {
			const tree = collect(repo, artifacts, execTree(
				{
					"N.Elsewhere.Moved": execEntry("N.Elsewhere.Moved", [
						"app/BibleOnSite/Pages/PerekPage.xaml.cs",
					]),
				},
				{ unmatchedEvidence: ["Ghost-passed.json"] },
			));
			const entry = tree.tests["N.Elsewhere.Moved"];
			assert.equal(entry.file, undefined);
			assert.deepEqual(entry.files, ["app/BibleOnSite/Pages/PerekPage.xaml.cs"]);
			assert.deepEqual(tree.unmatchedEvidence, [
				"Ghost-passed.json",
				"N.Elsewhere.Moved",
			]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe("collect-appium --exec-tree CLI", () => {
	const IMPACT = fileURLToPath(new URL("./e2e-impact.ts", import.meta.url));
	const REAL_TEST =
		"BibleOnSite.Tests.MobileE2E.PerekPilotTests.StartupDisplaysPackagedPesukimAndUsableBottomNavigation";

	const runCollect = (artifacts: string, extra: string[]) =>
		spawnSync(
			process.execPath,
			[
				IMPACT,
				"collect-appium",
				"--suite", "app/mobile-e2e",
				"--platform", "android",
				"--artifacts", artifacts,
				"--snapshot-sha", SNAPSHOT,
				"--out", join(artifacts, "coverage-tree.json"),
				...extra,
			],
			{ encoding: "utf8" },
		);

	const readTree = (artifacts: string): CoverageTree =>
		JSON.parse(readFileSync(join(artifacts, "coverage-tree.json"), "utf8"));

	test("a compatible exec tree merges; missing or incompatible ones warn and change nothing", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-impact-cli-"));
		try {
			const artifacts = join(dir, "artifacts");
			mkdirSync(join(artifacts, "coverage-evidence"), { recursive: true });
			writeFileSync(
				join(artifacts, "coverage-evidence", "Startup-passed.json"),
				JSON.stringify({
					test: REAL_TEST,
					platform: "android",
					outcome: "passed",
					sessions: ["s1"],
					automationIds: [],
				}),
			);
			const exec = join(dir, "exec-coverage-tree.json");
			writeFileSync(
				exec,
				JSON.stringify(
					execTree(
						{
							[REAL_TEST]: execEntry(REAL_TEST, [
								"app/BibleOnSite/App.xaml.cs",
							], { sessions: ["e1"] }),
						},
						{
							shared: {
								reasons: [],
								nodes: [],
								files: ["app/BibleOnSite/Services/Startup.cs"],
							},
						},
					),
				),
			);

			// Automation-id only — the reference output.
			const plain = runCollect(artifacts, []);
			assert.equal(plain.status, 0, plain.stderr);
			const baseline = deterministic(readTree(artifacts));

			// Compatible tree: per-test files union, sharedFiles lands.
			const merged = runCollect(artifacts, ["--exec-tree", exec]);
			assert.equal(merged.status, 0, merged.stderr);
			assert.match(merged.stdout, /exec tree: 1 per-test entries/);
			const tree = readTree(artifacts);
			const entry = tree.tests[REAL_TEST];
			assert.ok(entry.files.includes("app/BibleOnSite/App.xaml.cs"));
			assert.ok(entry.sessions.includes("e1"));
			assert.ok(entry.sessions.includes("s1"));
			assert.deepEqual(tree.sharedFiles, [
				"app/BibleOnSite/Services/Startup.cs",
			]);

			// Missing path: warned, output identical to automation-id only.
			const missing = runCollect(artifacts, [
				"--exec-tree", join(dir, "absent.json"),
			]);
			assert.equal(missing.status, 0, missing.stderr);
			assert.match(missing.stderr, /exec tree ignored: .* does not exist/);
			assert.deepEqual(deterministic(readTree(artifacts)), baseline);

			// Wrong snapshot: diagnosed and skipped, output identical.
			const wrongSha = join(dir, "exec-old.json");
			writeFileSync(
				wrongSha,
				JSON.stringify(execTree({}, { snapshotSha: "2".repeat(40) })),
			);
			const incompatible = runCollect(artifacts, ["--exec-tree", wrongSha]);
			assert.equal(incompatible.status, 0, incompatible.stderr);
			assert.match(incompatible.stderr, /exec tree .* ignored: snapshotSha/);
			assert.deepEqual(deterministic(readTree(artifacts)), baseline);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("selectTests shared coverage", () => {
	test("a changed shared-covered file widens to the full suite", () => {
		const manifest = select({
			baseline: {
				kind: "ok",
				tree: makeTree({ sharedFiles: ["app/BibleOnSite/Services/Startup.cs"] }),
			},
			changedFiles: [{ path: "app/BibleOnSite/Services/Startup.cs", status: "modified" }],
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(
			manifest.fallbacks.some((f) =>
				f.startsWith("shared-coverage:app/BibleOnSite/Services/Startup.cs"),
			),
		);
	});

	test("shared coverage widens even where a test covers the file", () => {
		// Search provably covers FloatingSearchBar.xaml, but the file also
		// carries unattributable exec hits — those can only widen.
		const manifest = select({
			baseline: {
				kind: "ok",
				tree: makeTree({
					sharedFiles: ["app/BibleOnSite/Controls/FloatingSearchBar.xaml"],
				}),
			},
			changedFiles: [
				{ path: "app/BibleOnSite/Controls/FloatingSearchBar.xaml", status: "modified" },
			],
		});
		assert.equal(manifest.selectAll, true);
	});

	test("a unit-mate of a shared file widens too", () => {
		// PerekPage.xaml.cs shares unit PerekPage with the changed xaml.
		const manifest = select({
			baseline: {
				kind: "ok",
				tree: makeTree({
					sharedFiles: ["app/BibleOnSite/Pages/PerekPage.xaml.cs"],
				}),
			},
			changedFiles: [
				{ path: "app/BibleOnSite/Pages/PerekPage.xaml", status: "modified" },
			],
		});
		assert.equal(manifest.selectAll, true);
		assert.ok(manifest.fallbacks.some((f) => f.startsWith("shared-coverage:")));
	});

	test("a tree without shared coverage keeps per-test narrowing", () => {
		const manifest = select({
			changedFiles: [
				{ path: "app/BibleOnSite/Controls/FloatingSearchBar.xaml", status: "modified" },
			],
		});
		assert.equal(manifest.selectAll, false);
		assert.deepEqual(selectedIds(manifest), [
			"Suite.Pilot.Search",
			"Suite.Pilot.Startup",
		]);
	});
});
