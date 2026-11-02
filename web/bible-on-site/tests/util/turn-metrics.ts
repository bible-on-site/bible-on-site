/** Fixed desktop Chromium stress profile: 1440x900, CPU slowdown 4, six turns.
 * Freeze limits from the failing release, before measuring the candidate.
 * rAF timestamps describe render opportunities, not physical screen presentation.
 */
export const TURN_LIMITS = {
	responseP95Ms: 200,
	frameGapMaxMs: 100,
	frameGapP95Ms: 50,
} as const;

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
): string[] {
	return (
		[
			["all turns", metrics],
			["first turn", metrics.firstTurn],
			["consecutive turns", metrics.consecutiveTurns],
		] as const
	).flatMap(([phase, values]) =>
		Object.entries(TURN_LIMITS)
			.filter(([key, limit]) => values[key as keyof typeof TURN_LIMITS] > limit)
			.map(
				([key, limit]) =>
					`${phase}/${key}=${values[key as keyof typeof TURN_LIMITS]}ms > ${limit}ms`,
			),
	);
}
