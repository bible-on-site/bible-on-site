/** @jest-environment node */
import numbers from "../../../../../docs/website/sefer-turn-performance.blocking-baseline-125.json";
import kings from "../../../../../docs/website/sefer-turn-performance.blocking-baseline-300.json";
import desktop from "../../../../../docs/website/sefer-turn-performance.desktop-baseline.json";
import diagnosticFirst from "../../../../../docs/website/sefer-turn-performance.hosted-diagnostic-1.json";
import diagnosticSecond from "../../../../../docs/website/sefer-turn-performance.hosted-diagnostic-2.json";
import diagnosticThird from "../../../../../docs/website/sefer-turn-performance.hosted-diagnostic-3.json";
import hosted from "../../../../../docs/website/sefer-turn-performance.hosted-repeatability.json";
import {
	reduceTurnBlockingSamples,
	reduceTurnSamples,
	type TurnLongAnimationFrame,
	type TurnSamples,
	turnBlockingBudgetFailures,
	turnProfileSettings,
	turnQualificationFailures,
	turnRenderingProfile,
	turnVisibilityFailures,
} from "../../util/turn-metrics";

it.each([
	...diagnosticFirst.cases,
	...diagnosticSecond.cases,
	...diagnosticThird.cases,
])(
	"retains original diagnostic attempt $attempt: $chapter $mode $gesture",
	(record) => {
		const original = structuredClone(record.samples);
		expect(record.samples.inputs).toHaveLength(6);
		expect(
			turnQualificationFailures(
				reduceTurnSamples(record.samples, record.chapter, 6),
				reduceTurnBlockingSamples(record.samples, record.chapter, 6),
				turnRenderingProfile(record.gpu),
			),
		).toEqual(record.expectedFailures);
		expect(turnVisibilityFailures(record.samples.visibility)).toEqual([]);
		expect(record.samples).toEqual(original);
	},
);

it.each(hosted.cases)(
	"retains hosted attempt $attempt: $chapter $mode $gesture",
	(record) => {
		const original = structuredClone(record.samples);
		const failures = turnQualificationFailures(
			reduceTurnSamples(record.samples, record.chapter, 6),
			reduceTurnBlockingSamples(record.samples, record.chapter, 6),
			turnRenderingProfile(record.gpu),
		);
		expect(failures.length > 0).toBe(record.expectedFailure);
		if (record.expectedFailure) {
			expect(failures).toContain(
				"first turn/blockingDurationMaxMs=187.9ms > 50ms",
			);
			expect(
				record.samples.longAnimationFrames.find(
					(frame) => frame.blockingDuration === 187.9,
				)?.scripts,
			).toEqual([]);
		}
		expect(turnVisibilityFailures(record.samples.visibility)).toEqual([]);
		expect(record.samples).toEqual(original);
	},
);

it.each(desktop.cases)(
	"guards the natural desktop bad mark: $phase $chapter $mode $gesture",
	(record) => {
		const before = structuredClone(record.samples);
		const failures = turnQualificationFailures(
			reduceTurnSamples(record.samples, record.chapter, 6),
			reduceTurnBlockingSamples(record.samples, record.chapter, 6),
			"hardware-cadence",
		);
		expect(failures.length > 0).toBe(record.expectedFailure);
		if (record.expectedFailure) {
			expect(
				failures.some((failure) => failure.startsWith("consecutive turns/")),
			).toBe(true);
			if (record.mode === "leaf" && record.gesture === "drag") {
				expect(
					failures.some((failure) => failure.startsWith("first turn/")),
				).toBe(true);
			}
		}
		expect(record.samples).toEqual(before);
	},
);

it("uses fixed presentation and work profiles without host calibration", () => {
	expect(turnProfileSettings("hardware-cadence")).toEqual({
		cpuRate: 1,
		limits: { responseP95Ms: 100, frameGapMaxMs: 100, frameGapP95Ms: 25 },
	});
	expect(turnProfileSettings("software-work")).toEqual({
		cpuRate: 4,
		limits: { responseP95Ms: 200, frameGapMaxMs: 100, frameGapP95Ms: 50 },
	});
});

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
		expect(
			turnQualificationFailures(
				reduceTurnSamples(record.samples, record.chapter, 6),
				metrics,
				"software-work",
			).length > 0,
		).toBe(record.expectedBlockingFailure);
		expect(record.samples).toEqual(before);
	},
);

