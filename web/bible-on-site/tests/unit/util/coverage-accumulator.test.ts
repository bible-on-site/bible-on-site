/** @jest-environment node */
import { CoverageAccumulator } from "../../util/coverage/coverage-accumulator";

const file = "/src/example.ts";
const data = () => ({
	path: file,
	statementMap: {
		0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
	},
	fnMap: {},
	branchMap: {},
	s: { 0: 1 },
	f: { 0: 1 },
	b: { 0: [1, 0] },
});

test("preserves complementary branches across fresh module instances", () => {
	const accumulator = new CoverageAccumulator();
	const first = data();
	accumulator.collect({ [file]: first });
	const reloaded = { ...data(), b: { 0: [0, 1] } };
	accumulator.collect({ [file]: reloaded });
	expect(accumulator.coverage[file].s).toEqual({ 0: 2 });
	expect(accumulator.coverage[file].f).toEqual({ 0: 2 });
	expect(accumulator.coverage[file].b).toEqual({ 0: [1, 1] });
	expect(first.b).toEqual({ 0: [1, 0] });
	expect(reloaded.b).toEqual({ 0: [0, 1] });
});

test("counts only new hits when the same instrumented module is reused", () => {
	const accumulator = new CoverageAccumulator();
	const current = data();
	accumulator.collect({ [file]: current });
	current.s[0] = 3;
	current.f[0] = 2;
	current.b[0] = [2, 1];
	accumulator.collect({ [file]: current });
	accumulator.collect({ [file]: current });
	expect(accumulator.coverage[file].s).toEqual({ 0: 3 });
	expect(accumulator.coverage[file].f).toEqual({ 0: 2 });
	expect(accumulator.coverage[file].b).toEqual({ 0: [2, 1] });
});

test("captures new files and leaves unexecuted branches uncovered", () => {
	const accumulator = new CoverageAccumulator();
	accumulator.collect(undefined);
	accumulator.collect({ [file]: data() });
	accumulator.collect({
		"/src/other.ts": {
			...data(),
			path: "/src/other.ts",
			s: { 0: 0 },
			f: { 0: 0 },
			b: { 0: [0, 0] },
		},
	});
	expect(accumulator.coverage[file].b).toEqual({ 0: [1, 0] });
	expect(accumulator.coverage["/src/other.ts"].s).toEqual({ 0: 0 });
	expect(accumulator.coverage["/src/other.ts"].b).toEqual({ 0: [0, 0] });
});
