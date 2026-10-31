/** @jest-environment node */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// coverage-universe.mjs / sanitize-coverage.mjs are true ESM (no jest
// transform), so — like merge-coverage.test.ts — each case drives the real
// modules in a short-lived node subprocess and asserts on its JSON output.
const UNIVERSE_URL = pathToFileURL(
	join(__dirname, "../../util/coverage/coverage-universe.mjs"),
).href;
const SANITIZE_URL = pathToFileURL(
	join(__dirname, "../../util/coverage/sanitize-coverage.mjs"),
).href;
const SWC_URL = pathToFileURL(require.resolve("@swc/core")).href;
const PACKAGE_DIR = resolve(__dirname, "../../..");

// The canonical transform needs @swc/core's native binding. Machines where it
// cannot load (e.g. restrictive Windows ACLs rejected by the binding's cache
// validation) cannot run coverage instrumentation at all, so these suites
// skip instead of failing — CI exercises them on a working toolchain.
const swcAvailable = (() => {
	try {
		require("@swc/core");
		return true;
	} catch {
		return false;
	}
})();
const describeSwc = swcAvailable ? describe : describe.skip;

// Registers the helpers in this suite's dependency graph so jest
// --findRelatedTests links them to these tests. The branch never runs —
// jest's transforms do not cover the ESM helpers.
if (process.env.JEST_IMPORT_MTS_HELPERS === "1") {
	require("../../util/coverage/coverage-universe.mjs");
	require("../../util/coverage/sanitize-coverage.mjs");
}

let workDir: string;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "coverage-universe-"));
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

/**
 * A tiny src/ tree exercising: a ts file with an `istanbul ignore next`
 * directive, a tsx file, a nested file, a non-instrumentable json, a
 * covignored app/layout.tsx, and a directory for generated-module records.
 */
function makeFixtureSrc(): string {
	const srcDir = join(workDir, "src");
	mkdirSync(join(srcDir, "app"), { recursive: true });
	mkdirSync(join(srcDir, "chunk"), { recursive: true });
	writeFileSync(
		join(srcDir, "alpha.ts"),
		[
			"export const alpha = 1;",
			"export function twice(x: number) {",
			"\treturn x > 0 ? x * 2 : -x;",
			"}",
			"/* istanbul ignore next */",
			"export function unreachable() {",
			"\tthrow new Error('defensive');",
			"}",
		].join("\n"),
	);
	writeFileSync(
		join(srcDir, "app", "page.tsx"),
		"export const Page = () => <div>{alpha ? 'a' : 'b'}</div>;\n",
	);
	writeFileSync(join(srcDir, "app", "layout.tsx"), "export default 1;\n");
	writeFileSync(join(srcDir, "data.json"), '{"a": 1}\n');
	return srcDir;
}

