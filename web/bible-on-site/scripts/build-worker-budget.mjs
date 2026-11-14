const GiB = 1024 ** 3;

/**
 * Bound static workers by Next's default, CPU allocation, and available RAM.
 * Full-book workers peak around 794 MiB. Budget 1 GiB each and reserve another
 * 1 GiB for the parent build process so parallel rendering does not page.
 *
 * @param {{defaultCpuLimit: number, parallelism: number, availableBytes: number, constrainedBytes: number}} resources
 */
export function getBuildWorkerCount({
	defaultCpuLimit,
	parallelism,
	availableBytes,
	constrainedBytes,
}) {
	const cpuCeiling = Math.floor(Math.min(defaultCpuLimit, parallelism));
	const memoryBudget =
		constrainedBytes > 0
			? Math.min(availableBytes, constrainedBytes)
			: availableBytes;
	if (!Number.isFinite(cpuCeiling) || !Number.isFinite(memoryBudget)) return 1;
	return Math.max(
		1,
		Math.min(cpuCeiling, Math.floor((memoryBudget - GiB) / GiB)),
	);
}
