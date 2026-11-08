/**
 * Unit tests for the exec-coverage-tree extraction layer (#2085).
 * Deterministic: no filesystem (beyond tmp-dir loader checks), no clocks —
 * `collectedAtUtc` is injected.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
	loadDumps,
	loadEvidenceRecords,
	loadJunit,
	loadTrx,
	splitFileBase,
	type CoverageDump,
	type TestRunRecord,
} from "./evidence.ts";
import {
	buildIndex,
	envFingerprint,
	extractTree,
	mergeTrees,
	normalizeSourcePath,
	type ExtractInput,
} from "./extract.ts";
import {
	canonicalize,
	type ExecCoverageTree,
	validateExecTree,
} from "./model.ts";
import { parseOpenCover } from "./opencover.ts";
import {
	execSelectorView,
	execTreeCompatible,
	loadExecTree,
} from "./to-selector-tree.ts";
import { parseXml, XmlParseError } from "./xml.ts";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_OLD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// ── Fixtures ────────────────────────────────────────────────────────────

const TEMPLATE_XML = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession>
	<Modules>
		<Module hash="DEADBEEF" skippedDueTo="SkippedDueTo_Declared">
			<ModulePath>D:\\a\\bos\\bos\\app\\BibleOnSite\\bin\\BibleOnSite.dll</ModulePath>
			<ModuleName>BibleOnSite</ModuleName>
			<Files>
				<File uid="1" fullPath="D:\\a\\bos\\bos\\app\\BibleOnSite\\App.xaml.cs" />
				<File uid="2" fullPath="D:\\a\\bos\\bos\\app\\BibleOnSite\\PerekPage.xaml.cs" />
				<File uid="3" fullPath="/outside/checkout/Nowhere.cs" />
			</Files>
			<Classes>
				<Class>
					<FullName>BibleOnSite.App</FullName>
					<Methods>
						<Method visited="false" isConstructor="true" isStatic="false">
							<MetadataToken>0x06000001</MetadataToken>
							<Name>.ctor</Name>
							<FileRef uid="1" />
							<SequencePoints>
								<SequencePoint vc="0" uspid="1" ordinal="0" sl="10" sc="5" el="12" ec="60" fileid="1" />
								<SequencePoint vc="0" uspid="2" ordinal="1" sl="14" sc="5" el="14" ec="60" fileid="1" />
							</SequencePoints>
							<BranchPoints>
								<BranchPoint vc="0" uspid="100" ordinal="0" path="0" offset="10" sl="11" fileid="1" />
							</BranchPoints>
						</Method>
						<Method visited="false" isConstructor="false" isStatic="false">
							<MetadataToken>0x06000002</MetadataToken>
							<Name>OnStart</Name>
							<FileRef uid="1" />
							<SequencePoints>
								<SequencePoint vc="0" uspid="3" ordinal="0" sl="20" sc="5" el="24" ec="60" fileid="1" />
							</SequencePoints>
						</Method>
					</Methods>
				</Class>
				<Class>
					<FullName>BibleOnSite.PerekPage</FullName>
					<Methods>
						<Method visited="false" isConstructor="false" isStatic="false">
							<MetadataToken>0x06000003</MetadataToken>
							<Name>LoadPerek</Name>
							<FileRef uid="2" />
							<SequencePoints>
								<SequencePoint vc="0" uspid="4" ordinal="0" sl="30" sc="5" el="30" ec="60" fileid="2" />
								<SequencePoint vc="0" uspid="5" ordinal="1" sl="31" sc="5" el="35" ec="60" fileid="2" />
								<SequencePoint vc="0" uspid="6" ordinal="2" sl="40" sc="5" el="41" ec="10" fileid="3" />
							</SequencePoints>
							<BranchPoints>
								<BranchPoint vc="0" uspid="101" ordinal="0" path="0" offset="20" sl="32" fileid="2" />
							</BranchPoints>
						</Method>
					</Methods>
				</Class>
				<Class>
					<FullName>BibleOnSite.Overloaded</FullName>
					<Methods>
						<Method visited="false" isConstructor="false" isStatic="false">
							<MetadataToken>0x0600000A</MetadataToken>
							<Name>Pick</Name>
							<SequencePoints>
								<SequencePoint vc="0" uspid="7" ordinal="0" sl="50" sc="5" el="50" ec="60" fileid="2" />
							</SequencePoints>
						</Method>
						<Method visited="false" isConstructor="false" isStatic="false">
							<MetadataToken>0x0600000B</MetadataToken>
							<Name>Pick</Name>
							<SequencePoints>
								<SequencePoint vc="0" uspid="8" ordinal="0" sl="60" sc="5" el="60" ec="60" fileid="2" />
							</SequencePoints>
						</Method>
					</Methods>
				</Class>
			</Classes>
		</Module>
	</Modules>
</CoverageSession>`;

/** uspid | int.MinValue — the recorder's branch key encoding. */
const branchKey = (uspid: number) => uspid | -2147483648;
const tokenKey = (token: number) => token;

const dump = (fileBase: string, outcome: string, modules: Record<string, Record<string, number>>): CoverageDump => ({
	name: `${fileBase}-${outcome}.json`,
	fileBase,
	outcome,
	platform: "android",
	collectedUtc: "2025-06-01T00:00:00Z",
	modules: new Map(Object.entries(modules).map(([hash, points]) => [
		hash,
		new Map(Object.entries(points).map(([key, count]) => [Number(key), count])),
	])),
});

const record = (
	id: string,
	outcome: string,
	sessions: string[] = [],
): TestRunRecord => ({
	id,
	outcome,
	sessions,
	startedUtc: "2025-06-01T00:00:00Z",
	endedUtc: "2025-06-01T00:00:40Z",
	cases: [],
	source: "evidence",
});

const baseInput = (overrides: Partial<ExtractInput> = {}): ExtractInput => ({
	suite: "app-mobile-e2e",
	platform: "android",
	configuration: "Debug",
	snapshotSha: SHA,
	collector: "altcover-app-dump",
	collectorVersion: "9.0.145",
	complete: true,
	cover: parseOpenCover(parseXml(TEMPLATE_XML)),
	dumps: [],
	dumpErrors: [],
	runRecords: [],
	recordByStem: new Map(),
	fqnByMethod: new Map(),
	sourceRoot: "app/BibleOnSite",
	stripPrefixes: [],
	discoveredIds: [],
	collectedAtUtc: "2025-06-01T12:00:00Z",
	...overrides,
});

