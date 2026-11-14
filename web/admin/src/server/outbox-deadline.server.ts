import "@tanstack/react-start/server-only";

/** Bound the whole sweep, including DB pool/lock waits that cannot be cancelled. */
export async function runOutboxSweep(
	shutdown: AbortSignal | undefined,
	operation: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
	shutdown?.throwIfAborted();
	const deadline = AbortSignal.timeout(15_000);
	const signal = shutdown ? AbortSignal.any([shutdown, deadline]) : deadline;
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (success: boolean, error?: unknown) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", aborted);
			if (success) resolve();
			else reject(error);
		};
		const aborted = () =>
			finish(false, new Error("Bulletin outbox sweep stopped"));
		signal.addEventListener("abort", aborted, { once: true });
		// Both settlements remain observed after abort. The operation checks this
		// same signal after DB waits, so late results cannot start more work.
		void Promise.resolve()
			.then(() => {
				signal.throwIfAborted();
				return operation(signal);
			})
			.then(
				() => finish(true),
				(error: unknown) => finish(false, error),
			);
	});
}
