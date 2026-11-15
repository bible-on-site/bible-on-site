let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
function drain(): Promise<void> {
	if (running) return running;
	running = import("./contribution-rebases.server")
		.then((m) => m.resumePendingContributionRebases())
		.catch((error) => {
			console.error(
				"Pending contribution comparison refresh failed",
				error instanceof Error ? error.message : "unknown error",
			);
		})
		.finally(() => {
			running = undefined;
		});
	return running;
}
/** Repair interrupted post-merge refreshes without losing their durable marker. */
export function ensureContributionRebasesStarted(): void {
	if (timer) return;
	timer = setInterval(() => {
		void drain();
	}, 30000);
	timer.unref?.();
	void drain();
}
