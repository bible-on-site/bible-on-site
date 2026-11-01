/** @jest-environment node */
import {
	reduceTurnSamples,
	type TurnSamples,
	turnBudgetFailures,
} from "../../util/turn-metrics";

function healthy(): TurnSamples {
	return {
		inputs: Array.from({ length: 6 }, (_, index) => ({
			at: index * 1_000,
			chapter: 300 + index,
			trusted: true,
			firstMotion: index * 1_000 + 16,
			responseFrame: index * 1_000 + 33,
			settled: index * 1_000 + 800,
		})),
		frames: Array.from({ length: 300 }, () => 16.7),
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

it("rejects a 250ms second-turn pause even when the other five turns are fast", () => {
	const samples = healthy();
	samples.inputs[1].responseFrame = 1_250;
	samples.frames[100] = 250;
	const metrics = reduceTurnSamples(samples, 300, 6);
	expect(metrics.responseP95Ms).toBe(250);
	expect(metrics.frameGapMaxMs).toBe(250);
	expect(turnBudgetFailures(metrics)).toHaveLength(2);
});

it("guards sustained dropped frames separately from the worst pause", () => {
	const samples = healthy();
	samples.frames = Array.from({ length: 100 }, (_, i) =>
		i < 10 ? 66.7 : 16.7,
	);
	expect(turnBudgetFailures(reduceTurnSamples(samples, 300, 6))).toEqual([
		"frameGapP95Ms=66.7ms > 50ms",
	]);
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
])("rejects invalid/incomplete measurements %#", (damage) => {
	const samples = healthy();
	damage(samples);
	expect(() => reduceTurnSamples(samples, 300, 6)).toThrow();
});