// ── xml ──────────────────────────────────────────────────────────────────

describe("parseXml", () => {
	test("parses elements, attributes, text and self-closing tags", () => {
		const root = parseXml(`<root a="1" b='two'><kid>hi</kid><empty/></root>`);
		assert.equal(root.name, "root");
		assert.equal(root.attrs.a, "1");
		assert.equal(root.attrs.b, "two");
		assert.equal(root.children.length, 2);
		assert.equal(root.children[0].text, "hi");
	});
	test("decodes entities in text and attribute values", () => {
		const root = parseXml(`<r a="x&lt;y&quot;&#65;">a &amp; b</r>`);
		assert.equal(root.attrs.a, `x<y"A`);
		assert.equal(root.text, "a & b");
	});
	test("skips comments, PI, doctype and preserves CDATA", () => {
		const root = parseXml(
			`<?xml version="1.0"?><!-- c --><!DOCTYPE r><r><![CDATA[<raw>]]></r>`,
		);
		assert.equal(root.text, "<raw>");
	});
	test("rejects malformed input with an offset", () => {
		assert.throws(() => parseXml(`<a></b>`), XmlParseError);
		assert.throws(() => parseXml(`<a>`), /Unclosed/);
		assert.throws(() => parseXml(``), /no root/);
	});
});

// ── OpenCover parsing ────────────────────────────────────────────────────

describe("parseOpenCover", () => {
	test("indexes modules, files, methods and point keys", () => {
		const cover = parseOpenCover(parseXml(TEMPLATE_XML));
		assert.equal(cover.modules.length, 1);
		const module = cover.modules[0];
		assert.equal(module.hash, "DEADBEEF");
		assert.equal(module.name, "BibleOnSite");
		assert.equal(module.files.get("1"), "D:\\a\\bos\\bos\\app\\BibleOnSite\\App.xaml.cs");
		assert.equal(module.methods.length, 5);
		const ctor = module.methods[0];
		assert.equal(ctor.className, "BibleOnSite.App");
		assert.equal(ctor.name, ".ctor");
		assert.equal(ctor.tokenKey, 0x06000001);
		assert.equal(ctor.sequencePoints.length, 2);
		assert.equal(ctor.branchPoints.length, 1);
	});
});

// ── Path normalization ───────────────────────────────────────────────────

describe("normalizeSourcePath", () => {
	test("anchors a build-machine path at the source root", () => {
		const file = normalizeSourcePath(
			"D:\\a\\bos\\bos\\app\\BibleOnSite\\App.xaml.cs",
			"app/BibleOnSite",
			[],
		);
		assert.deepEqual(file, { path: "app/BibleOnSite/App.xaml.cs", external: false });
	});
	test("strip prefixes win over anchoring", () => {
		const file = normalizeSourcePath(
			"/home/runner/work/bos/bos/app/BibleOnSite/X.cs",
			"app/BibleOnSite",
			["/home/runner/work/bos/bos"],
		);
		assert.deepEqual(file, { path: "app/BibleOnSite/X.cs", external: false });
	});
	test("unmappable paths stay raw and flag external", () => {
		const file = normalizeSourcePath("/nuget/lib/x.cs", "app/BibleOnSite", []);
		assert.deepEqual(file, { path: "/nuget/lib/x.cs", external: true });
	});
});

// ── Per-test extraction ──────────────────────────────────────────────────

