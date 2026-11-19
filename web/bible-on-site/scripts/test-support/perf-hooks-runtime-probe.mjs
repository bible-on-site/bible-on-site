/**
 * Cross-runtime probe for the node:perf_hooks primitives consumed by the
 * website's opt-in event-loop diagnostics (#3351, #3624; upstream follow-up
 * #3641). Run under Node (the semantic control) and under Bun:
 *
 *   node scripts/test-support/perf-hooks-runtime-probe.mjs
 *   bun  scripts/test-support/perf-hooks-runtime-probe.mjs
 *
 * The probe measures each primitive across an idle wait and a busy callback,
 * checks `gc` entry delivery under real collection pressure, exercises the
 * cumulative/delta `eventLoopUtilization()` argument forms, and repeats the
 * ELU check inside a worker thread. It prints one JSON report on stdout:
 * `zero-stub` marks a primitive that answers but can only ever return zeros,
 * `entry-type-absent` marks a surface the runtime does not provide, `real`
 * marks measurements that move. No application, database or credentials
 * involved.
 */
import {
	monitorEventLoopDelay,
	PerformanceObserver,
	performance,
} from "node:perf_hooks";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const busyFor = (ms) => {
	const end = performance.now() + ms;
	let x = 0;
	while (performance.now() < end) x += Math.sqrt(x + 1);
	return x;
};

const round3 = (v) => Math.round(v * 1000) / 1000;

const eluRead = (a, b) => {
	try {
		const u =
			b === undefined
				? a === undefined
					? performance.eventLoopUtilization()
					: performance.eventLoopUtilization(a)
				: performance.eventLoopUtilization(a, b);
		return {
			idle: round3(u.idle),
			active: round3(u.active),
			utilization: round3(u.utilization),
		};
	} catch (error) {
		return { threw: String(error) };
	}
};

const cpuRead = (prev) => {
	try {
		const c = prev === undefined ? process.cpuUsage() : process.cpuUsage(prev);
		return {
			userMs: round3(c.user / 1000),
			systemMs: round3(c.system / 1000),
		};
	} catch (error) {
		return { threw: String(error) };
	}
};

const cpuAnchor = () => {
	const c = process.cpuUsage();
	return { user: c.user, system: c.system };
};

const delaySummary = (histogram) => {
	if (histogram === null) return { absent: true };
	try {
		const toMs = (ns) => round3(ns / 1e6);
		return {
			count: histogram.count,
			maxMs: toMs(histogram.max),
			p99Ms: toMs(histogram.percentile(99)),
		};
	} catch (error) {
		return { threw: String(error) };
	}
};

const delayReset = (histogram) => {
	try {
		histogram?.reset();
	} catch {
		// A sampler without reset() still yields cumulative evidence.
	}
};

