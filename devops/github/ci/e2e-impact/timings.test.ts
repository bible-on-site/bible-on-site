import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
	caseDurations,
	evidenceDurations,
	junitDurations,
	mergeOverhead,
	mergeTiming,
	observedOverheadMs,
	TIMING_SAMPLE_CAP,
} from "./timings.ts";

describe("mergeTiming", () => {
	const now = new Date("2026-01-01T00:00:00Z");

	test("seeds a cold history with the first observation", () => {
		const timing = mergeTiming(undefined, 60_000, now);
		assert.deepEqual(timing, {
			samples: 1,
			meanMs: 60_000,
			lastMs: 60_000,
			updatedAtUtc: now.toISOString(),
		});
	});

	test("rolls the mean with capped weight so slow cases converge", () => {
		let timing = mergeTiming(undefined, 60_000, now);
		for (let i = 0; i < 50; i++) {
			timing = mergeTiming(timing, 120_000, now);
		}
		assert.equal(timing?.samples, TIMING_SAMPLE_CAP);
		// With capped weight the mean approaches — and nearly reaches — the
		// new value instead of sitting halfway to it.
		assert.ok(timing && timing.meanMs > 115_000, `meanMs ${timing?.meanMs}`);
		assert.equal(timing?.lastMs, 120_000);
	});

	test("carries prior history forward when no observation exists", () => {
		const prior = mergeTiming(undefined, 60_000, now);
		assert.equal(mergeTiming(prior, undefined, now), prior);
		assert.equal(mergeTiming(undefined, undefined, now), undefined);
	});
});

describe("mergeOverhead", () => {
	test("keeps a separate rolling mean for non-case pilot time", () => {
		let overhead = mergeOverhead(undefined, 100_000);
		overhead = mergeOverhead(overhead, 200_000);
		assert.deepEqual(overhead, { samples: 2, meanMs: 150_000 });
		assert.equal(mergeOverhead(overhead, undefined), overhead);
	});
});

describe("junitDurations", () => {
	test("sums per-case times, strips theory arguments and ignores skips", () => {
		const root = mkdtempSync(join(tmpdir(), "junit-"));
		try {
			const path = join(root, "mobile-e2e.xml");
			writeFileSync(path, `<?xml version="1.0"?>
<testsuite name="mobile-e2e">
	<testcase classname="Suite.Pilot" name="Startup" time="69.242"/>
	<testcase classname="Suite.Theory" name="Render(perek: 1)" time="10.0"/>
	<testcase classname="Suite.Theory" name="Render(perek: 2)" time="11.0"/>
	<testcase classname="Suite.Pilot" name="Skipped" time="0.001"><skipped/></testcase>
	<testcase classname="Suite.Pilot" name="NoTime"/>
</testsuite>`);
			const durations = junitDurations(path);
			assert.equal(durations?.get("Suite.Pilot.Startup"), 69_242);
			// Theory cases roll up under the method identity, retries summed.
			assert.equal(durations?.get("Suite.Theory.Render"), 21_000);
			assert.equal(durations?.has("Suite.Pilot.Skipped"), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null when the report does not exist", () => {
		assert.equal(junitDurations("/nonexistent/mobile-e2e.xml"), null);
	});

	test("accepts the className attribute form like loadJunit does", () => {
		const root = mkdtempSync(join(tmpdir(), "junit-"));
		try {
			const path = join(root, "mobile-e2e.xml");
			writeFileSync(path, `<?xml version="1.0"?>
<testsuite name="mobile-e2e">
	<testcase className="Suite.Pilot" name="Startup" time="42.5"/>
</testsuite>`);
			assert.equal(junitDurations(path)?.get("Suite.Pilot.Startup"), 42_500);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("evidenceDurations", () => {
	test("sums startedUtc→endedUtc spans of terminal outcomes only", () => {
		const durations = evidenceDurations([
			{ test: "A", outcome: "passed", startedUtc: "2026-01-01T00:00:00Z", endedUtc: "2026-01-01T00:01:00Z" },
			{ test: "A", outcome: "failed", startedUtc: "2026-01-01T00:02:00Z", endedUtc: "2026-01-01T00:03:00Z" },
			{ test: "B", outcome: "skipped", startedUtc: "2026-01-01T00:00:00Z", endedUtc: "2026-01-01T00:09:00Z" },
			{ test: "C", outcome: "passed" },
		]);
		assert.equal(durations.get("A"), 120_000);
		assert.equal(durations.has("B"), false);
		assert.equal(durations.has("C"), false);
	});
});

describe("caseDurations", () => {
	test("prefers the merger's sidecar, then JUnit, then evidence spans", () => {
		const root = mkdtempSync(join(tmpdir(), "case-durations-"));
		try {
			mkdirSync(join(root, "results"), { recursive: true });
			writeFileSync(join(root, "results", "mobile-e2e.xml"),
				`<testsuite><testcase classname="S" name="J" time="5"/></testsuite>`);
			const records = [
				{ test: "S.E", outcome: "passed", startedUtc: "2026-01-01T00:00:00Z", endedUtc: "2026-01-01T00:00:09Z" },
			];
			assert.equal(caseDurations(root, records).get("S.J"), 5_000);
			// The sidecar outranks the report for merged inputs.
			writeFileSync(join(root, "case-timings.json"), JSON.stringify({ "S.Merged": 7_000 }));
			const fromSidecar = caseDurations(root, records);
			assert.equal(fromSidecar.get("S.Merged"), 7_000);
			assert.equal(fromSidecar.has("S.J"), false);
			// Without either, evidence spans stand in.
			mkdirSync(join(root, "bare"), { recursive: true });
			assert.equal(caseDurations(join(root, "bare"), records).get("S.E"), 9_000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("observedOverheadMs", () => {
	test("is pilot elapsed minus measured case time, completed runs only", () => {
		const root = mkdtempSync(join(tmpdir(), "overhead-"));
		try {
			writeFileSync(join(root, "pilot-timing.json"),
				JSON.stringify({ status: "completed", elapsedMs: 400_000 }));
			const durations = new Map([["A", 60_000], ["B", 30_000]]);
			assert.equal(observedOverheadMs(root, durations), 310_000);
			// A timed-out pilot cannot say where remaining time would have gone.
			writeFileSync(join(root, "pilot-timing.json"),
				JSON.stringify({ status: "timed-out", elapsedMs: 400_000 }));
			assert.equal(observedOverheadMs(root, durations), null);
			// No pilot file → no sample.
			assert.equal(observedOverheadMs(join(root, "nope"), durations), null);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
