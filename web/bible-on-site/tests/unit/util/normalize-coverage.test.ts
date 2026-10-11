/** @jest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Jest's transforms do not cover .mts helpers, so each case runs the real
// module in a short-lived node process (type-stripped natively on node 24).
const NORMALIZER_URL = pathToFileURL(
	join(__dirname, "../../util/coverage/normalize-coverage.mts"),
).href;

let workDir: string;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "normalize-coverage-"));
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

function normalize(lines: string[]): string[] {
	const input = join(workDir, "in.info");
	const output = join(workDir, "out.info");
	writeFileSync(input, `${lines.join("\n")}\n`, "utf8");
	const result = spawnSync(
		process.execPath,
		[
			"-e",
			`import(${JSON.stringify(NORMALIZER_URL)}).then((m) => m.normalizeLcovFile(${JSON.stringify(input)}, ${JSON.stringify(output)}))`,
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(`normalize-coverage exited ${result.status}: ${result.stderr}`);
	}
	return readFileSync(output, "utf8").replace(/\n$/, "").split("\n");
}

// The normalizer rewrites each SF: section; TN: trace names are dropped.
const section = (body: string[]) => [
	"SF:src/lib/example.ts",
	...body,
	"end_of_record",
];

describe("normalizeLcovFile", () => {
	it("credits the first arm when every branch arm is zero on a hit line", () => {
		// swc-plugin-coverage-instrument drops the arm increments of logical
		// operators on an arrow function's declaration line: the declaration
		// executes at module load while the function is never invoked, so the
		// line is hit but no arm is — which lcov rejects as inconsistent.
		const out = normalize(
			section([
				"DA:10,5",
				"BRDA:10,0,0,0",
				"BRDA:10,0,1,0",
				"BRF:2",
				"BRH:0",
			]),
		);
		expect(out).toContain("BRDA:10,0,0,5");
		expect(out).toContain("BRDA:10,0,1,0");
		expect(out).toContain("BRH:1");
	});

	it("adds the complementary arm of a single-arm block on a hit line", () => {
		const out = normalize(
			section(["DA:11,7", "BRDA:11,1,0,0", "BRF:1", "BRH:0"]),
		);
		expect(out).toContain("BRDA:11,1,0,0");
		expect(out).toContain("BRDA:11,1,1,7");
		expect(out).toContain("BRF:2");
		expect(out).toContain("BRH:1");
	});

	it("prefers a recorded arm over an unexecuted '-' arm", () => {
		const out = normalize(
			section([
				"DA:13,4",
				"BRDA:13,3,0,-",
				"BRDA:13,3,1,0",
				"BRF:2",
				"BRH:0",
			]),
		);
		expect(out).toContain("BRDA:13,3,0,-");
		expect(out).toContain("BRDA:13,3,1,4");
	});

	it("leaves consistent and unexecuted lines untouched", () => {
		const input = section([
			"DA:20,3",
			"BRDA:20,0,0,3",
			"BRDA:20,0,1,0",
			"DA:21,0",
			"BRDA:21,1,0,0",
			"BRDA:21,1,1,0",
			"BRF:4",
			"BRH:1",
		]);
		expect(normalize(input)).toEqual(input);
	});

	it("renames anonymous functions to line-based names", () => {
		const out = normalize(
			section(["FN:40,(anonymous_3)", "FNDA:2,(anonymous_3)"]),
		);
		expect(out).toContain("FN:40,(anonymous_L40)");
		expect(out).toContain("FNDA:2,(anonymous_L40)");
	});
});
