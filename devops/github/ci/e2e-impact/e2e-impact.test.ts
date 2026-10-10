import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
