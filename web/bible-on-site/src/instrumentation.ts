/**
 * Next.js server instrumentation entry. `register()` runs once per server
 * instance before it handles requests, so opt-in event-loop diagnostics
 * (#2991) already observe the startup window and any queueing delay in front
 * of request handlers. Fully inert unless ENABLE_EVENT_LOOP_DIAGNOSTICS=1.
 */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { startEventLoopDiagnostics } = await import(
		"@/lib/diagnostics/event-loop-diagnostics"
	);
	startEventLoopDiagnostics();
}
