import { describe, expect, it } from "vitest";
import { normalizeE2eLcov } from "../../util/lcov-normalize.mts";

describe("normalizeE2eLcov", () => {
	it("prefixes bare src/ SF paths with web/admin/", () => {
		const input = "TN:\nSF:src/lib/a.ts\nDA:1,1\nend_of_record\n";
		expect(normalizeE2eLcov(input)).toContain("SF:web/admin/src/lib/a.ts");
	});

	it("trims absolute runner paths down to web/admin/src/", () => {
		const input =
			"TN:\nSF:/home/runner/work/repo/repo/web/admin/src/lib/a.ts\nDA:1,1\nend_of_record\n";
		expect(normalizeE2eLcov(input)).toContain("SF:web/admin/src/lib/a.ts");
	});

	it("normalizes Windows backslashes", () => {
		const input = "TN:\nSF:src\\lib\\a.ts\nDA:1,1\nend_of_record\n";
		expect(normalizeE2eLcov(input)).toContain("SF:web/admin/src/lib/a.ts");
	});

	it("leaves already-prefixed paths and non-SF lines untouched", () => {
		const input =
			"TN:\nSF:web/admin/src/lib/a.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n";
		expect(normalizeE2eLcov(input)).toBe(input);
	});

	it("folds a serverfn-split chunk onto its .ts sibling record", () => {
		const input = [
			"SF:web/admin/src/server/sefarim.ts",
			"DA:11,1",
			"end_of_record",
			"SF:web/admin/src/server/sefarim.tstss-serverfn-split",
			"DA:2,2",
			"end_of_record",
			"",
		].join("\n");
		const out = normalizeE2eLcov(input);
		const sfs = out.match(/^SF:.+$/gm);
		expect(sfs).toEqual([
			"SF:web/admin/src/server/sefarim.ts",
			"SF:web/admin/src/server/sefarim.ts",
		]);
		// Both blocks keep their own hit records; the merge unions them.
		expect(out).toContain("DA:11,1");
		expect(out).toContain("DA:2,2");
	});

	it("folds a serverfn-split chunk onto a .tsx sibling record", () => {
		const input = [
			"SF:web/admin/src/components/Widget.tsx",
			"DA:5,0",
			"end_of_record",
			"SF:web/admin/src/components/Widget.tstss-serverfn-split",
			"DA:9,3",
			"end_of_record",
			"",
		].join("\n");
		const out = normalizeE2eLcov(input);
		expect(out.match(/^SF:.+$/gm)).toEqual([
			"SF:web/admin/src/components/Widget.tsx",
			"SF:web/admin/src/components/Widget.tsx",
		]);
	});

	it("keeps a split name when no sibling source record exists", () => {
		// A split chunk whose parent never entered the report stays under its
		// virtual name — the merge's hits-only contract drops it loudly rather
		// than guessing at a file that was never enumerated.
		const input =
			"TN:\nSF:web/admin/src/server/orphan.tstss-serverfn-split\nDA:1,1\nend_of_record\n";
		expect(normalizeE2eLcov(input)).toContain(
			"SF:web/admin/src/server/orphan.tstss-serverfn-split",
		);
	});
});
