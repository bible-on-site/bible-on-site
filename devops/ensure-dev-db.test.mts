import assert from "node:assert/strict";
import test from "node:test";
import {
	isCheckpointCurrent,
	parseTableTimes,
} from "./dev-db-checkpoint.mts";

const T = "2026-10-24 10:00:00";
const T2 = "2026-10-24 11:00:00";

test("isCheckpointCurrent", async (t) => {
	await t.test("returns true when prod matches the recorded checkpoint", () => {
		const stored = new Map([
			["a", T],
			["b", null],
		]);
		assert.equal(isCheckpointCurrent(stored, new Map(stored)), true);
	});

	await t.test("returns false when a prod table advanced", () => {
		const stored = new Map([
			["a", T],
			["b", null],
		]);
		const prod = new Map([
			["a", T2],
			["b", null],
		]);
		assert.equal(isCheckpointCurrent(stored, prod), false);
	});

	await t.test("returns false when prod gained or lost a table", () => {
		const stored = new Map([["a", T]]);
		assert.equal(
			isCheckpointCurrent(
				stored,
				new Map([
					["a", T],
					["b", null],
				]),
			),
			false,
		);
		assert.equal(isCheckpointCurrent(stored, new Map()), false);
	});

	await t.test("returns false when never synced", () => {
		assert.equal(isCheckpointCurrent(new Map(), new Map([["a", T]])), false);
	});

	await t.test("returns false when prod cannot report watermarks", () => {
		// An engine that never sets UPDATE_TIME can't prove freshness —
		// syncing is the safe answer.
		const stored = new Map([
			["a", null],
			["b", null],
		]);
		assert.equal(isCheckpointCurrent(stored, new Map(stored)), false);
	});
});

test("parseTableTimes", async (t) => {
	await t.test("parses tab-separated rows with NULL as null", () => {
		assert.deepEqual(
			parseTableTimes(`a\t${T}\nb\tNULL\nc\t${T2}\n`),
			new Map([
				["a", T],
				["b", null],
				["c", T2],
			]),
		);
	});

	await t.test("skips blank lines and nameless rows", () => {
		// "\tt" has no table name → skipped; "a" has no UPDATE_TIME → null.
		assert.deepEqual(
			parseTableTimes(`\n\tt\na\n\n`),
			new Map([["a", null]]),
		);
	});
});
