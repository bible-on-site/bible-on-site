import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { waitForCoverageFile } from "./coverage-file.mjs";

const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
const stats = (mtimeMs, size = 20, regular = true) => ({
	mtimeMs,
	size,
	isFile: () => regular,
});

async function fixture(t, options = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "api-coverage-wait-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	let time = 100;
	let current;
	let changed;
	let expire;
	let closes = 0;
	let reads = 0;
	let registered = false;
	const watcher = new EventEmitter();
	watcher.close = () => {
		closes++;
		if (options.closeError) throw options.closeError;
	};
	let ready;
	const registeredPromise = new Promise((resolve) => {
		ready = resolve;
	});
	const filePath = path.join(directory, "lcov.info");
	const result = waitForCoverageFile(filePath, {
		notBeforeMs: 100,
		timeoutMs: 30,
		now: () => time,
		watchDirectory: (_directory, listener) => {
			registered = true;
			changed = listener;
			ready();
			if (options.watchError) throw options.watchError;
			return watcher;
		},
		readStats: async () => {
			reads++;
			assert.equal(
				registered,
				true,
				"watch must register before the first stat",
			);
			if (options.readStats) return options.readStats(filePath, reads);
			if (current instanceof Error) throw current;
			if (!current) throw missing();
			return current;
		},
		readFinalStats: (filePath) => {
			reads++;
			if (options.readFinalStats) return options.readFinalStats(filePath);
			if (current instanceof Error) throw current;
			if (!current) throw missing();
			return current;
		},
		schedule: (callback, delay) => {
			assert.equal(delay, 30);
			expire = callback;
			return "timer";
		},
		cancel: () => {},
	});
	// Attach rejection handling immediately, including setup/stat failures.
	const outcome = result.then(
		() => null,
		(error) => error,
	);
	await registeredPromise;
	await setImmediate();
	return {
		filePath,
		outcome,
		watcher,
		get reads() {
			return reads;
		},
		get closes() {
			return closes;
		},
		set current(value) {
			current = value;
		},
		event: (filename = "lcov.info") => changed("change", filename),
		deadline: () => {
			time = 130;
			expire();
		},
	};
}

test("registers observation before the initial stat and accepts an already produced fresh report", async (t) => {
	const f = await fixture(t, { readStats: async () => stats(100) });
	assert.equal(await f.outcome, null);
	assert.equal(f.closes, 1);
});

test("a dropped notification still accepts a report written by the unchanged deadline", async (t) => {
	const f = await fixture(t);
	f.current = stats(125);
	f.deadline();
	assert.equal(await f.outcome, null);
	assert.equal(
		f.reads,
		2,
		"one initial stat and one final stat, without polling",
	);
	assert.equal(f.closes, 1);
});

test("final stat reads an actual report even when the injected watcher delivers no event", async (t) => {
	const f = await fixture(t, {
		readStats: async (filePath) => {
			const { stat } = await import("node:fs/promises");
			const actual = await stat(filePath);
			return { ...actual, mtimeMs: 120, isFile: () => actual.isFile() };
		},
		readFinalStats: (filePath) => {
			const actual = statSync(filePath);
			return { ...actual, mtimeMs: 120, isFile: () => actual.isFile() };
		},
	});
	await writeFile(f.filePath, "SF:src/main.rs\nDA:1,1\nend_of_record\n");
	f.deadline();
	assert.equal(await f.outcome, null);
	assert.equal(f.reads, 2);
});

for (const [name, report] of [
	["missing", undefined],
	["empty", stats(120, 0)],
	["stale pre-shutdown", stats(99)],
	["written after the deadline", stats(131)],
	["directory", stats(120, 20, false)],
]) {
	test(`rejects a ${name} report at the original deadline`, async (t) => {
		const f = await fixture(t);
		f.current = report;
		f.deadline();
		assert.match(
			(await f.outcome).message,
			/Timed out waiting for coverage report/,
		);
		assert.equal(f.closes, 1);
	});
}

test("accepts a report written exactly at the deadline", async (t) => {
	const f = await fixture(t);
	f.current = stats(130);
	f.deadline();
	assert.equal(await f.outcome, null);
});

test("relevant watch events recheck readiness but unrelated filenames do not", async (t) => {
	const f = await fixture(t);
	f.current = stats(120);
	f.event("different.info");
	await setImmediate();
	assert.equal(f.reads, 1);
	f.event(Buffer.from("lcov.info"));
	assert.equal(await f.outcome, null);
});

test("an unnamed watch event can observe the report becoming nonempty", async (t) => {
	const f = await fixture(t);
	f.current = stats(110, 0);
	f.event();
	await setImmediate();
	assert.equal(f.reads, 2);
	f.current = stats(120);
	f.event(null);
	assert.equal(await f.outcome, null);
});

test("preserves a genuine initial stat error", async (t) => {
	const original = Object.assign(new Error("permission denied"), {
		code: "EACCES",
	});
	const f = await fixture(t, {
		readStats: async () => {
			throw original;
		},
	});
	assert.equal(await f.outcome, original);
	assert.equal(f.closes, 1);
});

test("preserves a genuine final stat error even if watcher cleanup also fails", async (t) => {
	const original = Object.assign(new Error("read failed"), { code: "EIO" });
	const f = await fixture(t, { closeError: new Error("close failed") });
	f.current = original;
	f.deadline();
	assert.equal(await f.outcome, original);
});

test("preserves a watcher startup error", async (t) => {
	const original = new Error("watch registration failed");
	const f = await fixture(t, { watchError: original });
	assert.equal(await f.outcome, original);
});

test("preserves an asynchronous watcher error", async (t) => {
	const f = await fixture(t);
	const original = new Error("watch failed");
	f.watcher.emit("error", original);
	assert.equal(await f.outcome, original);
	assert.equal(f.closes, 1);
});

test("the deadline closes the watcher despite a never-resolving initial stat", async (t) => {
	const f = await fixture(t, { readStats: () => new Promise(() => {}) });
	f.deadline();
	assert.match(
		(await f.outcome).message,
		/Timed out waiting for coverage report/,
	);
	assert.equal(f.closes, 1);
});

test("the independent deadline stat can accept a timely report while an earlier stat is stalled", async (t) => {
	const f = await fixture(t, { readStats: () => new Promise(() => {}) });
	f.current = stats(125);
	f.deadline();
	assert.equal(await f.outcome, null);
	assert.equal(f.reads, 2);
	assert.equal(f.closes, 1);
});

test("an independent deadline stat error survives a stalled earlier stat", async (t) => {
	const original = Object.assign(new Error("final stat denied"), {
		code: "EACCES",
	});
	const f = await fixture(t, { readStats: () => new Promise(() => {}) });
	f.current = original;
	f.deadline();
	assert.equal(await f.outcome, original);
	assert.equal(f.closes, 1);
});
