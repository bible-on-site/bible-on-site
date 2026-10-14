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

	it("restricts an untrusted input to the canonical line universe (#2270)", () => {
		// The e2e app build instruments a far larger universe than the
		// unit/integration report. Only hits on coordinates the canonical
		// layer already declared may merge — never foreign lines or files.
		const out = mergeLcovTexts([UNIT, E2E], "web/admin/", [], new Set([1]));
		assert.deepEqual(out.match(/^SF:.+$/gm), ["SF:web/admin/src/server.tsx"]);
		// Line 3 was uncovered in unit — the e2e hit confirms it. Line 9 is
		// e2e-only enumeration and cannot enter.
		assert.ok(out.includes("DA:1,5\nDA:2,5\nDA:3,2\n"), out);
		assert.ok(!out.includes("DA:9"), out);
		assert.ok(out.includes("LF:3\nLH:3\n"), out);
		// The e2e hit confirms the canonical branch arm its build left unhit.
		assert.ok(out.includes("BRDA:5,0,0,2\nBRDA:5,0,1,4\n"), out);
		assert.ok(out.includes("BRF:2\nBRH:2\n"), out);
		assert.ok(out.includes("FNDA:3,handler"), out);
	});

	it("keeps the merged universe identical with or without an untrusted input", () => {
		// The invariant the e2e merge needs: denominators and the file set are
		// exactly the canonical layers' — an e2e layer can only raise hits.
		const canonical = mergeLcovTexts([UNIT], "web/admin/");
		const merged = mergeLcovTexts([UNIT, E2E], "web/admin/", [], new Set([1]));
		assert.deepEqual(merged.match(/^SF:.+$/gm), canonical.match(/^SF:.+$/gm));
		const denominators = (s: string) =>
			s.match(/^(?:LF|BRF|FNF):\d+$/gm) ?? [];
		assert.deepEqual(denominators(merged), denominators(canonical));
	});

	it("drops an untrusted file entirely — hits included — when canonical never enumerated it", () => {
		// Pages/*.xaml.cs-style files exist only in the e2e build's universe:
		// keeping their hit lines would report a mostly-uncovered file as 100%.
		const e2eForeign =
			"TN:\nSF:app/BibleOnSite/Pages/ColdPage.xaml.cs\nFN:5,ctor\nFNDA:1,ctor\nDA:5,3\nDA:6,0\nBRDA:7,0,0,1\nFNF:1\nFNH:1\nLF:2\nLH:1\nBRF:1\nBRH:1\nend_of_record\n";
		const unitWarm =
			"TN:\nSF:app/BibleOnSite/Services/Hot.cs\nDA:1,4\nLF:1\nLH:1\nend_of_record\n";
		const out = mergeLcovTexts(
			[unitWarm, e2eForeign],
			undefined,
			["app/BibleOnSite/"],
			new Set([1]),
		);
		assert.deepEqual(out.match(/^SF:.+$/gm), ["SF:app/BibleOnSite/Services/Hot.cs"]);
	});

	it("merges an untrusted branch hit only onto a canonical arm, keeping its unhit sibling visible", () => {
		// BRDA block/branch indices are the foreign build's own coordinates —
		// a hit merges only when the canonical build emitted the same key, and
		// the canonical unhit sibling stays in the report as partial coverage.
		const canonical =
			"TN:\nSF:app/BibleOnSite/Pages/PerekPage.xaml.cs\nDA:20,1\nBRDA:20,0,0,0\nBRDA:20,0,1,0\nLF:1\nLH:1\nBRF:2\nBRH:0\nend_of_record\n";
		const e2e =
			"TN:\nSF:app/BibleOnSite/Pages/PerekPage.xaml.cs\nDA:20,1\nDA:21,0\nBRDA:20,0,0,1\nBRDA:20,0,1,0\nBRDA:30,0,0,9\nLF:2\nLH:1\nBRF:3\nBRH:2\nend_of_record\n";
		const out = mergeLcovTexts([canonical, e2e], undefined, ["app/BibleOnSite/"], new Set([1]));
		assert.ok(out.includes("BRDA:20,0,0,1\nBRDA:20,0,1,0\n"), out);
		assert.ok(!out.includes("BRDA:30"), out);
		assert.ok(!out.includes("DA:21"), out);
		assert.ok(out.includes("BRF:2\nBRH:1\n"), out);
	});

	it("confirms hits only on functions the canonical universe knows", () => {
		const canonical =
			"TN:\nSF:app/BibleOnSite/MauiProgram.cs\nFN:10,boot\nFN:20,dormant\nFNDA:0,boot\nFNDA:0,dormant\nDA:11,0\nLF:1\nLH:0\nFNF:2\nFNH:0\nend_of_record\n";
		const e2e =
			"TN:\nSF:app/BibleOnSite/MauiProgram.cs\nFN:10,boot\nFN:99,e2eOnly\nFNDA:2,boot\nFNDA:7,e2eOnly\nDA:11,2\nDA:50,4\nLF:2\nLH:2\nFNF:2\nFNH:2\nend_of_record\n";
		const out = mergeLcovTexts(
			[canonical, e2e],
			undefined,
			["app/BibleOnSite/"],
			new Set([1]),
		);
		assert.ok(out.includes("FN:10,boot\nFN:20,dormant\n"), out);
		assert.ok(out.includes("FNDA:2,boot"), out);
		assert.ok(!out.includes("e2eOnly"), out);
		assert.ok(!out.includes("DA:50"), out);
		assert.ok(out.includes("FNF:2\nFNH:1\n"), out);
	});
});
