/**
 * Deterministic runtime-balanced iOS shard planning (#2263).
 *
 * The selector decides WHICH cases run; this module only partitions that
 * decided set across bounded parallel shards — timing shifts the balance,
 * never the membership. Cases are estimated by the history's rolling mean
 * (`CoverageTreeTest.timing`) and unmeasured cases take a fixed fallback
 * weight, so identical (runSet, history, config) inputs always produce the
 * identical plan.
 *
 * Shard count is chosen from the work, not from a fixed partition:
 *   ceil(total estimated case ms / per-shard target ms), clamped to
 *   [1, min(maxShards, case count)]. The target is a runner's capacity, not a
 *   speed goal: macOS runners are the scarce, queued resource, and every extra
 *   shard repeats ~6 minutes of setup, so the plan uses the fewest shards whose
 *   pilots fit the supervisor's scaled deadline. A post-pass folds a shard whose
 *   assignment is thinner than MIN_SHARD_MS into the least-loaded peer —
 *   a shard carrying seconds of tests still costs the full job setup
 *   (restore caches, workload, build, simulator boot), so it would only
 *   ever delay the makespan it was meant to shorten.
 *
 * Assignment is longest-processing-time-first onto the least-loaded shard;
 * equal estimates and equal loads both break ties on the sorted test id /
 * lowest shard index, keeping the plan byte-for-byte reproducible.
 */
import { fingerprint, SCHEMA_VERSION } from "./model.ts";

export interface CaseEstimate {
	id: string;
	estimatedMs: number;
	/** False when the estimate is the unmeasured fallback weight. */
	measured: boolean;
}

export interface ShardAssignment {
	/** 1-based shard index — also the matrix `shard` value and artifact suffix. */
	shard: number;
	tests: string[];
	estimatedMs: number;
}

export interface PlanConfig {
	maxShards: number;
	/** Per-shard case-time capacity; the plan uses the fewest shards that fit it. */
	targetMs: number;
	/**
	 * Estimated cost of one additional shard job (caches, workload, build,
	 * boot + measured pilot overhead). Reporting only — the shard count keys
	 * on the case-time budget.
	 */
	setupMs: number;
	/** Weight for a case with no timing history. */
	fallbackMs: number;
}

export interface IosShardPlan {
	kind: "ios-shard-plan";
	schemaVersion: number;
	suite: string;
	platform: string;
	mode: "shadow" | "enforce";
	testedSha: string;
	snapshotSha: string | null;
	/** sha256 over (runSet, estimates, config) — replayability check. */
	fingerprint: string;
	/** Every case id the run must execute exactly once across all shards. */
	runSet: string[];
	shards: ShardAssignment[];
	config: PlanConfig;
	totals: {
		caseMs: number;
		/** setup + slowest shard — the end-to-end estimate, queue aside. */
		makespanMs: number;
		unmeasuredIds: string[];
	};
}

export const DEFAULT_MAX_SHARDS = 4;
// Keep 1.5 × target + 5m (supervise.mjs pilotTimeoutMs) within its 45m cap.
export const DEFAULT_TARGET_MS = 26 * 60_000;
/** Job bring-up measured from runs: caches, workload, app build, sim boot. */
export const DEFAULT_SETUP_MS = 18 * 60_000;
export const DEFAULT_FALLBACK_MS = 120_000;
export const MIN_SHARD_MS = 60_000;

