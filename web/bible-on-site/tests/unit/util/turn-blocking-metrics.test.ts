/** @jest-environment node */
import numbers from "../../../../../docs/website/sefer-turn-performance.blocking-baseline-125.json";
import kings from "../../../../../docs/website/sefer-turn-performance.blocking-baseline-300.json";
import {
	reduceTurnBlockingSamples,
	type TurnLongAnimationFrame,
	type TurnSamples,
	turnBlockingBudgetFailures,
} from "../../util/turn-metrics";

it.each([...numbers.cases, ...kings.cases])(
	"replays $dataset $chapter $mode $gesture without changing its samples",
	(record) => {
		const before = structuredClone(record.samples);
		const metrics = reduceTurnBlockingSamples(
			record.samples,
			record.chapter,
			6,
		);
		expect(turnBlockingBudgetFailures(metrics).length > 0).toBe(
			record.expectedBlockingFailure,
		);
		expect(record.samples).toEqual(before);
	},
);

function sample(blockingDuration: number, startTime: number): TurnSamples {
	const frame: TurnLongAnimationFrame = {
		startTime,
		duration: blockingDuration + 50,
		blockingDuration,
		firstUIEventTimestamp: startTime,
		renderStart: startTime,
		styleAndLayoutStart: startTime,
		scripts: [],
	};
	return {
		inputs: [0, 1].map((index) => ({
			at: index * 1_000,
			trusted: true,
			chapter: 300 + index,
			firstMotion: index * 1_000 + 16,
			responseFrame: index * 1_000 + 32,
			settled: index * 1_000 + 800,
			frameStart: index * 60,
			frameEnd: index * 60 + 48,
		})),
		frames: Array.from({ length: 120 }, () => 16.7),
		longAnimationFramesSupported: true,
		longAnimationFrames: [frame],
	};
}

it.each([
	[100, "first turn", "consecutive turns"],
	[1_100, "consecutive turns", "first turn"],
] as const)(
	"detects independent blocking at %sms",
	(start, failing, healthy) => {
		const failures = turnBlockingBudgetFailures(
			reduceTurnBlockingSamples(sample(200, start), 300, 2),
		);
		expect(failures).toHaveLength(2);
		expect(failures.some((failure) => failure.startsWith(`${failing}/`))).toBe(
			true,
		);
		expect(failures.some((failure) => failure.startsWith(`${healthy}/`))).toBe(
			false,
		);
	},
);

it("does not hide a block spanning the first-turn handoff", () => {
	const failures = turnBlockingBudgetFailures(
		reduceTurnBlockingSamples(sample(200, 750), 300, 2),
	);
	expect(failures).toHaveLength(3);
});

it("preserves the strict limit and supports genuinely absent long frames", () => {
	expect(
		turnBlockingBudgetFailures(
			reduceTurnBlockingSamples(sample(50, 100), 300, 2),
		),
	).toEqual([]);
	expect(
		turnBlockingBudgetFailures(
			reduceTurnBlockingSamples(sample(50.001, 100), 300, 2),
		),
	).toHaveLength(2);
	const samples = sample(0, 100);
	samples.longAnimationFrames = [];
	expect(
		turnBlockingBudgetFailures(reduceTurnBlockingSamples(samples, 300, 2)),
	).toEqual([]);
});

it.each([undefined, false])(
	"rejects unsupported or missing browser evidence: %s",
	(supported) => {
		const samples = sample(0, 100);
		samples.longAnimationFramesSupported = supported;
		expect(() => reduceTurnBlockingSamples(samples, 300, 2)).toThrow(
			"evidence missing",
		);
	},
);

it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
	"rejects invalid blocking duration %s",
	(blocking) => {
		expect(() =>
			reduceTurnBlockingSamples(sample(blocking, 100), 300, 2),
		).toThrow("Invalid browser");
	},
);
