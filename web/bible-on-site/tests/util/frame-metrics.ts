export interface FrameSamples {
	readonly frames: readonly number[];
	readonly longtaskMs: number;
}

export interface FrameMetrics {
	frames: number;
	blockedMs: number;
	longFrames: number;
	longtaskMs: number;
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const LONG_FRAME_NANOSECONDS = 50 * NANOSECONDS_PER_MILLISECOND;

/** Reduce rAF gaps without treating timestamp subtraction residue as blocking. */
export function reduceFrameSamples(
	samples: FrameSamples,
	budgetMs: number,
): FrameMetrics {
	// 545.7 - 512.3 slightly exceeds 33.4 in floating point. Integer
	// nanoseconds keep threshold comparisons and sums exact at a precision
	// below the browser clock's resolution, while retaining genuine excess.
	const budgetNanoseconds = Math.round(budgetMs * NANOSECONDS_PER_MILLISECOND);
	let blockedNanoseconds = 0;
	let longFrames = 0;
	for (const gap of samples.frames) {
		const gapNanoseconds = Math.round(gap * NANOSECONDS_PER_MILLISECOND);
		if (gapNanoseconds > budgetNanoseconds) {
			blockedNanoseconds += gapNanoseconds - budgetNanoseconds;
			if (gapNanoseconds > LONG_FRAME_NANOSECONDS) longFrames += 1;
		}
	}
	return {
		frames: samples.frames.length,
		blockedMs: blockedNanoseconds / NANOSECONDS_PER_MILLISECOND,
		longFrames,
		longtaskMs: samples.longtaskMs,
	};
}
