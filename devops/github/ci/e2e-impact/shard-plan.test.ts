import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildPlan,
	DEFAULT_FALLBACK_MS,
	DEFAULT_MAX_SHARDS,
	DEFAULT_SETUP_MS,
	DEFAULT_TARGET_MS,
	planShards,
	shardManifest,
	type CaseEstimate,
	type PlanConfig,
} from "./shard-plan.ts";

const config = (overrides: Partial<PlanConfig> = {}): PlanConfig => ({
	maxShards: DEFAULT_MAX_SHARDS,
	targetMs: DEFAULT_TARGET_MS,
	setupMs: DEFAULT_SETUP_MS,
	fallbackMs: DEFAULT_FALLBACK_MS,
	...overrides,
});

const estimate = (id: string, ms: number, measured = true): CaseEstimate => ({
	id,
	estimatedMs: ms,
	measured,
});

const partition = (shards: { tests: string[] }[]) => shards.flatMap((shard) => shard.tests);

describe("planShards", () => {
	test("an empty run set schedules no shards", () => {
		assert.deepEqual(planShards([], config()), []);
	});

	test("a single case always lands on one shard", () => {
		const shards = planShards([estimate("A", 30 * 60_000)], config());
		assert.equal(shards.length, 1);
		assert.deepEqual(shards[0].tests, ["A"]);
	});

	test("small selections stay on one shard regardless of history", () => {
		const shards = planShards(
			[estimate("A", 60_000), estimate("B", 90_000), estimate("C", 120_000, false)],
			config({ targetMs: 10 * 60_000 }),
		);
		assert.equal(shards.length, 1);
	});

	test("balances longest-first onto the least-loaded shard", () => {
		// 15 + 5 vs 5 + 5 + 5 — the trait-split scenario #2263 replaces.
		const shards = planShards(
			[
				estimate("Pilot", 15 * 60_000),
				estimate("Reader", 5 * 60_000),
				estimate("Scroll", 5 * 60_000),
				estimate("Perushim", 5 * 60_000),
				estimate("Shared", 5 * 60_000),
			],
			config({ targetMs: 12 * 60_000, maxShards: 4 }),
		);
		// total 35min / 12min target → 3 shards; LPT places the biggest case
		// alone and pairs the five-minute cases on the remaining two.
		assert.equal(shards.length, 3);
		assert.deepEqual(
			shards.map((shard) => shard.tests),
			[["Pilot"], ["Perushim", "Scroll"], ["Reader", "Shared"]],
		);
		assert.equal(partition(shards).sort().join(","), "Perushim,Pilot,Reader,Scroll,Shared");
	});

	test("caps the shard count at the configured maximum", () => {
		const estimates = Array.from({ length: 20 }, (_, i) =>
			estimate(`T${String(i).padStart(2, "0")}`, 10 * 60_000));
		const shards = planShards(estimates, config({ maxShards: 3, targetMs: 60_000 }));
		assert.equal(shards.length, 3);
		assert.equal(partition(shards).length, 20);
	});

	test("never exceeds the case count", () => {
		const shards = planShards(
			[estimate("A", 60 * 60_000), estimate("B", 60 * 60_000)],
			config({ maxShards: 8, targetMs: 30 * 60_000 }),
		);
		assert.equal(shards.length, 2);
	});

	test("folds a scrap shard into the least-loaded peer", () => {
		const shards = planShards(
			[estimate("Big", 25 * 60_000), estimate("AlsoBig", 24 * 60_000), estimate("Tiny", 30_000)],
			config({ targetMs: 12 * 60_000, maxShards: 4 }),
		);
		// ceil(49.5/12) = 5 → capped to 3 cases... wait, count is also capped by
		// ordered.length (3) → 3 shards; then the 30s Tiny is under MIN_SHARD_MS
		// and folds into the lighter shard.
		assert.equal(shards.length, 2);
		assert.ok(partition(shards).includes("Tiny"));
	});

	test("is deterministic for identical inputs", () => {
		const estimates = [
			estimate("Z", 100_000), estimate("A", 300_000, false), estimate("M", 200_000),
		];
		const first = planShards(estimates, config({ targetMs: 100_000, maxShards: 3 }));
		const second = planShards([...estimates].reverse(), config({ targetMs: 100_000, maxShards: 3 }));
		assert.deepEqual(first, second);
	});

	test("equal estimates tie-break on sorted test id", () => {
		const shards = planShards(
			[estimate("B", 100_000), estimate("A", 100_000), estimate("C", 100_000)],
			config({ targetMs: 100_000, maxShards: 3 }),
		);
		assert.equal(shards.length, 3);
		assert.deepEqual(shards.map((shard) => shard.tests[0]), ["A", "B", "C"]);
	});
});

describe("buildPlan", () => {
	const base = {
		suite: "app-mobile-e2e",
		platform: "ios",
		mode: "shadow" as const,
		testedSha: "b".repeat(40),
		snapshotSha: "a".repeat(40),
	};

	test("partitions the run set exactly once and reports totals", () => {
		const runSet = ["A", "B", "C"];
		const plan = buildPlan({
			...base,
			runSet,
			estimates: [estimate("A", 30 * 60_000), estimate("B", 20 * 60_000), estimate("C", 10 * 60_000, false)],
			config: config({ targetMs: 25 * 60_000 }),
		});
		assert.equal(plan.shards.length, 3);
		assert.equal(plan.totals.caseMs, 60 * 60_000);
		assert.equal(plan.totals.makespanMs, DEFAULT_SETUP_MS + 30 * 60_000);
		assert.deepEqual(plan.totals.unmeasuredIds, ["C"]);
		assert.equal(plan.runSet.join(","), "A,B,C");
	});

	test("a duplicate run-set id is an invalid manifest, not a shard to plan", () => {
		assert.throws(
			() => buildPlan({
				...base,
				runSet: ["A", "A"],
				estimates: [estimate("A", 60_000)],
				config: config(),
			}),
			/duplicate/,
		);
	});

	test("empty run set produces an explicit zero-shard plan", () => {
		const plan = buildPlan({ ...base, runSet: [], estimates: [], config: config() });
		assert.deepEqual(plan.shards, []);
		assert.equal(plan.totals.makespanMs, DEFAULT_SETUP_MS);
	});
});

describe("shardManifest", () => {
	test("emits a MOBILE_E2E_SELECTION-compatible manifest per shard", () => {
		const plan = buildPlan({
			suite: "app-mobile-e2e",
			platform: "ios",
			mode: "enforce",
			testedSha: "b".repeat(40),
			snapshotSha: null,
			runSet: ["A", "B"],
			estimates: [estimate("A", 300_000), estimate("B", 100_000)],
			config: config({ targetMs: 100_000 }),
		});
		const manifest = shardManifest(plan, plan.shards[1], new Map([["B", ["covered-file:x.cs"]]]));
		assert.equal(manifest.selectAll, false);
		assert.equal(manifest.shard, 2);
		assert.equal(manifest.shards, 2);
		assert.deepEqual(manifest.selected, [{ id: "B", reasons: ["covered-file:x.cs"] }]);
	});
});