describe("extractTree", () => {
	const evidence = new Map([
		["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed", ["s-1"])],
		["Beta-passed", record("Ns.BetaTests.Beta", "passed")],
	]);
	const records = [...evidence.values()];

	test("attributes dump hits to decl nodes and repo files", () => {
		const tree = extractTree(
			baseInput({
				dumps: [
					dump("Alpha", "passed", {
						DEADBEEF: { "1": 4, "2": 1, [String(branchKey(100))]: 2, [String(tokenKey(0x06000001))]: 1 },
					}),
					dump("Beta", "passed", { DEADBEEF: { "4": 2, [String(branchKey(101))]: 1, "999": 3 } }),
				],
				recordByStem: evidence,
				runRecords: records,
			}),
		);
		assert.equal(tree.kind, "exec-coverage-tree");
		assert.equal(tree.platform, "android");
		assert.equal(tree.snapshotSha, SHA);
		const alpha = tree.tests["Ns.AlphaTests.Alpha"];
		assert.equal(alpha.attribution, "per-test");
		assert.equal(alpha.measured, true);
		assert.equal(alpha.evidenceSha, SHA);
		assert.deepEqual(alpha.sessions, ["s-1"]);
		assert.deepEqual(alpha.nodes, ["method:BibleOnSite.App..ctor"]);
		assert.deepEqual(alpha.files, ["app/BibleOnSite/App.xaml.cs"]);
		assert.deepEqual(alpha.visits, { sequence: 5, branch: 2, methodEntries: 1 });
		const node = tree.nodes["method:BibleOnSite.App..ctor"];
		assert.equal(node.kind, "method");
		assert.equal(node.decl, "BibleOnSite.App..ctor");
		assert.equal(node.token, "0x06000001");
		assert.equal(node.file, "app/BibleOnSite/App.xaml.cs");
		assert.deepEqual(node.span, [10, 14]);
		assert.deepEqual(node.parents, ["type:BibleOnSite.App"]);
		assert.equal(tree.nodes["type:BibleOnSite.App"].kind, "type");
		assert.equal(tree.nodes["file:app/BibleOnSite/App.xaml.cs"].kind, "file");
		// Unknown visit keys are counted, never applied.
		assert.equal(tree.diagnostics.unknownPointIds, 1);
		assert.equal(tree.diagnostics.attribution, "per-test");
	});

	test("external files stay raw on the node and flag external", () => {
		const tree = extractTree(
			baseInput({ dumps: [dump("Beta", "passed", { DEADBEEF: { "6": 1 } })] }),
		);
		const node = tree.nodes["method:BibleOnSite.PerekPage.LoadPerek"];
		assert.equal(node.external, true);
		assert.deepEqual(node.files?.sort(), [
			"/outside/checkout/Nowhere.cs",
			"app/BibleOnSite/PerekPage.xaml.cs",
		].sort());
	});

	test("startup and unmatched dumps join the shared bucket", () => {
		const tree = extractTree(
			baseInput({
				dumps: [
					dump("_startup", "passed", { DEADBEEF: { "3": 7 } }),
					dump("Ghost", "passed", { DEADBEEF: { "4": 1 } }),
				],
				recordByStem: evidence,
			}),
		);
		assert.deepEqual(tree.tests, {});
		assert.deepEqual(tree.unmatchedEvidence, ["Ghost-passed.json"]);
		assert.deepEqual(tree.shared.nodes.sort(), [
			"method:BibleOnSite.App.OnStart",
			"method:BibleOnSite.PerekPage.LoadPerek",
		]);
		assert.ok(tree.shared.reasons.includes("app-startup"));
		assert.ok(tree.shared.reasons.some((r) => r.startsWith("unmatched-dump:")));
	});

	test("incompatible dumps are diagnosed, never applied", () => {
		const tree = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { OTHERHASH: { "1": 9 } })],
				recordByStem: evidence,
				runRecords: records,
			}),
		);
		assert.deepEqual(tree.diagnostics.incompatibleDumps, ["Alpha-passed.json"]);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].attribution, "shared"); // shared mode engaged
	});

	test("coverage-error dumps produce error entries that stay unmeasured", () => {
		const tree = extractTree(
			baseInput({
				dumpErrors: [{ fileBase: "Alpha", outcome: "passed", message: "adb forward failed" }],
				recordByStem: evidence,
				runRecords: records,
			}),
		);
		const alpha = tree.tests["Ns.AlphaTests.Alpha"];
		// Error entries are overwritten by shared-mode coverage only with the
		// error preserved — the pull failure stays diagnosable.
		assert.equal(alpha.coverageError, "adb forward failed");
		assert.equal(alpha.attribution, "shared");
	});

	test("tests without dumps stay unmeasured when a split exists", () => {
		const tree = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1 } })],
				recordByStem: evidence,
				runRecords: records,
			}),
		);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].attribution, "per-test");
		const beta = tree.tests["Ns.BetaTests.Beta"];
		assert.equal(beta.attribution, "unmeasured");
		assert.equal(beta.measured, false);
		assert.deepEqual(tree.diagnostics.missingDumps, ["Ns.BetaTests.Beta"]);
	});

	test("a known module with zero visits is measured without claiming code hits", () => {
		const tree = extractTree(baseInput({
			dumps: [dump("Alpha", "passed", { DEADBEEF: {} })],
			recordByStem: new Map([["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed")]]),
		}));
		const alpha = tree.tests["Ns.AlphaTests.Alpha"];
		assert.equal(alpha.measured, true);
		assert.equal(alpha.attribution, "per-test");
		assert.deepEqual(alpha.nodes, []);
		assert.deepEqual(alpha.files, []);
		assert.deepEqual(alpha.visits, { sequence: 0, branch: 0, methodEntries: 0 });
		assert.deepEqual(tree.diagnostics.incompatibleDumps, []);
		assert.deepEqual(tree.diagnostics.missingDumps, []);
	});
	test("overloaded decls get a deterministic token suffix", () => {
		const tree = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "7": 1, "8": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const alpha = tree.tests["Ns.AlphaTests.Alpha"];
		assert.deepEqual(alpha.nodes, [
			"method:BibleOnSite.Overloaded.Pick#0x0600000A",
			"method:BibleOnSite.Overloaded.Pick#0x0600000B",
		]);
	});
});

// ── Identity hashing & determinism ───────────────────────────────────────

