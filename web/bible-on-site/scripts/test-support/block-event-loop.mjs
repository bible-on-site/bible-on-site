/**
 * Deliberately stalls the event loop inside the process that loads it, so the
 * opt-in diagnostics from #2991 can be verified against the real compiled
 * standalone server:
 *
 *   NODE_OPTIONS="--import file:///absolute/path/block-event-loop.mjs" \
 *   BLOCK_PROBE_URL=http://127.0.0.1:3009/api/health \
 *   ENABLE_EVENT_LOOP_DIAGNOSTICS=1 EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS=5000 \
 *   node server.js
 *
 * BLOCK_EVENT_LOOP_AFTER_MS arms the stall (default 8000),
 * BLOCK_EVENT_LOOP_MS sets its duration (default 3000).
 * BLOCK_EVENT_LOOP_MODE=spin busy-waits (default); "sleep" waits the same
 * duration asynchronously — the control arm proving only a real stall shows
 * up as event-loop delay. BLOCK_PROBE_URL is fetched right before the stall,
 * so the request queues behind it: the probe reports a multi-second wait even
 * though the health handler itself executes instantly — the production
 * signature this diagnostic exists to explain. Verification only — not part
 * of the production image path.
 */
const afterMs = Number.parseInt(
	process.env.BLOCK_EVENT_LOOP_AFTER_MS ?? "8000",
	10,
);
const blockMs = Number.parseInt(process.env.BLOCK_EVENT_LOOP_MS ?? "3000", 10);
const probeUrl = process.env.BLOCK_PROBE_URL;
const mode = process.env.BLOCK_EVENT_LOOP_MODE ?? "spin";

setTimeout(() => {
	const started = Date.now();
	if (probeUrl)
		fetch(probeUrl)
			.then((response) => response.text())
			.then(() =>
				console.error(
					`[block-event-loop] probe ${probeUrl} returned after ${Date.now() - started}ms`,
				),
			)
			.catch((error) =>
				console.error("[block-event-loop] probe failed", error),
			);
	// Give the probe a beat to leave this process before the loop stalls.
	setTimeout(() => {
		console.error(`[block-event-loop] ${mode} for ${blockMs}ms`);
		const end = Date.now() + blockMs;
		if (mode === "spin") {
			while (Date.now() < end) {
				// Intentional busy-wait: keeps the event loop from turning.
			}
			console.error("[block-event-loop] released event loop");
		} else {
			setTimeout(
				() => console.error("[block-event-loop] async wait ended"),
				Math.max(0, end - Date.now()),
			).unref();
		}
	}, 100).unref();
}, afterMs).unref();
