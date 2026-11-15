/**
 * Next.js server instrumentation entry. `register()` runs once per server
 * instance before it handles requests, so opt-in event-loop diagnostics
 * (#2991) already observe the startup window and any queueing delay in front
 * of request handlers. Diagnostics stay inert unless ENABLE_EVENT_LOOP_DIAGNOSTICS=1.
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
		// Load the canonical sefarim corpus during startup rather than inside the
		// first sefer request: the ~4 MB Brotli decode + ~40 MB JSON.parse is
		// synchronous event-loop work that otherwise lands on the cold-start
		// critical path of whichever request hits it first (issue #2881). The
		// module's globalThis cache means route bundles reuse this one parse.
		// Production only — dev/test keep the lazy path and the dev fixture module.
		if (process.env.NODE_ENV !== "production") return;
		const { sefarim } = await import("@/data/db/sefarim");
		if (sefarim.length === 0) {
			// Fail fast at boot rather than serving requests with a missing corpus.
			throw new Error("canonical sefarim corpus is empty after boot load");
		}
	}
}
