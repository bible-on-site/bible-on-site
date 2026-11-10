/**
 * Next.js server instrumentation entry. `register()` runs once per server
 * instance before it handles requests, so opt-in event-loop diagnostics
 * (#2991) already observe the startup window and any queueing delay in front
 * of request handlers. Fully inert unless ENABLE_EVENT_LOOP_DIAGNOSTICS=1.
 */
export async function register(): Promise<void> {
	// The positive `=== "nodejs"` branch is required, not stylistic: the
	// bundler must see the Node-only import behind a constant-true runtime
	// check so the Edge instrumentation bundle dead-code-eliminates it. A
	// negative early-return guard leaves `import()` reachable in the Edge
	// import graph and fails webpack dev with UnhandledSchemeError on
	// `node:perf_hooks` (#3258).
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { startEventLoopDiagnostics } = await import(
			"@/lib/diagnostics/event-loop-diagnostics"
		);
		startEventLoopDiagnostics();
	}
}
