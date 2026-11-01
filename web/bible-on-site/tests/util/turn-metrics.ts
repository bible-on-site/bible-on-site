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
}

export interface TurnSamples {
	inputs: TurnInput[];
	frames: number[];
}

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
	const responseMs = samples.inputs.map((input, index) => {
		const { at, firstMotion, responseFrame, settled } = input;
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
			(index > 0 && at < (samples.inputs[index - 1].settled ?? Infinity))
		) {
			throw new Error(`Invalid or unfinished turn ${index + 1}`);
		}
		return responseFrame - at;
	});
	return {
		responseMs,
		responseP95Ms: percentile(responseMs, 0.95),
		responseMaxMs: Math.max(...responseMs),
		frameGapMaxMs: Math.max(...samples.frames),
		frameGapP95Ms: percentile(samples.frames, 0.95),
	};
}

export function turnBudgetFailures(
	metrics: ReturnType<typeof reduceTurnSamples>,
): string[] {
	return Object.entries(TURN_LIMITS)
		.filter(([key, limit]) => metrics[key as keyof typeof TURN_LIMITS] > limit)
		.map(
			([key, limit]) =>
				`${key}=${metrics[key as keyof typeof TURN_LIMITS]}ms > ${limit}ms`,
		);
}
