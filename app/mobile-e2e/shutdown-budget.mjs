import { appendFileSync } from "node:fs";

// Post-test cleanup shares the supervisor's single wall-clock deadline (#2423):
// unbounded diagnostics after a green run must not consume the remaining pilot
// budget. The deadline is injected by supervise.mjs as MOBILE_E2E_PILOT_DEADLINE_MS.
export function remainingBudget(deadlineMs, reserveMs = 0, now = Date.now()) {
	if (!Number.isFinite(deadlineMs)) return Number.POSITIVE_INFINITY;
	return Math.max(0, deadlineMs - reserveMs - now);
}

// A grandchild inheriting the test process's stdio keeps 'close' pending long
// after 'exit'; the run must resolve on 'exit', not 'close' (#2423).
export function exitCode(child) {
	return new Promise((resolveExit, reject) => {
		child.on("error", reject);
		child.on("exit", (code) => resolveExit(code ?? 1));
	});
}

/** Records each cleanup phase's duration so a future stall names its phase. */
export function phaseRecorder(path, now = Date.now) {
	return async (phase, work) => {
		const started = now();
		try {
			return await work();
		} finally {
			appendFileSync(
				path,
				`${JSON.stringify({ phase, elapsedMs: now() - started })}\n`,
			);
		}
	};
}