describe("identity", () => {
	test("envFingerprint is stable and build-specific", () => {
		const index = buildIndex(parseOpenCover(parseXml(TEMPLATE_XML)), "app/BibleOnSite", []);
		const fp1 = envFingerprint(
			{ suite: "app-mobile-e2e", platform: "android", collector: "altcover-app-dump", collectorVersion: "9.0.145" },
			index.modules,
		);
		const fp2 = envFingerprint(
			{ suite: "app-mobile-e2e", platform: "android", collector: "altcover-app-dump", collectorVersion: "9.0.145" },
			index.modules,
		);
		assert.equal(fp1, fp2);
		assert.match(fp1, /^[0-9a-f]{64}$/);
		const otherPlatform = envFingerprint(
			{ suite: "app-mobile-e2e", platform: "ios", collector: "altcover-app-dump", collectorVersion: "9.0.145" },
			index.modules,
		);
		assert.notEqual(fp1, otherPlatform);
	});

	test("identical inputs produce identical trees (except collectedAtUtc)", () => {
		const input = baseInput({
			dumps: [
				dump("Alpha", "passed", { DEADBEEF: { "2": 1, "1": 2 } }),
				dump("Beta", "passed", { DEADBEEF: { "4": 1 } }),
			],
		});
		const first = extractTree(input);
		const second = extractTree({ ...input, dumps: [...input.dumps].reverse() });
		assert.equal(canonicalize(first), canonicalize(second));
	});

	test("evidence records and TRX resolve the same FQN identity", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-ct-"));
		try {
			mkdirSync(join(dir, "coverage-evidence"), { recursive: true });
			writeFileSync(
				join(dir, "coverage-evidence", "Alpha-passed.json"),
				JSON.stringify({
					test: "Ns.AlphaTests.Alpha",
					platform: "android",
					outcome: "passed",
					sessions: ["s-9"],
					automationIds: ["PerekTitle"],
					startedUtc: "2025-06-01T00:00:00Z",
					endedUtc: "2025-06-01T00:00:30Z",
				}),
			);
			const evidence = loadEvidenceRecords(join(dir, "coverage-evidence"));
			assert.equal(evidence.byStem.get("Alpha-passed")?.id, "Ns.AlphaTests.Alpha");
			assert.deepEqual(evidence.byStem.get("Alpha-passed")?.sessions, ["s-9"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── Merge/update semantics ───────────────────────────────────────────────

describe("mergeTrees", () => {
	const evidence = new Map([
		["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed")],
		["Gamma-passed", record("Ns.GammaTests.Gamma", "passed")],
	]);
	const runTree = () =>
		extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 9 } })],
				recordByStem: evidence,
				runRecords: [...evidence.values()],
			}),
		);

	test("only measured entries replace baseline evidence", () => {
		const baselineEvidence = new Map([
			["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed")],
			["Beta-passed", record("Ns.BetaTests.Beta", "passed")],
		]);
		const baseline = extractTree(
			baseInput({
				snapshotSha: SHA_OLD,
				dumps: [
					dump("Alpha", "passed", { DEADBEEF: { "2": 1 } }),
					dump("Beta", "passed", { DEADBEEF: { "4": 1 } }),
				],
				recordByStem: baselineEvidence,
			}),
		);
		const { tree } = mergeTrees(runTree(), baseline, {
			discoveredIds: ["Ns.AlphaTests.Alpha", "Ns.GammaTests.Gamma", "Ns.BetaTests.Beta"],
		});
		// Alpha got fresh evidence; Beta (baseline-only) keeps the old sha.
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].evidenceSha, SHA);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].measured, true);
		const beta = tree.tests["Ns.BetaTests.Beta"];
		assert.equal(beta.evidenceSha, SHA_OLD);
		assert.equal(beta.measured, false);
		assert.equal(beta.stale, undefined);
		// Gamma ran but produced no dump → unmeasured in run; baseline had no
		// Gamma entry, so the explicit gap survives the merge.
		assert.equal(tree.tests["Ns.GammaTests.Gamma"].measured, false);
		assert.equal(tree.tests["Ns.GammaTests.Gamma"].attribution, "unmeasured");
	});

	test("a void run entry never overwrites measured baseline evidence", () => {
		const baseline = extractTree(
			baseInput({
				snapshotSha: SHA_OLD,
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 5, "2": 5 } })],
				recordByStem: evidence,
			}),
		);
		const run = extractTree(
			baseInput({
				dumpErrors: [{ fileBase: "Alpha", outcome: "passed", message: "boom" }],
				recordByStem: evidence,
				runRecords: [evidence.get("Alpha-passed")!],
			}),
		);
		const { tree } = mergeTrees(run, baseline, {
			discoveredIds: ["Ns.AlphaTests.Alpha"],
		});
		// The baseline's measured nodes survive the errored pull.
		assert.deepEqual(tree.tests["Ns.AlphaTests.Alpha"].nodes, [
			"method:BibleOnSite.App..ctor",
		]);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].evidenceSha, SHA_OLD);
	});

	test("undiscovered baseline entries are kept but flagged stale", () => {
		const baseline = extractTree(
			baseInput({
				snapshotSha: SHA_OLD,
				dumps: [dump("Deleted", "passed", { DEADBEEF: { "1": 1 } })],
				recordByStem: new Map([["Deleted-passed", record("Ns.OldTests.Deleted", "passed")]]),
			}),
		);
		const { tree } = mergeTrees(runTree(), baseline, {
			discoveredIds: ["Ns.AlphaTests.Alpha"],
		});
		const deleted = tree.tests["Ns.OldTests.Deleted"];
		assert.equal(deleted.stale, true);
		assert.equal(deleted.measured, false);
	});

	test("a mismatched platform baseline never merges", () => {
		const iosBaseline = extractTree(baseInput({ platform: "ios", snapshotSha: SHA_OLD }));
		const { tree, warnings } = mergeTrees(runTree(), iosBaseline);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].evidenceSha, SHA);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /platform ios/);
	});
});

// ── Platform separation ──────────────────────────────────────────────────

describe("platform separation", () => {
	test("trees carry one platform and validate rejects a mismatch", () => {
		const android = extractTree(baseInput({ platform: "android" }));
		const ios = extractTree(baseInput({ platform: "ios" }));
		assert.equal(android.platform, "android");
		assert.equal(ios.platform, "ios");
		assert.notEqual(android.envFingerprint, ios.envFingerprint);
		assert.equal(
			validateExecTree(android, { suite: "app-mobile-e2e", platform: "android" }),
			null,
		);
		assert.match(
			validateExecTree(ios, { suite: "app-mobile-e2e", platform: "android" }) ?? "",
			/platform ios/,
		);
	});
});

// ── Shared mode ──────────────────────────────────────────────────────────

describe("shared mode", () => {
	test("vc-covered decls attribute to every executed test", () => {
		const applied = TEMPLATE_XML
			.replace('vc="0" uspid="1"', 'vc="3" uspid="1"')
			.replace('vc="0" uspid="4"', 'vc="7" uspid="4"');
		const tree = extractTree(
			baseInput({
				cover: parseOpenCover(parseXml(applied)),
				runRecords: [record("Ns.AlphaTests.Alpha", "passed"), record("Ns.BetaTests.Beta", "failed")],
			}),
		);
		assert.equal(tree.diagnostics.attribution, "shared");
		for (const id of ["Ns.AlphaTests.Alpha", "Ns.BetaTests.Beta"]) {
			const entry = tree.tests[id];
			assert.equal(entry.attribution, "shared");
			assert.equal(entry.measured, true);
			assert.deepEqual(entry.nodes, [
				"method:BibleOnSite.App..ctor",
				"method:BibleOnSite.PerekPage.LoadPerek",
			]);
		}
		assert.ok(tree.shared.reasons.includes("whole-suite-report"));
	});

	test("skipped cases never claim the shared coverage", () => {
		const applied = TEMPLATE_XML
			.replace('vc="0" uspid="1"', 'vc="3" uspid="1"')
			.replace('vc="0" uspid="4"', 'vc="7" uspid="4"');
		const tree = extractTree(
			baseInput({
				cover: parseOpenCover(parseXml(applied)),
				runRecords: [
					record("Ns.AlphaTests.Alpha", "passed"),
					record("Ns.BetaTests.Beta", "skipped"),
					record("Ns.GammaTests.Gamma", "notexecuted"),
				],
			}),
		);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].attribution, "shared");
		// A case the run skipped (e.g. another iOS shard's assignment, #2263)
		// keeps the unmeasured placeholder — shared coverage would fake a run.
		for (const id of ["Ns.BetaTests.Beta", "Ns.GammaTests.Gamma"]) {
			assert.equal(tree.tests[id].attribution, "unmeasured");
			assert.equal(tree.tests[id].measured, false);
			assert.deepEqual(tree.tests[id].nodes, []);
		}
	});

	test("discovered tests stand in when no run records exist", () => {
		const tree = extractTree(
			baseInput({ discoveredIds: ["Ns.Only.One"] }),
		);
		assert.equal(tree.tests["Ns.Only.One"].attribution, "shared");
	});
});

