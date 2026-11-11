/** Fixed desktop Chromium stress profile: 1440x900, CPU slowdown 4, six turns.
 * Freeze limits from the failing release, before measuring the candidate.
 * rAF timestamps describe render opportunities, not physical screen presentation.
 */
export const TURN_LIMITS = {
	responseP95Ms: 200,
	frameGapMaxMs: 100,
	frameGapP95Ms: 50,
} as const;

/** Normal desktop rendering: distinguish a 60Hz frame from a repeated miss.
 * Keep the separate 4x work profile and all historical stress samples intact.
 */
export const DESKTOP_TURN_LIMITS = {
	responseP95Ms: 100,
	frameGapMaxMs: 100,
	frameGapP95Ms: 25,
} as const;

type TurnLimits = Readonly<Record<keyof typeof TURN_LIMITS, number>>;

export interface TurnInput {
	at: number;
	trusted: boolean;
	chapter: number;
	firstMotion: number | null;
	responseFrame: number | null;
	settled: number | null;
	frameStart: number;
	frameEnd: number | null;
}

export interface TurnSamples {
	inputs: TurnInput[];
	frames: number[];
	repeatedFrameTimestamps?: number[];
	longAnimationFramesSupported?: boolean;
	longAnimationFrames?: TurnLongAnimationFrame[];
	visibility?: {
		started: string;
		stopped: string;
		startedFocused: boolean;
		stoppedFocused: boolean;
		changes: { at: number; state: string }[];
	};
}

/** Passive browser diagnostics; these never change the cadence reduction. */
export interface TurnLongAnimationFrame {
	startTime: number;
	duration: number;
	blockingDuration: number;
	firstUIEventTimestamp: number;
	renderStart: number;
	styleAndLayoutStart: number;
	scripts: {
		startTime: number;
		duration: number;
		executionStart: number;
		forcedStyleAndLayoutDuration: number;
		invoker: string;
		invokerType: string;
		sourceURL: string;
		sourceFunctionName: string;
	}[];
}

// Keep elapsed clock arithmetic in integer microseconds. Native timestamps
// can subtract to 50.000000000000455ms for a 50ms interval. This is finer than
// the browser clock's resolution; real 50.001ms/50.1ms overruns still fail.
const MICROS_PER_MS = 1_000;
const clockMicros = (milliseconds: number) =>
	Math.round(milliseconds * MICROS_PER_MS);

function percentile(values: number[], fraction: number): number {
	return [...values].sort((a, b) => a - b)[
		Math.ceil(values.length * fraction) - 1
	];
}

/** Missing inputs, uncommitted turns and absent frames are failures, never zeros.
 * Keep every sample; a good first turn cannot hide a bad consecutive turn.
 */
