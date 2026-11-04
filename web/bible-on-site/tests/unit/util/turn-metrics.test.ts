/** @jest-environment node */
import panelBaseline from "../../../../../docs/website/sefer-turn-performance.panel-baseline.json";
import {
	reduceTurnSamples,
	type TurnSamples,
	turnBudgetFailures,
} from "../../util/turn-metrics";

it.each(panelBaseline.cases)(
	"preserves every native timing and failure in $case",
	(record) => {
		const metrics = reduceTurnSamples(record.samples, record.chapter, 6);
		expect(metrics).toEqual(record.metrics);
		expect(turnBudgetFailures(metrics)).toEqual(record.failures);
	},
);

function healthy(): TurnSamples {
	return {
		inputs: Array.from({ length: 6 }, (_, index) => ({
			at: index * 1_000,
			chapter: 300 + index,
			trusted: true,
			firstMotion: index * 1_000 + 16,
			responseFrame: index * 1_000 + 33,
			settled: index * 1_000 + 800,
			frameStart: index * 60,
			frameEnd: index * 60 + 48,
		})),
		frames: Array.from({ length: 400 }, () => 16.7),
	};
}

it("keeps every turn and accepts a responsive sequence", () => {
	const samples = healthy();
	const before = structuredClone(samples);
	const metrics = reduceTurnSamples(samples, 300, 6);
	expect(metrics.responseMs).toEqual([33, 33, 33, 33, 33, 33]);
	expect(turnBudgetFailures(metrics)).toEqual([]);
	expect(samples).toEqual(before);
});

it("uses integer clock units without turning binary subtraction noise into an overrun", () => {
	const samples = healthy();
	samples.inputs[0].responseFrame = 200.00000000000003;
	samples.frames.fill(50.000000000000455);
	samples.frames[0] = 100.00000000000045;
	const before = structuredClone(samples);
	const metrics = reduceTurnSamples(samples, 300, 6);
	expect(metrics.responseP95Ms).toBe(200);
	expect(metrics.frameGapMaxMs).toBe(100);
	expect(metrics.frameGapP95Ms).toBe(50);
	expect(turnBudgetFailures(metrics)).toEqual([]);
	expect(samples).toEqual(before);
});

it.each([50.001, 50.1])("rejects a real frame-gap p95 of %sms", (gap) => {
	const samples = healthy();
	samples.frames.fill(gap);
	const failures = turnBudgetFailures(reduceTurnSamples(samples, 300, 6));
	for (const phase of ["all turns", "first turn", "consecutive turns"])
		expect(failures).toContain(`${phase}/frameGapP95Ms=${gap}ms > 50ms`);
});

it.each([100.001, 100.1])("rejects a real maximum frame gap of %sms", (gap) => {
	const samples = healthy();
	samples.frames[0] = gap;
	expect(turnBudgetFailures(reduceTurnSamples(samples, 300, 6))).toContain(
		`all turns/frameGapMaxMs=${gap}ms > 100ms`,
	);
});

it.each([200.001, 200.1])(
	"rejects a real input response of %sms",
	(response) => {
		const samples = healthy();
		samples.inputs[0].responseFrame = response;
		expect(turnBudgetFailures(reduceTurnSamples(samples, 300, 6))).toContain(
			`first turn/responseP95Ms=${response}ms > 200ms`,
		);
	},
);

it("rejects a 250ms second-turn pause even when the other five turns are fast", () => {
	const samples = healthy();
	samples.inputs[1].responseFrame = 1_250;
	samples.frames[100] = 250;
	const metrics = reduceTurnSamples(samples, 300, 6);
	expect(metrics.responseP95Ms).toBe(250);
	expect(metrics.frameGapMaxMs).toBe(250);
	expect(turnBudgetFailures(metrics)).toContain(
		"consecutive turns/responseP95Ms=250ms > 200ms",
	);
	expect(turnBudgetFailures(metrics)).toContain(
		"all turns/frameGapMaxMs=250ms > 100ms",
	);
});

it("guards sustained dropped frames separately from the worst pause", () => {
	const samples = healthy();
	samples.frames = Array.from({ length: 400 }, (_, i) => (i < 6 ? 66.7 : 16.7));
	expect(turnBudgetFailures(reduceTurnSamples(samples, 300, 6))).toEqual([
		"first turn/frameGapP95Ms=66.7ms > 50ms",
	]);
});

it("reports a slow first turn independently from responsive consecutive turns", () => {
	const samples = healthy();
	samples.inputs[0].responseFrame = 250;
	const metrics = reduceTurnSamples(samples, 300, 6);
	expect(metrics.firstTurn.responseP95Ms).toBe(250);
	expect(metrics.consecutiveTurns.responseP95Ms).toBe(33);
	expect(turnBudgetFailures(metrics)).toContain(
		"first turn/responseP95Ms=250ms > 200ms",
	);
});

it.each([
	(s: TurnSamples) => s.inputs.pop(),
	(s: TurnSamples) => {
		s.inputs[1].chapter = 300;
	},
	(s: TurnSamples) => {
		s.inputs[1].responseFrame = null;
	},
	(s: TurnSamples) => {
		s.inputs[1].settled = null;
	},
	(s: TurnSamples) => {
		s.inputs[1].trusted = false;
	},
	(s: TurnSamples) => {
		s.inputs[1].at = 799;
	},
	(s: TurnSamples) => {
		s.inputs[1].firstMotion = 999;
	},
	(s: TurnSamples) => {
		s.inputs[1].responseFrame = Number.NaN;
	},
	(s: TurnSamples) => {
		s.frames = [];
	},
	(s: TurnSamples) => {
		s.frames[0] = -1;
	},
	(s: TurnSamples) => {
		s.frames[0] = 0.0001;
	},
	(s: TurnSamples) => {
		s.inputs[0].firstMotion = 0.0001;
		s.inputs[0].responseFrame = 0.0002;
	},
	(s: TurnSamples) => {
		s.frames[0] = Number.MAX_SAFE_INTEGER;
	},
	(s: TurnSamples) => {
		s.inputs[5].responseFrame = 10_000_000_000_000;
		s.inputs[5].settled = 10_000_000_000_100;
	},
	(s: TurnSamples) => {
		s.inputs[0].frameEnd = null;
	},
	(s: TurnSamples) => {
		s.inputs[5].frameEnd = s.frames.length + 1;
	},
])("rejects invalid/incomplete measurements %#", (damage) => {
	const samples = healthy();
	damage(samples);
	expect(() => reduceTurnSamples(samples, 300, 6)).toThrow();
});