function sample(
	blockingDuration: number,
	startTime: number,
	duration = blockingDuration + 50,
): TurnSamples {
	const frame: TurnLongAnimationFrame = {
		startTime,
		duration,
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

it("retains a pre-input browser pause as a diagnostic instead of turn blocking", () => {
	// The original CI frame ended at 1859.5ms; the first trusted pointerdown
	// arrived at 1860.2ms. First-turn blocking was 19ms, but the sequence
	// incorrectly inherited this earlier 156.6ms setup pause.
	const samples = sample(156.6, 1643, 216.5);
	for (const input of samples.inputs) {
		input.at += 1860.2;
		input.firstMotion = (input.firstMotion as number) + 1860.2;
		input.responseFrame = (input.responseFrame as number) + 1860.2;
		input.settled = (input.settled as number) + 1860.2;
	}
	const original = structuredClone(samples);
	const metrics = reduceTurnBlockingSamples(samples, 300, 2);
	expect(metrics.blockingDurationMaxMs).toBe(0);
	expect(metrics.beforeInput.blockingDurationMaxMs).toBe(156.6);
	expect(turnBlockingBudgetFailures(metrics)).toEqual([]);
	expect(samples).toEqual(original);
});

it.each([
	["ends at the first input", 100, 350, false],
	["overlaps the first input by one microsecond", 100, 349.999, true],
	["starts at the final settlement", 1800, 0, true],
	["overlaps the final settlement by one microsecond", 1799.999, 0, true],
] as const)(
	"keeps the full block when its frame %s",
	(_phase, start, offset, active) => {
		const samples = sample(200, start);
		for (const input of samples.inputs) {
			input.at += offset;
			input.firstMotion = (input.firstMotion as number) + offset;
			input.responseFrame = (input.responseFrame as number) + offset;
			input.settled = (input.settled as number) + offset;
		}
		const metrics = reduceTurnBlockingSamples(samples, 300, 2);
		expect(metrics.blockingDurationMaxMs).toBe(active ? 200 : 0);
		expect(metrics.beforeInput.blockingDurationMaxMs).toBe(active ? 0 : 200);
		expect(turnBlockingBudgetFailures(metrics).length > 0).toBe(active);
	},
);

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

it.each([
	["Intel Iris Xe", "enabled", "enabled", "hardware-cadence"],
	["ANGLE SwiftShader", "enabled", "enabled", "software-work"],
	["Mesa llvmpipe", "enabled", "enabled", "software-work"],
	["Intel Iris Xe", "disabled_software", "enabled", "software-work"],
	["Intel Iris Xe", "enabled", "disabled_software", "software-work"],
] as const)(
	"identifies %s / %s / %s",
	(deviceString, compositing, rasterization, expected) => {
		expect(
			turnRenderingProfile({
				featureStatus: { gpu_compositing: compositing, rasterization },
				devices: [{ deviceString }],
			}),
		).toBe(expected);
	},
);

it.each([
	{ devices: [{ deviceString: "Intel Iris Xe" }] },
	{ featureStatus: { gpu_compositing: "enabled" }, devices: [] },
	{
		featureStatus: { gpu_compositing: "enabled", rasterization: "enabled" },
		devices: [{ deviceString: "" }],
	},
])("rejects incomplete rendering evidence: %j", (gpu) => {
	expect(() => turnRenderingProfile(gpu)).toThrow(
		"Browser rendering evidence missing",
	);
});

it("retains strict physical cadence and distinguishes software work", () => {
	const samples = sample(0, 100);
	samples.frames.fill(25.001);
	const metrics = reduceTurnSamples(samples, 300, 2);
	const blocking = reduceTurnBlockingSamples(samples, 300, 2);
	expect(
		turnQualificationFailures(metrics, blocking, "hardware-cadence"),
	).toHaveLength(3);
	expect(turnQualificationFailures(metrics, blocking, "software-work")).toEqual(
		[],
	);
});

it("keeps the response limit strict in the software profile", () => {
	const samples = sample(0, 100);
	samples.inputs[0].responseFrame = 200.001;
	expect(
		turnQualificationFailures(
			reduceTurnSamples(samples, 300, 2),
			reduceTurnBlockingSamples(samples, 300, 2),
			"software-work",
		),
	).toHaveLength(2);
});

it("uses the primary renderer rather than an unused software device", () => {
	const gpu = {
		featureStatus: { gpu_compositing: "enabled", rasterization: "enabled" },
		devices: [
			{ deviceString: "Intel Iris Xe" },
			{ deviceString: "SwiftShader" },
		],
	};
	expect(turnRenderingProfile(gpu)).toBe("hardware-cadence");
	expect(
		turnRenderingProfile({
			...gpu,
			auxAttributes: { glRenderer: "ANGLE SwiftShader" },
		}),
	).toBe("software-work");
});

it("rejects background intervals even when the page is visible again at the end", () => {
	const visibility = {
		started: "visible" as const,
		stopped: "visible" as const,
		startedFocused: false,
		stoppedFocused: true,
		changes: [] as { at: number; state: DocumentVisibilityState }[],
	};
	expect(turnVisibilityFailures(visibility)).toEqual([]);
	visibility.changes.push({ at: 100, state: "hidden" });
	expect(turnVisibilityFailures(visibility)).toHaveLength(1);
	expect(() => turnVisibilityFailures(undefined)).toThrow(
		"visibility evidence missing",
	);
});
