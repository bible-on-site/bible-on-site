import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeLcovTexts } from "./merge-lcov.mts";

const UNIT = `TN:
SF:src/server.tsx
FN:10,handler
FNDA:3,handler
DA:1,5
DA:2,5
DA:3,0
BRDA:5,0,0,2
BRDA:5,0,1,0
FNF:1
FNH:1
BRF:2
BRH:1
LF:3
LH:2
end_of_record
`;

const E2E = `TN:
SF:web/admin/src/server.tsx
FN:10,handler
FNDA:0,handler
DA:1,1
DA:2,0
DA:3,2
DA:9,7
BRDA:5,0,0,0
BRDA:5,0,1,4
FNF:1
FNH:0
BRF:2
BRH:1
LF:4
LH:3
end_of_record
TN:
SF:web/admin/src/other.ts
DA:1,1
DA:2,1
LF:2
LH:2
end_of_record
`;

describe("mergeLcovTexts", () => {
	it("unions hit counts per file instead of keeping duplicate SF blocks", () => {
		const out = mergeLcovTexts([UNIT, E2E], "web/admin/");
		const sfs = out.match(/^SF:.+$/gm);
		assert.deepEqual(sfs, [
			"SF:web/admin/src/other.ts",
			"SF:web/admin/src/server.tsx",
		]);
		const serverBlock = out.split("end_of_record")[1];
		assert.ok(serverBlock.includes("LF:4\nLH:4\n"), serverBlock);
		assert.ok(serverBlock.includes("BRF:2\nBRH:2\n"), serverBlock);
		assert.ok(serverBlock.includes("FNDA:3,handler"), serverBlock);
		assert.ok(serverBlock.includes("BRDA:5,0,0,2\nBRDA:5,0,1,4\n"), serverBlock);
	});

	it("prefixes bare SF:src/ paths and normalizes backslashes", () => {
		const win = "TN:\nSF:src\\lib\\a.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts([win], "web/admin/");
		assert.match(out, /^SF:web\/admin\/src\/lib\/a\.ts$/m);
	});

	it("trims absolute paths down to the prefix when it appears mid-path", () => {
		const abs =
			"TN:\nSF:/home/runner/work/x/web/admin/src/a.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts([abs], "web/admin/");
		assert.match(out, /^SF:web\/admin\/src\/a\.ts$/m);
	});

	it("emits nothing for no inputs", () => {
		assert.equal(mergeLcovTexts([]), "");
	});

	it("relocates absolute SF paths from different runners onto the needle", () => {
		// #1232: mobile E2E coverage is produced on Linux (Android) and macOS
		// (iOS) runners, so the same source file arrives under different roots.
		const linux =
			"TN:\nSF:/home/runner/work/bible-on-site/bible-on-site/app/BibleOnSite/Helpers/AppLinkHelper.cs\nDA:1,3\nDA:2,0\nLF:2\nLH:1\nend_of_record\n";
		const macos =
			"TN:\nSF:/Users/runner/work/bible-on-site/bible-on-site/app/BibleOnSite/Helpers/AppLinkHelper.cs\nDA:1,0\nDA:2,7\nLF:2\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts([linux, macos], undefined, ["app/BibleOnSite/"]);
		const sfs = out.match(/^SF:.+$/gm);
		assert.deepEqual(sfs, ["SF:app/BibleOnSite/Helpers/AppLinkHelper.cs"]);
		assert.ok(out.includes("DA:1,3\nDA:2,7\n"), out);
	});

	it("leaves already-relative SF paths untouched by relocate", () => {
		const rel =
			"TN:\nSF:app/BibleOnSite/Helpers/AppLinkHelper.cs\nDA:1,1\nLF:1\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts([rel], undefined, ["app/BibleOnSite/"]);
		assert.match(out, /^SF:app\/BibleOnSite\/Helpers\/AppLinkHelper\.cs$/m);
	});

	it("merges hits-only input's covered lines but not its zero-hit enumeration", () => {
		// #2270: the e2e app build instruments a far larger line universe than
		// the unit/integration report; its unhit lines must not enter the
		// merged denominator, while its hits still union in.
		const out = mergeLcovTexts([UNIT, E2E], "web/admin/", [], new Set([1]));
		const sfs = out.match(/^SF:.+$/gm);
		assert.deepEqual(sfs, [
			"SF:web/admin/src/other.ts",
			"SF:web/admin/src/server.tsx",
		]);
		const serverBlock = out.split("end_of_record")[1];
		assert.ok(serverBlock.includes("DA:1,5\nDA:2,5\nDA:3,2\nDA:9,7\n"), serverBlock);
		assert.ok(serverBlock.includes("LF:4\nLH:4\n"), serverBlock);
		assert.ok(serverBlock.includes("BRF:2\nBRH:2\n"), serverBlock);
		assert.ok(serverBlock.includes("FNDA:3,handler"), serverBlock);
	});

	it("drops a hits-only file that covered nothing", () => {
		const e2eCold =
			"TN:\nSF:app/BibleOnSite/Pages/ColdPage.xaml.cs\nFN:5,ctor\nFNDA:0,ctor\nDA:5,0\nDA:6,0\nBRDA:7,0,0,-\nFNF:1\nFNH:0\nLF:2\nLH:0\nend_of_record\n";
		const unitWarm =
			"TN:\nSF:app/BibleOnSite/Services/Hot.cs\nDA:1,4\nLF:1\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts(
			[unitWarm, e2eCold],
			undefined,
			["app/BibleOnSite/"],
			new Set([1]),
		);
		assert.deepEqual(out.match(/^SF:.+$/gm), ["SF:app/BibleOnSite/Services/Hot.cs"]);
	});

	it("drops a hits-only zero-hit branch even on a line the input executed", () => {
		// BRDA block/branch indices are emitted by the foreign instrumented
		// build and need not match the canonical build's coordinates, so an
		// unhit arm is enumeration, not partial coverage. Only hit arms merge.
		const e2e =
			"TN:\nSF:app/BibleOnSite/Pages/PerekPage.xaml.cs\nDA:20,1\nDA:21,0\nBRDA:20,0,0,1\nBRDA:20,0,1,0\nBRDA:30,0,0,0\nBRDA:30,0,1,0\nLF:2\nLH:1\nBRF:4\nBRH:1\nend_of_record\n";
		const out = mergeLcovTexts([e2e], undefined, ["app/BibleOnSite/"], new Set([0]));
		assert.ok(out.includes("BRDA:20,0,0,1\n"), out);
		assert.ok(!out.includes("BRDA:20,0,1"), out);
		assert.ok(!out.includes("BRDA:30"), out);
		assert.ok(out.includes("BRF:1\nBRH:1\n"), out);
	});

	it("keeps a hits-only FN definition only when its function was hit", () => {
		const e2e =
			"TN:\nSF:app/BibleOnSite/MauiProgram.cs\nFN:10,boot\nFN:20,dormant\nFNDA:2,boot\nFNDA:0,dormant\nDA:11,2\nLF:1\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts(
			[e2e],
			undefined,
			["app/BibleOnSite/"],
			new Set([0]),
		);
		assert.ok(out.includes("FN:10,boot"), out);
		assert.ok(!out.includes("dormant"), out);
		assert.ok(out.includes("FNF:1\nFNH:1\n"), out);
	});
});