export function planShards(
	estimates: CaseEstimate[],
	config: PlanConfig,
): ShardAssignment[] {
	if (estimates.length === 0) return [];
	const ordered = [...estimates].sort(
		(a, b) => b.estimatedMs - a.estimatedMs || a.id.localeCompare(b.id),
	);
	const totalMs = ordered.reduce((sum, entry) => sum + entry.estimatedMs, 0);
	const count = Math.max(
		1,
		Math.min(config.maxShards, ordered.length, Math.ceil(totalMs / config.targetMs)),
	);
	const shards: ShardAssignment[] = Array.from({ length: count }, (_, index) => ({
		shard: index + 1,
		tests: [],
		estimatedMs: 0,
	}));
	for (const entry of ordered) {
		// reduce keeps the FIRST minimum — equal loads prefer the lower index.
		const target = shards.reduce((least, shard) =>
			shard.estimatedMs < least.estimatedMs ? shard : least,
		);
		target.tests.push(entry.id);
		target.estimatedMs += entry.estimatedMs;
	}
	// A shard carrying scraps is never worth its job setup: fold it into the
	// least-loaded peer while such a shard exists and more than one remains.
	while (shards.length > 1) {
		const smallest = shards.reduce((least, shard) =>
			shard.estimatedMs < least.estimatedMs ? shard : least,
		);
		if (smallest.estimatedMs >= MIN_SHARD_MS) break;
		shards.splice(shards.indexOf(smallest), 1);
		const target = shards.reduce((least, shard) =>
			shard.estimatedMs < least.estimatedMs ? shard : least,
		);
		target.tests.push(...smallest.tests);
		target.estimatedMs += smallest.estimatedMs;
	}
	for (const [index, shard] of shards.entries()) {
		shard.shard = index + 1;
		shard.tests.sort();
	}
	return shards;
}

export function buildPlan(input: {
	suite: string;
	platform: string;
	mode: "shadow" | "enforce";
	testedSha: string;
	snapshotSha: string | null;
	runSet: string[];
	estimates: CaseEstimate[];
	config: PlanConfig;
}): IosShardPlan {
	const shards = planShards(input.estimates, input.config);
	const byId = new Map(input.estimates.map((entry) => [entry.id, entry]));
	const expected = new Set(input.runSet);
	if (expected.size !== input.runSet.length) {
		throw new Error("The shard run set contains duplicate case ids.");
	}
	const planned = shards.flatMap((shard) => shard.tests);
	if (
		planned.length !== input.runSet.length ||
		planned.some((id) => !expected.has(id))
	) {
		throw new Error("The shard plan does not partition the run set exactly once.");
	}
	return {
		kind: "ios-shard-plan",
		schemaVersion: SCHEMA_VERSION,
		suite: input.suite,
		platform: input.platform,
		mode: input.mode,
		testedSha: input.testedSha,
		snapshotSha: input.snapshotSha,
		fingerprint: fingerprint([
			input.runSet,
			input.estimates.map((entry) => [entry.id, entry.estimatedMs]),
			input.config,
		]),
		runSet: [...input.runSet].sort(),
		shards,
		config: input.config,
		totals: {
			caseMs: input.estimates.reduce((sum, entry) => sum + entry.estimatedMs, 0),
			makespanMs:
				input.config.setupMs +
				(shards.length === 0
					? 0
					: Math.max(...shards.map((shard) => shard.estimatedMs))),
			unmeasuredIds: input.runSet
				.filter((id) => byId.get(id)?.measured === false)
				.sort(),
		},
	};
}

/**
 * The manifest a shard's runner consumes through MOBILE_E2E_SELECTION — same
 * `selectAll`/`selected[].id` contract the C# harness already implements, so
 * unassigned cases skip inside the process rather than by filter magic.
 */
export function shardManifest(
	plan: IosShardPlan,
	shard: ShardAssignment,
	reasons: Map<string, string[]>,
): Record<string, unknown> {
	return {
		schemaVersion: SCHEMA_VERSION,
		suite: plan.suite,
		platform: plan.platform,
		mode: "subset",
		selectAll: false,
		testedSha: plan.testedSha,
		shard: shard.shard,
		shards: plan.shards.length,
		estimatedMs: shard.estimatedMs,
		selected: shard.tests.map((id) => ({
			id,
			reasons: reasons.get(id) ?? [`shard:${shard.shard}`],
		})),
	};
}
