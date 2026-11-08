/** @jest-environment node */
import { reduceFrameSamples } from "../../util/frame-metrics";

const FRAME_BUDGET_MS = 33.4;

describe("reduceFrameSamples", () => {
	it("returns zero frame metrics for an empty probe", () => {
		expect(
			reduceFrameSamples({ frames: [], longtaskMs: 0 }, FRAME_BUDGET_MS),
		).toEqual({ frames: 0, blockedMs: 0, longFrames: 0, longtaskMs: 0 });
	});

	it("does not report floating-point residue at the frame budget", () => {
		const gap = 545.7 - 512.3;
		expect(gap - FRAME_BUDGET_MS).toBe(9.237055564881302e-14);
		expect(
			reduceFrameSamples({ frames: [gap], longtaskMs: 0 }, FRAME_BUDGET_MS),
		).toEqual({ frames: 1, blockedMs: 0, longFrames: 0, longtaskMs: 0 });
	});

	it("keeps an exact 50ms timestamp interval out of the long-frame count", () => {
		const gap = 64.4 - 14.4;
		expect(gap).toBeGreaterThan(50);
		expect(
			reduceFrameSamples({ frames: [gap], longtaskMs: 0 }, FRAME_BUDGET_MS),
		).toEqual({ frames: 1, blockedMs: 16.6, longFrames: 0, longtaskMs: 0 });
	});

	it.each([
		[33.400001, 0.000001, 0],
		[33.401, 0.001, 0],
		[49.999999, 16.599999, 0],
		[50, 16.6, 0],
		[50.000001, 16.600001, 1],
		[50.1, 16.7, 1],
	])(
		"preserves genuine excess for a %sms gap",
		(gap, blockedMs, longFrames) => {
			expect(
				reduceFrameSamples({ frames: [gap], longtaskMs: 0 }, FRAME_BUDGET_MS),
			).toEqual({ frames: 1, blockedMs, longFrames, longtaskMs: 0 });
		},
	);

	it("retains all samples and the native long-task total without mutation", () => {
		const frames = Object.freeze([0, 16.7, 33.4]);
		const samples = Object.freeze({ frames, longtaskMs: 12.3456789012345 });
		expect(reduceFrameSamples(samples, FRAME_BUDGET_MS)).toEqual({
			frames: 3,
			blockedMs: 0,
			longFrames: 0,
			longtaskMs: samples.longtaskMs,
		});
		expect(samples.frames).toBe(frames);
	});

	it("sums genuine excess exactly across fractional frame gaps", () => {
		expect(
			reduceFrameSamples(
				{ frames: [33.401, 50.000001, 50.1, 16.7], longtaskMs: 51.125 },
				FRAME_BUDGET_MS,
			),
		).toEqual({
			frames: 4,
			blockedMs: 33.301001,
			longFrames: 2,
			longtaskMs: 51.125,
		});
	});

	it("uses the supplied frame budget without changing the 50ms boundary", () => {
		expect(
			reduceFrameSamples(
				{ frames: [40, 40.000001, 50.000001], longtaskMs: 0 },
				40,
			),
		).toEqual({
			frames: 3,
			blockedMs: 10.000002,
			longFrames: 1,
			longtaskMs: 0,
		});
	});
});