if (!isMainThread) {
	// Worker half of the probe: busy the worker's own loop, then report the
	// ELU reading node:perf_hooks gives for this worker's loop. The pending
	// timer keeps the worker — and its loop counters — alive until the
	// parent reads worker.performance and terminates it; a worker allowed
	// to exit reads back as zeros.
	busyFor(300);
	parentPort.postMessage({ eluAfterBusy: eluRead() });
	setTimeout(() => {}, 30_000);
} else {
	const isBun = typeof globalThis.Bun !== "undefined";
	const runtime = isBun
		? {
				name: "bun",
				version: globalThis.Bun.version,
				revision: globalThis.Bun.revision,
			}
		: { name: "node", version: process.version };

	const supportedEntryTypes = PerformanceObserver.supportedEntryTypes;

	// GC observer armed before any pressure. Node delivers entries
	// asynchronously; Bun accepts `observe({entryTypes:["gc"]})` silently
	// today, so delivery — not a throw — is what gets measured.
	const gcEntries = [];
	let gcObserveThrew = null;
	const observer = new PerformanceObserver((list) => {
		gcEntries.push(...list.getEntries());
	});
	try {
		observer.observe({ entryTypes: ["gc"] });
	} catch (error) {
		gcObserveThrew = String(error);
	}

	let delay = null;
	let delayCreateThrew = null;
	try {
		delay = monitorEventLoopDelay({ resolution: 10 });
		delay.enable();
	} catch (error) {
		delayCreateThrew = String(error);
	}

	// Phase 1 — idle wait: a live ELU counter must accumulate idle ms.
	const eluAnchorIdle = eluRead();
	const cpuAnchorIdle = cpuAnchor();
	delayReset(delay);
	await sleep(300);
	const afterIdle = {
		eluDelta: eluRead(eluAnchorIdle),
		cpuDelta: cpuRead(cpuAnchorIdle),
		delay: delaySummary(delay),
	};

	// Phase 2 — busy callback: a live ELU counter must accumulate active ms.
	const eluAnchorBusy = eluRead();
	const cpuAnchorBusy = cpuAnchor();
	delayReset(delay);
	busyFor(300);
	const eluAnchorBusyEnd = eluRead();
	const afterBusy = {
		eluDelta: eluRead(eluAnchorBusy),
		cpuDelta: cpuRead(cpuAnchorBusy),
		delay: delaySummary(delay),
	};

	// Two-argument form: elu(later, earlier) reports the span between two
	// snapshots — here the same busy window as afterBusy.eluDelta, which the
	// two forms should agree on — matching Node's argument semantics.
	const eluTwoArgSpan = eluRead(eluAnchorBusyEnd, eluAnchorBusy);

	// Phase 3 — collection pressure: forced collect where the runtime offers
	// one, plus allocation churn so an unforced collector still runs.
	if (typeof globalThis.gc === "function") globalThis.gc();
	if (isBun && typeof globalThis.Bun.gc === "function") globalThis.Bun.gc(true);
	for (let i = 0; i < 40; i++) {
		// ~2 MB of short-lived objects per turn.
		const junk = Array.from({ length: 260_000 }, (_, j) => ({ j }));
		junk.length = 0;
	}
	await sleep(250);

	// Worker check: the worker reports its own node:perf_hooks ELU after a
	// busy spin; the parent then reads worker.performance.eventLoopUtilization()
	// — the parent-side API Node provides and Bun currently stubs/misses
	// (oven-sh/bun#32609, excluded from PR oven-sh/bun#44627's scope).
	const workerResult = await new Promise((resolve) => {
		const worker = new Worker(new URL(import.meta.url));
		const timer = setTimeout(() => {
			worker.terminate();
			resolve({ timedOut: true });
		}, 10_000);
		worker.once("message", (message) => {
			clearTimeout(timer);
			try {
				message.parentSideWorkerPerformance =
					typeof worker.performance?.eventLoopUtilization === "function"
						? (() => {
								const u = worker.performance.eventLoopUtilization();
								return {
									idle: round3(u.idle),
									active: round3(u.active),
									utilization: round3(u.utilization),
								};
							})()
						: "missing";
			} catch (error) {
				message.parentSideWorkerPerformance = { threw: String(error) };
			}
			worker.terminate();
			resolve(message);
		});
		worker.once("error", (error) => {
			clearTimeout(timer);
			resolve({ error: String(error) });
		});
	});

	const eluCumulative = eluRead();
	const cpuCumulative = cpuRead();
	const delayCumulative = delaySummary(delay);

	const report = {
		runtime,
		platform: process.platform,
		arch: process.arch,
		supportedEntryTypes,
		phases: {
			afterIdle300ms: afterIdle,
			afterBusy300ms: afterBusy,
			eluTwoArgSpan,
			cumulativeAtEnd: { elu: eluCumulative, cpu: cpuCumulative },
			eventLoopDelay: {
				createThrew: delayCreateThrew,
				cumulative: delayCumulative,
			},
			gc: {
				supportedEntryTypesHasGc: supportedEntryTypes.includes("gc"),
				observeThrew: gcObserveThrew,
				entriesDelivered: gcEntries.length,
				durationsMs: gcEntries.map((entry) => round3(entry.duration)),
			},
			worker: workerResult,
		},
		verdict: {
			eventLoopUtilization:
				eluCumulative.idle + eluCumulative.active > 0 ? "real" : "zero-stub",
			cpu: cpuCumulative.userMs + cpuCumulative.systemMs > 0 ? "real" : "zero",
			eventLoopDelay: delayCumulative.count > 0 ? "real" : "absent",
			gc: supportedEntryTypes.includes("gc")
				? gcEntries.length > 0
					? "real"
					: (gcObserveThrew ?? "no-entries-delivered")
				: "entry-type-absent",
		},
	};
	console.log(JSON.stringify(report, null, 2));
}
