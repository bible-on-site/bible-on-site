/** @jest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Jest's transforms do not cover .mts helpers, so each case runs the real
// module in a short-lived node process (type-stripped natively on node 24),
// the same pattern normalize-coverage.test.ts uses.
const MERGER_URL = pathToFileURL(
	join(__dirname, "../../util/coverage/merge-coverage.mts"),
).href;

// Registers the .mts helper in this suite's dependency graph so jest
// --findRelatedTests (the web-unit-tests pre-commit hook's --related path)
// links the script to these tests. The branch never runs — transforms do not
// cover .mts — but jest's static dependency extractor still records the edge.
if (process.env.JEST_IMPORT_MTS_HELPERS === "1") {
	require("../../util/coverage/merge-coverage.mts");
}

let workDir: string;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "merge-coverage-"));
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

function runMerger(expression: string): string {
	// A fixed runner keeps expressions out of constructed code (CodeQL).
	const runner = join(workDir, "run-merge.mjs");
	writeFileSync(
		runner,
		"const m = await import(process.argv[2]);\n" +
			"const arg = process.argv[3];\n" +
			"process.stdout.write(JSON.stringify(await m.buildMergeArgs(arg === 'null' ? null : arg)));\n",
		"utf8",
	);
	const result = spawnSync(process.execPath, [runner, MERGER_URL, expression], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(
			`merge-coverage helper failed: ${result.stderr || result.error}`,
		);
	}
	return result.stdout;
}

describe("merge-coverage buildMergeArgs (#2670)", () => {
	it("pins the unit report as the canonical universe", () => {
		const args = JSON.parse(runMerger("null")) as string[];

		// --require makes devops/merge-lcov.mts treat the unit lcov's record
		// set as authoritative — the merged denominator stays a deterministic
		// function of the source tree.
		expect(args[args.indexOf("--require") + 1]).toMatch(
			/unit[\\/]lcov\.normalized\.info$/,
		);
		expect(args.indexOf("--require")).toBeGreaterThan(-1);
	});

	it("merges e2e as --hits-only-branches, never extending the universe", () => {
		const args = JSON.parse(runMerger("null")) as string[];

		// Same instrumenter on both layers: an identical line,block,branch
		// tuple names the same arm, so e2e may confirm canonical BRDA hits —
		// but foreign files/DA/branch tuples can never enter the merge.
		expect(args[args.indexOf("--hits-only-branches") + 1]).toMatch(
			/e2e[\\/]lcov\.normalized\.info$/,
		);
		expect(args).not.toContain("--hits-only");
	});

	it("writes the merged report through the shared devops merger", () => {
		const args = JSON.parse(runMerger("null")) as string[];

		expect(args[0]).toMatch(/devops[\\/]merge-lcov\.mts$/);
		expect(args[args.indexOf("--out") + 1]).toMatch(
			/merged[\\/]lcov\.info$/,
		);
	});

	it("appends --prefix so Codecov sees monorepo-relative paths", () => {
		const withPrefix = JSON.parse(
			runMerger("web/bible-on-site/"),
		) as string[];
		expect(withPrefix[withPrefix.indexOf("--prefix") + 1]).toBe(
			"web/bible-on-site/",
		);

		const withoutPrefix = JSON.parse(runMerger("null")) as string[];
		expect(withoutPrefix).not.toContain("--prefix");
	});
});