// ── Loaders (filesystem fixtures) ────────────────────────────────────────

describe("loaders", () => {
	test("loadDumps reads records and coverage-error diagnostics", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-ct-"));
		try {
			const dumpsDir = join(dir, "app-coverage");
			mkdirSync(dumpsDir, { recursive: true });
			writeFileSync(
				join(dumpsDir, "Alpha-passed.json"),
				JSON.stringify({
					kind: "app-e2e-coverage-dump/1",
					test: "Alpha",
					platform: "android",
					outcome: "passed",
					snapshot: { format: "altcover-visits/1", modules: { H: { "1": 2 } } },
				}),
			);
			writeFileSync(join(dumpsDir, "Beta-failed.json.coverage-error.txt"), "HttpRequestException: unreachable\nstack");
			writeFileSync(join(dumpsDir, "notes.txt"), "ignored");
			const { dumps, errors } = loadDumps(dumpsDir);
			assert.equal(dumps.length, 1);
			assert.equal(dumps[0].fileBase, "Alpha");
			assert.equal(dumps[0].modules.get("H")?.get(1), 2);
			assert.equal(errors.length, 1);
			assert.deepEqual(splitFileBase("Beta-failed"), { fileBase: "Beta", outcome: "failed" });
			assert.equal(errors[0].message, "HttpRequestException: unreachable");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("loadTrx resolves FQNs, outcomes, times and theory cases", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-ct-"));
		try {
			const trx = join(dir, "mobile-e2e.trx");
			writeFileSync(
				trx,
				`<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
					<TestDefinitions>
						<UnitTest name="Ns.A.Alpha" id="t1"><TestMethod className="Ns.A" name="Alpha" codeBase="x" /></UnitTest>
						<UnitTest name="Ns.A.Param" id="t2"><TestMethod className="Ns.A" name="Param" codeBase="x" /></UnitTest>
					</TestDefinitions>
					<Results>
						<UnitTestResult testId="t1" testName="Ns.A.Alpha" outcome="Passed" startTime="2025-06-01T00:00:00Z" endTime="2025-06-01T00:00:11Z" />
						<UnitTestResult testId="t2" testName="Ns.A.Param(1)" outcome="Failed" />
						<UnitTestResult testId="t2" testName="Ns.A.Param(2)" outcome="Passed" />
					</Results>
				</TestRun>`,
			);
			const records = loadTrx(trx);
			assert.equal(records.length, 2);
			const param = records.find((r) => r.id === "Ns.A.Param");
			assert.equal(param?.outcome, "failed");
			assert.deepEqual(param?.cases, ["(1)", "(2)"]);
			assert.equal(records[0].startedUtc, "2025-06-01T00:00:00Z");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("loadJunit lists executed tests as a fallback mapping", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-ct-"));
		try {
			const junit = join(dir, "mobile-e2e.xml");
			writeFileSync(
				junit,
				`<testsuite name="m"><testcase classname="Ns.A" name="Alpha" time="1"/><testcase classname="Ns.B" name="Beta" time="2"><failure/></testcase></testsuite>`,
			);
			const records = loadJunit(junit);
			assert.deepEqual(
				records.map((r) => `${r.id}:${r.outcome}`).sort(),
				["Ns.A.Alpha:passed", "Ns.B.Beta:failed"],
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

test("MTP fully qualified JUnit names join their existing evidence without duplicate test identities", () => {
	const dir = mkdtempSync(join(tmpdir(), "e2e-ct-"));
	try {
		const junit = join(dir, "mobile-e2e.xml");
		writeFileSync(junit,
			`<testsuite><testcase classname="Ns.A" name="Ns.A.Alpha"/><testcase className="Ns.B" name="Ns.B.Beta"><failure/></testcase></testsuite>`);
		const records = loadJunit(junit);
		assert.deepEqual(records.map((entry) => entry.id), ["Ns.A.Alpha", "Ns.B.Beta"]);
		const evidence = [record("Ns.A.Alpha", "passed", ["s-1"]), record("Ns.B.Beta", "passed", ["s-1"])];
		assert.deepEqual(records.map((entry) => entry.id), evidence.map((entry) => entry.id));
		assert.equal(new Set([...evidence, ...records].map((entry) => entry.id)).size, 2);
		assert.equal(records.find((entry) => entry.id === "Ns.B.Beta")?.outcome, "failed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
// ── Schema round-trip ────────────────────────────────────────────────────

describe("schema", () => {
	test("a serialized tree revalidates", () => {
		const tree = extractTree(
			baseInput({ dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1 } })] }),
		);
		const parsed = JSON.parse(`${JSON.stringify(tree, null, 2)}\n`) as ExecCoverageTree;
		assert.equal(
			validateExecTree(parsed, { suite: "app-mobile-e2e", platform: "android" }),
			null,
		);
	});
});

// ── Selector-tree bridge ───────────────────────────────────────────────

describe("execSelectorView", () => {
	test("maps per-test entries into selector-tree shape", () => {
		const tree = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 4, "2": 1 } })],
				recordByStem: new Map([
					["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed", ["s-1"])],
				]),
			}),
		);
		const view = execSelectorView(tree);
		const alpha = view.tests["Ns.AlphaTests.Alpha"];
		assert.deepEqual(alpha.files, ["app/BibleOnSite/App.xaml.cs"]);
		assert.deepEqual(alpha.sessions, ["s-1"]);
		assert.equal(alpha.outcome, "passed");
		// The exec channel records no automation ids and leaves the declaring
		// file for the collector's discovery lookup.
		assert.deepEqual(alpha.automationIds, []);
		assert.deepEqual(alpha.unmappedIds, []);
		assert.equal(alpha.file, undefined);
	});

	test("unmeasured and error entries never map onto a test", () => {
		const tree = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1 } })],
				dumpErrors: [{ fileBase: "Gamma", outcome: "passed", message: "pull failed" }],
				recordByStem: new Map([
					["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed")],
					["Gamma-passed", record("Ns.GammaTests.Gamma", "passed")],
				]),
				runRecords: [
					record("Ns.AlphaTests.Alpha", "passed"),
					record("Ns.BetaTests.Beta", "passed"),
					record("Ns.GammaTests.Gamma", "passed"),
				],
			}),
		);
		assert.equal(tree.tests["Ns.BetaTests.Beta"].attribution, "unmeasured");
		assert.equal(tree.tests["Ns.GammaTests.Gamma"].attribution, "error");
		const view = execSelectorView(tree);
		assert.deepEqual(Object.keys(view.tests), ["Ns.AlphaTests.Alpha"]);
	});

	test("shared-mode trees produce no per-test mappings but keep shared files", () => {
		const applied = TEMPLATE_XML.replace('vc="0" uspid="1"', 'vc="3" uspid="1"');
		const tree = extractTree(
			baseInput({
				cover: parseOpenCover(parseXml(applied)),
				runRecords: [record("Ns.AlphaTests.Alpha", "passed")],
			}),
		);
		assert.equal(tree.tests["Ns.AlphaTests.Alpha"].attribution, "shared");
		const view = execSelectorView(tree);
		assert.deepEqual(view.tests, {});
		assert.deepEqual(view.sharedFiles, ["app/BibleOnSite/App.xaml.cs"]);
	});

	test("the shared bucket surfaces as sharedFiles, unmatched dumps pass through", () => {
		const tree = extractTree(
			baseInput({
				dumps: [
					dump("_startup", "passed", { DEADBEEF: { "3": 7 } }),
					dump("Ghost", "passed", { DEADBEEF: { "4": 1 } }),
				],
			}),
		);
		const view = execSelectorView(tree);
		assert.deepEqual(view.tests, {});
		assert.deepEqual(view.unmatchedEvidence, ["Ghost-passed.json"]);
		assert.deepEqual(view.sharedFiles, [
			"app/BibleOnSite/App.xaml.cs",
			"app/BibleOnSite/PerekPage.xaml.cs",
		]);
	});

	test("baseline-carried per-test entries still map", () => {
		const baseline = extractTree(
			baseInput({
				snapshotSha: SHA_OLD,
				dumps: [dump("Beta", "passed", { DEADBEEF: { "4": 1 } })],
				recordByStem: new Map([["Beta-passed", record("Ns.BetaTests.Beta", "passed")]]),
			}),
		);
		const run = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1 } })],
				recordByStem: new Map([["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed")]]),
			}),
		);
		const { tree } = mergeTrees(run, baseline);
		assert.equal(tree.tests["Ns.BetaTests.Beta"].measured, false);
		assert.equal(tree.tests["Ns.BetaTests.Beta"].attribution, "per-test");
		assert.deepEqual(
			execSelectorView(tree).tests["Ns.BetaTests.Beta"].files,
			["app/BibleOnSite/PerekPage.xaml.cs"],
		);
	});

	test("stale baseline entries never map — a vanished test claims nothing", () => {
		const baseline = extractTree(
			baseInput({
				snapshotSha: SHA_OLD,
				dumps: [dump("Beta", "passed", { DEADBEEF: { "4": 1 } })],
				recordByStem: new Map([["Beta-passed", record("Ns.BetaTests.Beta", "passed")]]),
			}),
		);
		const run = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1 } })],
				recordByStem: new Map([["Alpha-passed", record("Ns.AlphaTests.Alpha", "passed")]]),
			}),
		);
		// Alpha is the only test still discovered — Beta's baseline entry
		// survives the merge flagged stale.
		const { tree } = mergeTrees(run, baseline, {
			discoveredIds: ["Ns.AlphaTests.Alpha"],
		});
		assert.equal(tree.tests["Ns.BetaTests.Beta"].stale, true);
		// Its files must not join the selector tree: a selected id that no
		// longer exists in the binary would run nothing for that change.
		assert.deepEqual(Object.keys(execSelectorView(tree).tests), [
			"Ns.AlphaTests.Alpha",
		]);
	});
});

