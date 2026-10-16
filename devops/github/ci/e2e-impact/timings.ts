/**
 * Per-case runtime observation for runtime-aware shard planning (#2263).
 *
 * Three measurement sources, in order of fidelity:
 *   1. `case-timings.json` — written by the shard merger for multi-runner
 *      runs; already normalized to `{ testId: ms }`.
 *   2. `results/mobile-e2e.xml` — the JUnit report; `time` on a `testcase`
 *      spans the whole case including fixture init (device session, app
 *      install), which is the honest cost a shard pays for the case.
 *   3. coverage-evidence spans — `startedUtc`/`endedUtc` recorded around the
 *      scenario body. Used only when no report exists; a cheaper number, so
 *      the overhead split becomes "everything else" by subtraction.
 *
 * Identity is the xUnit FQN (`Namespace.Class.Method`): JUnit `classname.name`
 * or a fully qualified `name`, with a theory's `(args)` suffix stripped —
 * parameterized cases share the method's identity like discovery does.
 * Retried attempts sum into the case: reruns cost the runner real time.
 * Failed cases count — their consumed wall-clock is real scheduling cost;
 * skipped/notrun cases never produce a sample (a zero-cost row would poison
 * the mean, and an unselected case is unmeasured, not instant).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { child, descendants, parseXml } from "../../../e2e-coverage-trees/xml.ts";
import type { CaseTiming, OverheadTiming } from "./model.ts";

/**
 * Rolling-average weight cap: a new observation always shifts the mean by at
 * least 1/CAP, so a case that slows permanently converges instead of being
 * diluted by unbounded history. `samples` saturates at the cap value.
 */
export const TIMING_SAMPLE_CAP = 20;

function rollingMean(
	prior: { samples: number; meanMs: number } | undefined,
	observedMs: number,
): { samples: number; meanMs: number } {
	const weight = Math.min(prior?.samples ?? 0, TIMING_SAMPLE_CAP - 1);
	return {
		samples: Math.min((prior?.samples ?? 0) + 1, TIMING_SAMPLE_CAP),
		meanMs:
			prior === undefined
				? Math.round(observedMs)
				: Math.round((prior.meanMs * weight + observedMs) / (weight + 1)),
	};
}

/**
 * Folds one observed duration into a case's history. `observedMs` of
 * `undefined` carries the prior entry forward unchanged — a test that ran
 * but produced no timing row keeps its history rather than regressing to
 * "unmeasured".
 */
export function mergeTiming(
	prior: CaseTiming | undefined,
	observedMs: number | undefined,
	now: Date,
): CaseTiming | undefined {
	if (observedMs === undefined) return prior;
	const { samples, meanMs } = rollingMean(prior, observedMs);
	return { samples, meanMs, lastMs: Math.round(observedMs), updatedAtUtc: now.toISOString() };
}

/** Same rolling mean for the non-case pilot overhead. */
export function mergeOverhead(
	prior: OverheadTiming | undefined,
	observedMs: number | undefined,
): OverheadTiming | undefined {
	if (observedMs === undefined) return prior;
	return rollingMean(prior, observedMs);
}

/** Per-case durations from a JUnit report; `null` when the report is absent. */
export function junitDurations(path: string): Map<string, number> | null {
	if (!existsSync(path)) return null;
	const root = parseXml(readFileSync(path, "utf8"));
	const durations = new Map<string, number>();
	for (const testcase of descendants(root, "testcase")) {
		if (child(testcase, "skipped") !== null) continue;
		const seconds = Number.parseFloat(testcase.attrs.time ?? "");
		// JUnit writers disagree on the attribute case — accept both like
		// `loadJunit` does, or a `className` report silently yields no times.
		const className = testcase.attrs.classname ?? testcase.attrs.className ?? "";
		const name = testcase.attrs.name ?? "";
		if (!Number.isFinite(seconds) || className === "" || name === "") continue;
		const id = (name.startsWith(`${className}.`) ? name : `${className}.${name}`)
			.replace(/\(.*$/, "");
		durations.set(id, (durations.get(id) ?? 0) + seconds * 1000);
	}
	return durations;
}

/** Per-case spans summed from coverage evidence records. */
export function evidenceDurations(
	records: {
		test: string;
		outcome?: string;
		startedUtc?: string;
		endedUtc?: string;
	}[],
): Map<string, number> {
	const durations = new Map<string, number>();
	for (const record of records) {
		if (record.outcome !== "passed" && record.outcome !== "failed") continue;
		const start = Date.parse(record.startedUtc ?? "");
		const end = Date.parse(record.endedUtc ?? "");
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		durations.set(record.test, (durations.get(record.test) ?? 0) + (end - start));
	}
	return durations;
}

/**
 * A run's measured case durations for an artifacts directory: the merger's
 * sidecar, else the JUnit report, else evidence spans.
 */
export function caseDurations(
	artifactsDir: string,
	records: { test: string; outcome?: string; startedUtc?: string; endedUtc?: string }[],
): Map<string, number> {
	const sidecar = join(artifactsDir, "case-timings.json");
	if (existsSync(sidecar)) {
		const raw = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
		const durations = new Map<string, number>();
		for (const [id, ms] of Object.entries(raw)) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
				throw new Error(`case-timings.json: invalid duration for ${id}`);
			}
			durations.set(id, ms);
		}
		return durations;
	}
	return junitDurations(join(artifactsDir, "results", "mobile-e2e.xml"))
		?? evidenceDurations(records);
}

/**
 * Non-case pilot time: the supervised wall clock minus summed case durations.
 * Only a completed pilot yields a sample — an aborted run cannot say where
 * its remaining time would have gone.
 */
export function observedOverheadMs(
	artifactsDir: string,
	durations: Map<string, number>,
): number | null {
	const path = join(artifactsDir, "pilot-timing.json");
	if (!existsSync(path)) return null;
	const pilot = JSON.parse(readFileSync(path, "utf8")) as {
		status?: string;
		elapsedMs?: number;
	};
	if (pilot.status !== "completed" || !Number.isFinite(pilot.elapsedMs)) return null;
	const caseMs = [...durations.values()].reduce((sum, ms) => sum + ms, 0);
	const overhead = (pilot.elapsedMs as number) - caseMs;
	return overhead > 0 ? overhead : null;
}