export function reduceTurnSamples(
	samples: TurnSamples,
	initialChapter: number,
	expectedTurns: number,
) {
	if (
		samples.inputs.length !== expectedTurns ||
		expectedTurns < 2 ||
		samples.frames.length < expectedTurns ||
		!samples.frames.every((gap) => Number.isFinite(gap) && gap > 0)
	) {
		throw new Error("Incomplete turn/frame samples");
	}
	const frameMicros = samples.frames.map(clockMicros);
	if (!frameMicros.every((gap) => Number.isSafeInteger(gap) && gap > 0))
		throw new Error("Incomplete turn/frame samples");
	const turns = samples.inputs.map((input, index) => {
		const { at, firstMotion, responseFrame, settled } = input;
		const { frameStart, frameEnd } = input;
		if (
			!input.trusted ||
			input.chapter !== initialChapter + index ||
			firstMotion === null ||
			responseFrame === null ||
			settled === null ||
			![at, firstMotion, responseFrame, settled].every(Number.isFinite) ||
			firstMotion < at ||
			responseFrame < firstMotion ||
			settled < responseFrame ||
			!Number.isInteger(frameStart) ||
			frameEnd === null ||
			!Number.isInteger(frameEnd) ||
			frameStart < 0 ||
			frameEnd <= frameStart ||
			frameEnd > samples.frames.length ||
			(index > 0 &&
				frameStart < (samples.inputs[index - 1].frameEnd ?? Infinity)) ||
			(index > 0 && at < (samples.inputs[index - 1].settled ?? Infinity))
		) {
			throw new Error(`Invalid or unfinished turn ${index + 1}`);
		}
		const responseMicros = clockMicros(responseFrame - at);
		if (!Number.isSafeInteger(responseMicros) || responseMicros <= 0)
			throw new Error(`Invalid or unfinished turn ${index + 1}`);
		return { responseMicros, frameStart, frameEnd };
	});
	const responseMicros = turns.map((turn) => turn.responseMicros);
	const summarize = (responses: number[], frames: number[]) => ({
		responseP95Ms: percentile(responses, 0.95) / MICROS_PER_MS,
		frameGapMaxMs: Math.max(...frames) / MICROS_PER_MS,
		frameGapP95Ms: percentile(frames, 0.95) / MICROS_PER_MS,
	});
	const first = turns[0];
	return {
		responseMs: responseMicros.map((value) => value / MICROS_PER_MS),
		responseP95Ms: percentile(responseMicros, 0.95) / MICROS_PER_MS,
		responseMaxMs: Math.max(...responseMicros) / MICROS_PER_MS,
		frameGapMaxMs: Math.max(...frameMicros) / MICROS_PER_MS,
		frameGapP95Ms: percentile(frameMicros, 0.95) / MICROS_PER_MS,
		firstTurn: summarize(
			[first.responseMicros],
			frameMicros.slice(first.frameStart, first.frameEnd),
		),
		consecutiveTurns: summarize(
			responseMicros.slice(1),
			frameMicros.slice(first.frameEnd),
		),
	};
}

export function turnBudgetFailures(
	metrics: ReturnType<typeof reduceTurnSamples>,
	limits: TurnLimits = TURN_LIMITS,
): string[] {
	return (
		[
			["all turns", metrics],
			["first turn", metrics.firstTurn],
			["consecutive turns", metrics.consecutiveTurns],
		] as const
	).flatMap(([phase, values]) =>
		Object.entries(limits)
			.filter(([key, limit]) => values[key as keyof typeof TURN_LIMITS] > limit)
			.map(
				([key, limit]) =>
					`${phase}/${key}=${values[key as keyof typeof TURN_LIMITS]}ms > ${limit}ms`,
			),
	);
}

// LoAF blockingDuration measures time that the main thread cannot yield to input.
// Keep this separate from rAF cadence: software rasterization and presentation
// scheduling can miss frames even when the main thread remains interruptible.
export const TURN_BLOCKING_LIMIT_MS = 50;

export function reduceTurnBlockingSamples(
	samples: TurnSamples,
	initialChapter: number,
	expectedTurns: number,
) {
	reduceTurnSamples(samples, initialChapter, expectedTurns);
	if (
		samples.longAnimationFramesSupported !== true ||
		!Array.isArray(samples.longAnimationFrames)
	) {
		throw new Error("Browser long-animation-frame evidence missing");
	}
	const records = samples.longAnimationFrames;
	if (
		records.some(
			(frame) =>
				![frame.startTime, frame.duration, frame.blockingDuration].every(
					Number.isFinite,
				) ||
				frame.startTime < 0 ||
				frame.duration <= 0 ||
				frame.blockingDuration < 0 ||
				frame.blockingDuration > frame.duration,
		)
	) {
		throw new Error("Invalid browser long-animation-frame evidence");
	}
	const first = samples.inputs[0];
	const firstEnd = first.settled as number;
	const lastEnd = samples.inputs[expectedTurns - 1].settled as number;
	// The observer also retains setup and collection frames. A frame wholly
	// before the first trusted input or after the final settlement cannot
	// block a measured turn. Keep it in diagnostics, and retain the full
	// blocking duration of every frame overlapping the continuous sequence,
	// including the gaps between turns and either boundary.
	const overlapsTurns = (frame: TurnLongAnimationFrame) =>
		frame.startTime < lastEnd && frame.startTime + frame.duration > first.at;
	const turnRecords = records.filter(overlapsTurns);
	const summarize = (frames: TurnLongAnimationFrame[]) => ({
		blockingDurationMaxMs:
			Math.max(
				0,
				...frames.map((frame) => clockMicros(frame.blockingDuration)),
			) / MICROS_PER_MS,
	});
	return {
		...summarize(turnRecords),
		outsideTurns: summarize(records.filter((frame) => !overlapsTurns(frame))),
		firstTurn: summarize(
			turnRecords.filter(
				(frame) =>
					frame.startTime < firstEnd &&
					frame.startTime + frame.duration > first.at,
			),
		),
		consecutiveTurns: summarize(
			turnRecords.filter(
				(frame) => frame.startTime + frame.duration > firstEnd,
			),
		),
	};
}