describe("execTreeCompatible", () => {
	const expect = {
		suite: "app-mobile-e2e",
		platform: "android",
		snapshotSha: SHA,
	};

	test("accepts a matching tree", () => {
		assert.equal(execTreeCompatible(extractTree(baseInput()), expect), null);
	});

	test("rejects platform, suite, snapshot and schema mismatches", () => {
		const tree = extractTree(baseInput());
		assert.match(
			execTreeCompatible({ ...tree, platform: "ios" }, expect) ?? "",
			/platform ios/,
		);
		assert.match(
			execTreeCompatible({ ...tree, suite: "other" }, expect) ?? "",
			/suite other/,
		);
		assert.match(
			execTreeCompatible({ ...tree, snapshotSha: SHA_OLD }, expect) ?? "",
			/snapshotSha/,
		);
		assert.match(
			execTreeCompatible({ ...tree, schemaVersion: 2 }, expect) ?? "",
			/schemaVersion 2/,
		);
		// A foreign tree kind arrives over the wire as a plain string.
		const foreign = JSON.parse(
			JSON.stringify({ ...tree, kind: "coverage-tree" }),
		) as ExecCoverageTree;
		assert.match(
			execTreeCompatible(foreign, expect) ?? "",
			/kind coverage-tree/,
		);
	});
});

