// Stable CPU classes from Lighthouse's documented benchmark-index ranges:
// https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md#cpu-throttling
// Apply the slowdown before gathering. The navigation deadlines and performance
// assertions continue to use their existing budgets.
export const LIGHTHOUSE_CPU_TARGETS = Object.freeze({
	mobile: 500,
	desktop: 1500,
});

export const LIGHTHOUSE_CPU_PROFILE = "cpu-m500-d1500-v1";

export function lighthouseCpuProfile(hostBenchmarkIndex, strategy) {
	const targetBenchmarkIndex = LIGHTHOUSE_CPU_TARGETS[strategy];
	if (!Number.isFinite(targetBenchmarkIndex)) {
		throw new Error("Unsupported Lighthouse CPU strategy");
	}
	if (!Number.isFinite(hostBenchmarkIndex) || hostBenchmarkIndex <= 0) {
		throw new Error("Missing or invalid Lighthouse CPU benchmark index");
	}
	if (hostBenchmarkIndex < targetBenchmarkIndex) {
		throw new Error("Runner CPU cannot emulate the Lighthouse target class");
	}
	return {
		profile: LIGHTHOUSE_CPU_PROFILE,
		hostBenchmarkIndex,
		targetBenchmarkIndex,
		cpuSlowdownMultiplier: hostBenchmarkIndex / targetBenchmarkIndex,
	};
}