export function turnBlockingBudgetFailures(
	metrics: ReturnType<typeof reduceTurnBlockingSamples>,
) {
	return (
		[
			["all turns", metrics],
			["first turn", metrics.firstTurn],
			["consecutive turns", metrics.consecutiveTurns],
		] as const
	).flatMap(([phase, values]) =>
		values.blockingDurationMaxMs > TURN_BLOCKING_LIMIT_MS
			? [
					`${phase}/blockingDurationMaxMs=${values.blockingDurationMaxMs}ms > ${TURN_BLOCKING_LIMIT_MS}ms`,
				]
			: [],
	);
}

export type TurnRenderingProfile = "hardware-cadence" | "software-work";

export function turnProfileSettings(profile: TurnRenderingProfile) {
	return profile === "hardware-cadence"
		? { cpuRate: 1, limits: DESKTOP_TURN_LIMITS }
		: { cpuRate: 4, limits: TURN_LIMITS };
}

/** Software emulation does not establish hardware presentation cadence. */
export function turnRenderingProfile(gpu: {
	featureStatus?: Record<string, unknown>;
	devices: { deviceString: string }[];
	auxAttributes?: Record<string, unknown>;
}): TurnRenderingProfile {
	const compositing = gpu.featureStatus?.gpu_compositing;
	const rasterization = gpu.featureStatus?.rasterization;
	if (
		typeof compositing !== "string" ||
		typeof rasterization !== "string" ||
		!gpu.devices[0]?.deviceString
	) {
		throw new Error("Browser rendering evidence missing");
	}
	const renderer = `${gpu.devices[0].deviceString} ${gpu.auxAttributes?.glRenderer ?? ""}`;
	const softwareDevice =
		/SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render Driver/i.test(
			renderer,
		);
	return compositing === "enabled" &&
		rasterization === "enabled" &&
		!softwareDevice
		? "hardware-cadence"
		: "software-work";
}

export function turnQualificationFailures(
	metrics: ReturnType<typeof reduceTurnSamples>,
	blocking: ReturnType<typeof reduceTurnBlockingSamples>,
	profile: TurnRenderingProfile,
) {
	const { limits } = turnProfileSettings(profile);
	const responsiveness = (
		[
			["all turns", metrics],
			["first turn", metrics.firstTurn],
			["consecutive turns", metrics.consecutiveTurns],
		] as const
	).flatMap(([phase, values]) =>
		values.responseP95Ms > limits.responseP95Ms
			? [
					`${phase}/responseP95Ms=${values.responseP95Ms}ms > ${limits.responseP95Ms}ms`,
				]
			: [],
	);
	return [
		...(profile === "hardware-cadence"
			? turnBudgetFailures(metrics, limits)
			: responsiveness),
		...turnBlockingBudgetFailures(blocking),
	];
}

export function turnVisibilityFailures(visibility: TurnSamples["visibility"]) {
	if (!visibility) throw new Error("Browser visibility evidence missing");
	return visibility.started !== "visible" ||
		visibility.stopped !== "visible" ||
		visibility.changes.some((change) => change.state !== "visible")
		? ["Turn measurement entered background visibility"]
		: [];
}