describe("loadExecTree", () => {
	test("reports missing and corrupt files, loads a valid tree", () => {
		const dir = mkdtempSync(join(tmpdir(), "e2e-ct-load-"));
		try {
			assert.equal(loadExecTree(join(dir, "absent.json")).kind, "missing");
			const bad = join(dir, "bad.json");
			writeFileSync(bad, "{not json");
			assert.equal(loadExecTree(bad).kind, "corrupt");
			const good = join(dir, "exec.json");
			writeFileSync(good, JSON.stringify(extractTree(baseInput())));
			const loaded = loadExecTree(good);
			assert.equal(loaded.kind, "ok");
			if (loaded.kind === "ok") {
				assert.equal(loaded.tree.platform, "android");
				assert.equal(
					execTreeCompatible(loaded.tree, {
						suite: "app-mobile-e2e",
						platform: "android",
						snapshotSha: SHA,
					}),
					null,
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── Member mapping (#2085) ──────────────────────────────────────────────

describe("member mapping", () => {
	// Sources whose member spans line up with TEMPLATE_XML's point spans:
	// App ctor (10-14), App.OnStart (20-24), PerekPage.LoadPerek (30-41),
	// the two Overloaded.Pick overloads (50 and 60) — all in PerekPage's
	// file for the overloads (span containment decides, never the names).
	const APP_CS = [
		"namespace BibleOnSite;", // 1
		"", // 2
		"public partial class App", // 3
		"{", // 4
		"    private int _seed = 1;", // 5 — init line the ctor fallback uses
		"", // 6
		"    public App()", // 7
		"    {", // 8
		"        var a = 1;", // 9
		"        var b = 2;", // 10
		"        var c = 3;", // 11
		"        var d = 4;", // 12
		"        var e = 5;", // 13
		"        var f = 6;", // 14
		"    }", // 15 → member [7,15] ⊇ [10,14]
		"", // 16
		"", // 17
		"    void OnStart()", // 18
		"    {", // 19
		"        var g = 7;", // 20
		"        var h = 8;", // 21
		"        var i = 9;", // 22
		"        var j = 0;", // 23
		"        var k = 1;", // 24
		"    }", // 25 → member [18,25] ⊇ [20,24]
		"}", // 26
	].join("\n");
	const PEREK_CS = (() => {
		const lines = [
			"namespace BibleOnSite;", // 1
			"", // 2
			"public partial class PerekPage", // 3
			"{", // 4
		];
		while (lines.length < 28) lines.push("");
		lines.push("    void LoadPerek()", "    {"); // 29-30
		while (lines.length < 41) lines.push("        var x = 0;");
		lines.push("    }"); // 42 → member [29,42] ⊇ [30,41]
		while (lines.length < 48) lines.push("");
		lines.push("    object Pick(int x)", "    {"); // 49-50
		lines.push("    }"); // 51 → member [49,51] ∋ 50
		while (lines.length < 58) lines.push("");
		lines.push("    object Pick(int x, int y)", "    {"); // 59-60
		lines.push("    }"); // 61 → member [59,61] ∋ 60
		lines.push("}");
		return lines.join("\n");
	})();
	const readSource = (path: string): string | null =>
		path === "app/BibleOnSite/App.xaml.cs"
			? APP_CS
			: path === "app/BibleOnSite/PerekPage.xaml.cs"
				? PEREK_CS
				: null;

	test("method nodes map onto their containing source member", () => {
		const tree = extractTree(
			baseInput({
				readSource,
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1, "3": 1, "4": 1, "5": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const ctor = tree.nodes["method:BibleOnSite.App..ctor"];
		assert.equal(ctor.memberType, "BibleOnSite.App");
		assert.ok(
			ctor.member?.startsWith("BibleOnSite.App.App#"),
			`ctor member ${ctor.member}`,
		);
		const onStart = tree.nodes["method:BibleOnSite.App.OnStart"];
		assert.equal(onStart.memberType, "BibleOnSite.App");
		assert.ok(
			onStart.member?.startsWith("BibleOnSite.App.OnStart#"),
			`OnStart member ${onStart.member}`,
		);
		// LoadPerek's points span the external /outside file too — a
		// multi-file span mixes two line spaces, so it stays unmapped and
		// reports its type as a memberGap rather than guessing a member.
		const load = tree.nodes["method:BibleOnSite.PerekPage.LoadPerek"];
		assert.equal(load.member, undefined);
		const view = execSelectorView(tree);
		assert.deepEqual(view.memberGaps, {
			"app/BibleOnSite/PerekPage.xaml.cs": ["BibleOnSite.PerekPage"],
		});
	});

	test("overloads map to distinct member keys by span", () => {
		const tree = extractTree(
			baseInput({
				readSource,
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "7": 1, "8": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const first = tree.nodes["method:BibleOnSite.Overloaded.Pick#0x0600000A"];
		const second = tree.nodes["method:BibleOnSite.Overloaded.Pick#0x0600000B"];
		assert.ok(first.member !== undefined && second.member !== undefined);
		assert.ok(
			first.member.startsWith("BibleOnSite.PerekPage.Pick#"),
			`first ${first.member}`,
		);
		assert.ok(
			second.member.startsWith("BibleOnSite.PerekPage.Pick#"),
			`second ${second.member}`,
		);
		assert.notEqual(first.member, second.member);
	});

	test("no readSource leaves nodes unmapped — member data stays absent", () => {
		const tree = extractTree(
			baseInput({
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		assert.equal(tree.nodes["method:BibleOnSite.App..ctor"].member, undefined);
	});

	test("ctor points spanning initializer lines map to the ctor member", () => {
		// The `_seed = 1` field init (line 5) executes inside `.ctor`, so the
		// node span [5,14] crosses member boundaries; the fallback anchors on
		// the span's tail — the ctor's own body.
		const ctorXml = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession><Modules>
	<Module hash="C0FFEE" skippedDueTo="SkippedDueTo_Declared">
		<ModulePath>x</ModulePath><ModuleName>BibleOnSite</ModuleName>
		<Files><File uid="1" fullPath="D:\\a\\bos\\bos\\app\\BibleOnSite\\App.xaml.cs" /></Files>
		<Classes><Class><FullName>BibleOnSite.App</FullName><Methods>
			<Method visited="false" isConstructor="true" isStatic="false">
				<MetadataToken>0x06000001</MetadataToken><Name>.ctor</Name><FileRef uid="1" />
				<SequencePoints>
					<SequencePoint vc="0" uspid="1" ordinal="0" sl="5" sc="5" el="5" ec="40" fileid="1" />
					<SequencePoint vc="0" uspid="2" ordinal="1" sl="10" sc="5" el="14" ec="60" fileid="1" />
				</SequencePoints>
			</Method>
		</Methods></Class></Classes>
	</Module>
</Modules></CoverageSession>`;
		const tree = extractTree(
			baseInput({
				readSource,
				cover: parseOpenCover(parseXml(ctorXml)),
				dumps: [dump("Alpha", "passed", { C0FFEE: { "1": 1, "2": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const ctor = tree.nodes["method:BibleOnSite.App..ctor"];
		assert.ok(
			ctor.member?.startsWith("BibleOnSite.App.App#"),
			`ctor member ${ctor.member}`,
		);
		assert.equal(ctor.memberType, "BibleOnSite.App");
	});

	test("nodes outside every member stay unmapped and surface as memberGaps", () => {
		const gapXml = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession><Modules>
	<Module hash="BEEF42" skippedDueTo="SkippedDueTo_Declared">
		<ModulePath>x</ModulePath><ModuleName>BibleOnSite</ModuleName>
		<Files><File uid="1" fullPath="D:\\a\\bos\\bos\\app\\BibleOnSite\\PerekPage.xaml.cs" /></Files>
		<Classes><Class><FullName>BibleOnSite.PerekPage</FullName><Methods>
			<Method visited="false" isConstructor="false" isStatic="false">
				<MetadataToken>0x06000001</MetadataToken><Name>FileScope</Name><FileRef uid="1" />
				<SequencePoints>
					<SequencePoint vc="0" uspid="1" ordinal="0" sl="2" sc="1" el="2" ec="20" fileid="1" />
				</SequencePoints>
			</Method>
		</Methods></Class></Classes>
	</Module>
</Modules></CoverageSession>`;
		const tree = extractTree(
			baseInput({
				readSource,
				cover: parseOpenCover(parseXml(gapXml)),
				dumps: [dump("Alpha", "passed", { BEEF42: { "1": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const node = tree.nodes["method:BibleOnSite.PerekPage.FileScope"];
		assert.equal(node.member, undefined);
		const view = execSelectorView(tree);
		assert.deepEqual(view.memberGaps, {
			"app/BibleOnSite/PerekPage.xaml.cs": ["BibleOnSite.PerekPage"],
		});
	});

	test("same-line one-liner members are ambiguous — unmapped, gapped", () => {
		// `void A() {} void B() {}` on one line gives both members an
		// identical span; a node whose point span sits on that line could be
		// either, so claiming the first would risk a wrong-member narrowing.
		const sameLineXml = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession><Modules>
	<Module hash="BEEF43" skippedDueTo="SkippedDueTo_Declared">
		<ModulePath>x</ModulePath><ModuleName>BibleOnSite</ModuleName>
		<Files><File uid="1" fullPath="D:\\a\\bos\\bos\\app\\BibleOnSite\\SameLine.xaml.cs" /></Files>
		<Classes><Class><FullName>BibleOnSite.SameLine</FullName><Methods>
			<Method visited="false" isConstructor="false" isStatic="false">
				<MetadataToken>0x06000001</MetadataToken><Name>B</Name><FileRef uid="1" />
				<SequencePoints>
					<SequencePoint vc="0" uspid="1" ordinal="0" sl="4" sc="20" el="4" ec="40" fileid="1" />
				</SequencePoints>
			</Method>
		</Methods></Class></Classes>
	</Module>
</Modules></CoverageSession>`;
		const sameLineCs = [
			"namespace BibleOnSite;", // 1
			"public class SameLine", // 2
			"{", // 3
			"    void A() { var a = 1; } void B() { var b = 2; }", // 4
			"}", // 5
		].join("\n");
		const tree = extractTree(
			baseInput({
				readSource: (path) =>
					path === "app/BibleOnSite/SameLine.xaml.cs" ? sameLineCs : null,
				cover: parseOpenCover(parseXml(sameLineXml)),
				dumps: [dump("Alpha", "passed", { BEEF43: { "1": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const node = tree.nodes["method:BibleOnSite.SameLine.B"];
		assert.equal(node.member, undefined);
		const view = execSelectorView(tree);
		assert.deepEqual(view.memberGaps, {
			"app/BibleOnSite/SameLine.xaml.cs": ["BibleOnSite.SameLine"],
		});
	});

	test("generic-type gaps normalize arity to the source type name", () => {
		// IL names a generic type `Gadget`2`; the member fingerprint knows it
		// as `BibleOnSite.Gadget`. The gap must normalize the same way or a
		// changed member inside the generic type would narrow wrongly.
		const genericXml = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession><Modules>
	<Module hash="BEEF44" skippedDueTo="SkippedDueTo_Declared">
		<ModulePath>x</ModulePath><ModuleName>BibleOnSite</ModuleName>
		<Files><File uid="1" fullPath="D:\\a\\bos\\bos\\app\\BibleOnSite\\Gadget.xaml.cs" /></Files>
		<Classes><Class><FullName>BibleOnSite.Gadget\`2</FullName><Methods>
			<Method visited="false" isConstructor="false" isStatic="false">
				<MetadataToken>0x06000001</MetadataToken><Name>Hidden</Name><FileRef uid="1" />
				<SequencePoints>
					<SequencePoint vc="0" uspid="1" ordinal="0" sl="2" sc="1" el="2" ec="20" fileid="1" />
				</SequencePoints>
			</Method>
		</Methods></Class></Classes>
	</Module>
</Modules></CoverageSession>`;
		const tree = extractTree(
			baseInput({
				readSource: () => null,
				cover: parseOpenCover(parseXml(genericXml)),
				dumps: [dump("Alpha", "passed", { BEEF44: { "1": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const view = execSelectorView(tree);
		assert.deepEqual(view.memberGaps, {
			"app/BibleOnSite/Gadget.xaml.cs": ["BibleOnSite.Gadget"],
		});
	});

	test("member keys flow into the selector view per covered file", () => {
		const tree = extractTree(
			baseInput({
				readSource,
				dumps: [dump("Alpha", "passed", { DEADBEEF: { "1": 1, "3": 1 } })],
				fqnByMethod: new Map([["Alpha", "Ns.AlphaTests.Alpha"]]),
			}),
		);
		const view = execSelectorView(tree);
		const members = view.tests["Ns.AlphaTests.Alpha"].members;
		const file = "app/BibleOnSite/App.xaml.cs";
		assert.ok(members !== undefined);
		assert.deepEqual(Object.keys(members), [file]);
		assert.equal(members[file].length, 2);
		assert.ok(members[file].some((key) => key.startsWith("BibleOnSite.App.OnStart#")));
		assert.ok(members[file].some((key) => key.startsWith("BibleOnSite.App.App#")));
		// member evidence merges through mergeTrees unchanged.
		const merged = mergeTrees(tree, null);
		assert.deepEqual(
			execSelectorView(merged.tree).tests["Ns.AlphaTests.Alpha"].members,
			members,
		);
	});
});
