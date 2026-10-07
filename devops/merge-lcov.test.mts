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
});