function runHelper(source: string, ...args: string[]): unknown {
	const runner = join(workDir, "run-helper.mjs");
	writeFileSync(runner, source);
	// The spawned process runs from the package root so swc plugin
	// resolution behaves exactly like the jest/dev-server contexts.
	const result = spawnSync(process.execPath, [runner, ...args], {
		encoding: "utf8",
		cwd: PACKAGE_DIR,
		env: process.env,
	});
	if (result.status !== 0) {
		throw new Error(`helper failed: ${result.stderr || result.error}`);
	}
	expect(result.stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
	return JSON.parse(result.stdout);
}

describeSwc("getCoverageUniverse (#2670)", () => {
	it("builds canonical instrumented maps for instrumentable src files only", () => {
		const srcDir = makeFixtureSrc();
		const entries = runHelper(
			`import { getCoverageUniverse } from ${JSON.stringify(UNIVERSE_URL)};
const uni = getCoverageUniverse(process.argv[2]);
process.stdout.write(JSON.stringify([...uni.entries()].map(([p, e]) => ({
	p,
	stmts: Object.keys(e.statementMap ?? {}).length,
	fns: Object.keys(e.fnMap ?? {}).length,
	zeros: Object.values(e.s ?? {}).every((n) => n === 0),
}))));`,
			srcDir,
		) as { p: string; stmts: number; fns: number; zeros: boolean }[];

		// Instrumentable: alpha.ts + app/page.tsx. Not: layout.tsx (covignored),
		// data.json (not transformed), the empty chunk/ dir.
		const paths = entries.map((e) => e.p).sort();
		expect(paths).toEqual(
			[join(srcDir, "alpha.ts"), join(srcDir, "app", "page.tsx")].sort(),
		);
		for (const entry of entries) {
			expect(entry.stmts).toBeGreaterThan(0);
			expect(entry.fns).toBeGreaterThan(0);
			expect(entry.zeros).toBe(true);
		}
	});

	it("builds the real src universe with no transform failures", () => {
		const summary = runHelper(
			`import { getCoverageUniverse } from ${JSON.stringify(UNIVERSE_URL)};
const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.join(" "));
const uni = getCoverageUniverse(process.argv[2]);
process.stdout.write(JSON.stringify({
	files: uni.size,
	stmts: [...uni.values()].reduce((n, e) => n + Object.keys(e.statementMap ?? {}).length, 0),
	errors,
}));`,
			join(PACKAGE_DIR, "src"),
		) as { files: number; stmts: number; errors: string[] };

		expect(summary.errors).toEqual([]);
		expect(summary.files).toBeGreaterThan(200);
		expect(summary.stmts).toBeGreaterThan(5000);
	});

	it("is memoized per srcDir", () => {
		const srcDir = makeFixtureSrc();
		const same = runHelper(
			`import { getCoverageUniverse } from ${JSON.stringify(UNIVERSE_URL)};
const uni = getCoverageUniverse(process.argv[2]);
process.stdout.write(JSON.stringify(uni === getCoverageUniverse(process.argv[2])));`,
			srcDir,
		);
		expect(same).toBe(true);
	});
});

describe("projectCounters (#2670)", () => {
	it("maps variant hits onto canonical keys and drops foreign coordinates", () => {
		const projected = runHelper(
			`import { projectCounters } from ${JSON.stringify(UNIVERSE_URL)};
const loc = (sl, sc, el, ec) => ({ start: { line: sl, column: sc }, end: { line: el, column: ec } });
const canonical = {
	path: "/f.ts", hash: "canon",
	statementMap: { 0: loc(1, 0, 1, 10), 1: loc(5, 0, 5, 20) },
	s: { 0: 0, 1: 0 },
	fnMap: { 0: { decl: loc(3, 0, 7, 1) } }, f: { 0: 0 },
	branchMap: { 0: { locations: [loc(5, 0, 5, 9), loc(5, 12, 5, 20)] } }, b: { 0: [0, 0] },
};
// The variant adds a foreign statement (an istanbul-ignored line a
// comment-stripping compile instrumented) and wraps canonical ones.
const variant = {
	path: "/f.ts", hash: "variant",
	statementMap: { 0: loc(1, 0, 1, 10), 1: loc(5, 0, 6, 3), 2: loc(40, 0, 40, 5) },
	s: { 0: 3, 1: 4, 2: 9 },
	fnMap: { 0: { decl: loc(3, 0, 7, 1) } }, f: { 0: 2 },
	branchMap: { 0: { locations: [loc(5, 0, 5, 9), loc(5, 10, 6, 0)] } }, b: { 0: [6, 8] },
};
process.stdout.write(JSON.stringify(projectCounters(canonical, variant)));`,
		) as {
			s: Record<string, number>;
			f: Record<string, number>;
			b: Record<string, number[]>;
		};

		// Only canonical keys survive; foreign statement 2's hits are gone.
		expect(Object.keys(projected.s).sort()).toEqual(["0", "1"]);
		expect(projected.s["0"]).toBe(3);
		// Canonical stmt 1 (line 5) is contained in variant stmt 1 — inherits hits.
		expect(projected.s["1"]).toBe(4);
		expect(projected.f["0"]).toBe(2);
		expect(projected.b["0"]).toHaveLength(2);
		expect(projected.b["0"][0]).toBe(6); // arm matched by exact location
		expect(projected.b["0"][1]).toBe(8); // contained arm inherits the variant arm's hits
	});

	it("key-copies counters when the instrumented hash matches", () => {
		const projected = runHelper(
			`import { projectCounters } from ${JSON.stringify(UNIVERSE_URL)};
const canonical = { path: "/f", hash: "same", statementMap: { 0: {} }, s: { 0: 0 }, fnMap: {}, f: {}, branchMap: {}, b: {} };
const variant = { path: "/f", hash: "same", statementMap: { 0: {} }, s: { 0: 7 }, fnMap: {}, f: {}, branchMap: {}, b: { 0: [1, 0] } };
process.stdout.write(JSON.stringify(projectCounters(canonical, variant)));`,
		) as { s: Record<string, number>; b: Record<string, number[]> };

		expect(projected.s["0"]).toBe(7);
		expect(projected.b["0"]).toEqual([1, 0]);
	});
});

describeSwc("sanitizeCoverage canonical projection (#2670)", () => {
	it("projects a comment-stripped variant onto canonical coords and drops generated records", () => {
		const srcDir = makeFixtureSrc();
		const alphaPath = join(srcDir, "alpha.ts");
		const result = runHelper(
			`import * as swcNs from ${JSON.stringify(SWC_URL)};
import { getCoverageUniverse } from ${JSON.stringify(UNIVERSE_URL)};
import { sanitizeCoverage } from ${JSON.stringify(SANITIZE_URL)};
import vm from "node:vm";
import fs from "node:fs";
const swc = swcNs.default ?? swcNs;
const srcDir = process.argv[2];
const alphaPath = process.argv[3];
const uni = getCoverageUniverse(srcDir);
// Simulate the dev-server variant: blank the istanbul-ignore comments in
// place (line numbers preserved) so the plugin instruments them.
let src = fs.readFileSync(alphaPath, "utf8");
src = src.replace(/\\/\\*\\s*istanbul\\s+ignore[^*]*\\*\\//g, (m) => " ".repeat(m.length));
const { code } = swc.transformSync(src, {
	jsc: { parser: { syntax: "typescript", tsx: true },
		experimental: { plugins: [["swc-plugin-coverage-instrument", {}]] } },
	filename: alphaPath });
const match = code.match(/function (cov_\\d+)\\(\\)\\s*\\{/);
let start = code.indexOf("{", match.index), depth = 0, end = -1;
for (let i = start; i < code.length; i++) {
	if (code[i] === "{") depth++;
	else if (code[i] === "}") { depth--; if (!depth) { end = i; break; } }
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext("(" + code.slice(match.index, end + 1) + ")()", sandbox);
const variant = sandbox.__coverage__[Object.keys(sandbox.__coverage__)[0]];
for (const k of Object.keys(variant.s)) variant.s[k] = 5;
const coverage = {
	[alphaPath]: variant,
	[srcDir + "/chunk/data0a1b2c"]: {
		path: srcDir + "/chunk/data0a1b2c",
		statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 3, column: 0 } } },
		s: { 0: 9 }, fnMap: {}, f: {}, branchMap: {}, b: {},
	},
	[srcDir + "/ghost.ts"]: {
		path: srcDir + "/ghost.ts",
		statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 3, column: 0 } } },
		s: { 0: 9 }, fnMap: {}, f: {}, branchMap: {}, b: {},
	},
	[srcDir + "/app/layout.tsx"]: {
		path: srcDir + "/app/layout.tsx",
		statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } } },
		s: { 0: 9 }, fnMap: {}, f: {}, branchMap: {}, b: {},
	},
};
sanitizeCoverage(coverage, srcDir, uni);
const out = coverage[alphaPath];
// Reference: sanitize the canonical entry itself — the deterministic
// coordinate set the e2e record must collapse onto.
const canonical = uni.get(alphaPath);
const refCoverage = { [alphaPath]: structuredClone(canonical) };
sanitizeCoverage(refCoverage, srcDir, uni);
const ref = refCoverage[alphaPath];
const linesOf = (e) => ({
	s: Object.values(e.statementMap).map((s) => s.start.line).sort((a, b) => a - b),
	b: Object.values(e.branchMap).map((b) => (b.line ?? b.loc?.start?.line)).sort((a, b) => a - b),
	f: Object.values(e.fnMap).map((f) => (f.line ?? f.decl?.start?.line)).sort((a, b) => a - b),
});
process.stdout.write(JSON.stringify({
	surviving: Object.keys(coverage),
	variant: linesOf(out),
	canonical: linesOf(ref),
	hitStmts: Object.values(out.s).filter((n) => n > 0).length,
}));`,
			srcDir,
			alphaPath,
		) as {
			surviving: string[];
			variant: { s: number[]; b: number[]; f: number[] };
			canonical: { s: number[]; b: number[]; f: number[] };
			hitStmts: number;
		};

		// Only the real source record survives: the generated chunk,
		// nonexistent ghost.ts, and covignored layout.tsx all drop.
		expect(result.surviving).toEqual([alphaPath]);
		// The variant's extra (istanbul-ignored) coordinates can never widen
		// the universe — after projection the record's coordinate set is
		// identical to sanitizing the canonical entry itself.
		expect(result.variant).toEqual(result.canonical);
		// Hits still land on canonical coordinates — coverage is preserved.
		expect(result.hitStmts).toBeGreaterThan(0);
	});
});

describeSwc("native coverage reporter module boundary", () => {
	it("reports executed fixture coverage without typeless-module warnings", () => {
		const artifacts = join(PACKAGE_DIR, ".artifacts");
		mkdirSync(artifacts, { recursive: true });
		const reportRoot = mkdtempSync(join(artifacts, "native-coverage-"));
		if (
			!resolve(reportRoot).startsWith(
				`${resolve(artifacts)}${process.platform === "win32" ? "\\" : "/"}native-coverage-`,
			)
		) {
			throw new Error("Unsafe native coverage fixture cleanup");
		}
		const reporter = join(PACKAGE_DIR, "tests/util/jest/coverage/index.js");
		try {
			const sourcePath = join(reportRoot, "src/alpha.ts");
			mkdirSync(join(reportRoot, "src"));
			writeFileSync(
				sourcePath,
				"export function increment(value: number) { return value > 0 ? value + 1 : 0; }\n",
			);
			const runner = join(reportRoot, "report.cjs");
			writeFileSync(
				runner,
				`
const fs = require('node:fs');
const path = require('node:path');
const swc = require('@swc/core');
const Reporter = require(${JSON.stringify(reporter)});
async function main() {
  const source = ${JSON.stringify(sourcePath)};
  const compiled = path.resolve('compiled.cjs');
  const output = swc.transformSync(fs.readFileSync(source, 'utf8'), {
    filename: source,
    jsc: { target: 'es2023', parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic' }, hidden: { jest: true } },
      experimental: { plugins: [['swc-plugin-coverage-instrument', { unstableExclude: [] }]] } },
    module: { type: 'commonjs' }, sourceMaps: 'inline',
  });
  fs.writeFileSync(compiled, output.code);
  const { increment } = require(compiled);
  const values = [increment(2), increment(-1)];
  fs.mkdirSync('.coverage/unit', { recursive: true });
  fs.writeFileSync('.coverage/unit/istanbul-coverage.json', JSON.stringify(globalThis.__coverage__));
  await new Reporter({}, { outputDir: '.coverage/unit', reports: ['lcovonly'] }).onRunComplete(new Set(), {});
  const lcov = fs.readFileSync('.coverage/unit/lcov.info', 'utf8');
  console.log(JSON.stringify({ values, hasSource: lcov.replaceAll('\\\\', '/').includes('src/alpha.ts'),
    positiveLines: [...lcov.matchAll(/^DA:\\d+,[1-9]\\d*/gm)].length,
    rawRemoved: !fs.existsSync('.coverage/unit/istanbul-coverage.json') }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`,
			);
			const result = spawnSync(process.execPath, [runner], {
				cwd: reportRoot,
				encoding: "utf8",
				env: process.env,
			});
			expect(result.status).toBe(0);
			const lastLine = result.stdout.trim().split(/\r?\n/).at(-1);
			const summary = JSON.parse(lastLine ?? "{}");
			expect(summary).toMatchObject({
				values: [3, 0],
				hasSource: true,
				rawRemoved: true,
			});
			expect(summary.positiveLines).toBeGreaterThan(0);
			expect(result.stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
		} finally {
			rmSync(reportRoot, { recursive: true, force: true });
		}
	});
});
