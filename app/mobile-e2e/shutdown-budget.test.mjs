import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { exitCode, phaseRecorder, remainingBudget } from "./shutdown-budget.mjs";

test("remainingBudget subtracts the reserve and elapsed time", () => {
	assert.equal(remainingBudget(10_000, 500, 4_000), 5_500);
	assert.equal(remainingBudget(10_000, 0, 9_999), 1);
});

test("remainingBudget clamps a lapsed deadline to zero", () => {
	assert.equal(remainingBudget(10_000, 500, 20_000), 0);
	assert.equal(remainingBudget(10_000, 0, 10_000), 0);
});

test("remainingBudget is unbounded without a valid deadline", () => {
	assert.equal(remainingBudget(Number.NaN), Number.POSITIVE_INFINITY);
	assert.equal(remainingBudget(undefined), Number.POSITIVE_INFINITY);
});

test("exitCode resolves on exit while a grandchild holds the pipes", async () => {
	const holder = `
const {spawn} = require('node:child_process');
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], {stdio: 'inherit'});
setTimeout(() => process.exit(7), 20);
`;
	const child = spawn(process.execPath, ["-e", holder], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	const started = Date.now();
	try {
		assert.equal(await exitCode(child), 7);
		assert.ok(
			Date.now() - started < 2_000,
			"the exit must not wait for the grandchild's inherited pipes",
		);
	} finally {
		child.stdout.destroy();
		child.stderr.destroy();
	}
});

test("phaseRecorder writes one jsonl entry per phase, including failures", async () => {
	const directory = mkdtempSync(join(tmpdir(), "phase-budget-"));
	const path = join(directory, "pilot-phases.jsonl");
	try {
		let clock = 1_000;
		const phase = phaseRecorder(path, () => clock);
		await phase("tests", () => {
			clock += 250;
		});
		await assert.rejects(
			phase("export", () => {
				clock += 900;
				throw new Error("stalled");
			}),
		);
		const entries = readFileSync(path, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.deepEqual(entries, [
			{ phase: "tests", elapsedMs: 250 },
			{ phase: "export", elapsedMs: 900 },
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
