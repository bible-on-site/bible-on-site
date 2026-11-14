import "server-only";

import {
	type EventLoopUtilization,
	monitorEventLoopDelay,
	type PerformanceEntry,
	PerformanceObserver,
	performance,
	constants as performanceConstants,
} from "node:perf_hooks";
import packageJson from "../../../package.json";

/**
 * Bounded, opt-in per-process event-loop diagnostics (#2991).
 *
 * Emits at most one structured JSON summary per configured interval to stdout
 * (private container logs only — never a public endpoint). Enabled by
 * `ENABLE_EVENT_LOOP_DIAGNOSTICS=1`; inert otherwise. See
 * docs/website/website.md for enabling, output fields and nginx correlation.
 */

export const EVENT_LOOP_DIAGNOSTICS_FLAG = "ENABLE_EVENT_LOOP_DIAGNOSTICS";
export const EVENT_LOOP_DIAGNOSTICS_INTERVAL =
	"EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS";

const DEFAULT_INTERVAL_MS = 60_000;
/** Floor on the emit interval keeps stdout bounded even if misconfigured. */
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 15 * DEFAULT_INTERVAL_MS;

const NS_PER_MS = 1_000_000;
const US_PER_MS = 1_000;

export interface DiagnosticsEnv {
	[key: string]: string | undefined;
	ENABLE_EVENT_LOOP_DIAGNOSTICS?: string | undefined;
	EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS?: string | undefined;
}

export interface EventLoopDiagnosticsConfig {
	enabled: boolean;
	intervalMs: number;
}

export function readEventLoopDiagnosticsConfig(
	env: DiagnosticsEnv = process.env,
): EventLoopDiagnosticsConfig {
	const raw = Number.parseInt(env[EVENT_LOOP_DIAGNOSTICS_INTERVAL] ?? "", 10);
	const intervalMs =
		Number.isSafeInteger(raw) && raw > 0
			? Math.min(Math.max(raw, MIN_INTERVAL_MS), MAX_INTERVAL_MS)
			: DEFAULT_INTERVAL_MS;
	return {
		enabled: env[EVENT_LOOP_DIAGNOSTICS_FLAG] === "1",
		intervalMs,
	};
}

/** Narrow structural view of `ELDHistogram` so tests can inject fakes. */
export interface EventLoopDelaySampler {
	enable(): boolean;
	disable(): boolean;
	reset(): void;
	readonly count: number;
	readonly min: number;
	readonly mean: number;
	readonly max: number;
	percentile(percentile: number): number;
}

export interface DiagnosticsTimer {
	/** Unref keeps the emit schedule from holding a draining process open. */
	unref(): unknown;
}

export interface EventLoopDiagnosticsDeps {
	createDelaySampler: () => EventLoopDelaySampler;
	eventLoopUtilization: () => EventLoopUtilization;
	cpuUsage: () => NodeJS.CpuUsage;
	uptime: () => number;
	observeGc: (onEntries: (entries: readonly PerformanceEntry[]) => void) => {
		disconnect(): void;
	};
	setTimeout: (callback: () => void, delay: number) => DiagnosticsTimer;
	clearTimeout: (timer: DiagnosticsTimer) => void;
	now: () => number;
	/** Registers a teardown hook run at process exit; returns its remover. */
	onExit: (callback: () => void) => () => void;
	log: (line: string) => void;
	version: string;
}

export interface EventLoopDiagnosticsOptions
	extends Partial<EventLoopDiagnosticsDeps> {
	intervalMs: number;
}

export interface EventLoopDiagnostics {
	readonly running: boolean;
	start(): void;
	stop(): void;
}

const defaultDeps: EventLoopDiagnosticsDeps = {
	// Per-iteration sampling never wakes an idle loop on a sampling timer, so
	// steady-state cost stays near zero while every queueing delay is recorded.
	createDelaySampler: () => monitorEventLoopDelay({ samplePerIteration: true }),
	eventLoopUtilization: () => performance.eventLoopUtilization(),
	cpuUsage: () => process.cpuUsage(),
	uptime: () => process.uptime(),
	observeGc: (onEntries) => {
		const observer = new PerformanceObserver((list) => {
			onEntries(list.getEntries());
		});
		observer.observe({ entryTypes: ["gc"] });
		return observer;
	},
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
	now: () => Date.now(),
	// `on` plus an explicit remover keeps start/stop cycles listener-balanced;
	// stop() is idempotent so a `once` wrapper would add nothing.
	onExit: (callback) => {
		process.on("exit", callback);
		return () => {
			process.removeListener("exit", callback);
		};
	},
	log: (line) => console.log(line),
	version: packageJson.version,
};

// GC entry `kind` moved under `detail` (DEP0152); read the new field first and
// touch the deprecated accessor only on runtimes without `detail`.
interface GcEntryDetail {
	kind?: unknown;
}
function gcEntryKind(entry: PerformanceEntry): number {
	const detail = (entry as PerformanceEntry & { detail?: GcEntryDetail })
		.detail;
	if (typeof detail?.kind === "number") return detail.kind;
	const legacy = (entry as PerformanceEntry & { kind?: unknown }).kind;
	return typeof legacy === "number" ? legacy : 0;
}

// GC kind numbers differ between Node majors; derive names from the runtime
// constants so a Node upgrade cannot silently mislabel kinds.
const GC_KIND_PREFIX = "NODE_PERFORMANCE_GC_";
const gcKindNames = new Map<number, string>();
for (const [key, value] of Object.entries(performanceConstants)) {
	if (
		!key.startsWith(GC_KIND_PREFIX) ||
		key.startsWith(`${GC_KIND_PREFIX}FLAGS`) ||
		typeof value !== "number"
	)
		continue;
	gcKindNames.set(value, key.slice(GC_KIND_PREFIX.length).toLowerCase());
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

interface DiagnosticsSession {
	sampler: EventLoopDelaySampler;
	gcObserver: { disconnect(): void };
	timer: DiagnosticsTimer;
	/** Releases the exit hook so stopped sessions retain no listeners. */
	removeExitHook: () => void;
	intervalStartMs: number;
	prevUtilization: EventLoopUtilization;
	prevCpu: NodeJS.CpuUsage;
	gcCount: number;
	gcTotalDurationMs: number;
	gcMaxDurationMs: number;
	gcKinds: Map<string, number>;
}

export function createEventLoopDiagnostics(
	options: EventLoopDiagnosticsOptions,
): EventLoopDiagnostics {
	const { intervalMs: rawIntervalMs, ...depOverrides } = options;
	const deps: EventLoopDiagnosticsDeps = { ...defaultDeps, ...depOverrides };
	const intervalMs = Number.isFinite(rawIntervalMs)
		? Math.max(1, Math.floor(rawIntervalMs))
		: DEFAULT_INTERVAL_MS;

	// null while stopped; every field inside a live session is non-null.
	let session: DiagnosticsSession | null = null;

	function resetAccumulators(s: DiagnosticsSession): void {
		s.sampler.reset();
		s.gcCount = 0;
		s.gcTotalDurationMs = 0;
		s.gcMaxDurationMs = 0;
		s.gcKinds.clear();
	}

	function onGcEntries(entries: readonly PerformanceEntry[]): void {
		// Entries queued before disconnect may still arrive after stop().
		if (session === null) return;
		for (const entry of entries) {
			session.gcCount += 1;
			session.gcTotalDurationMs += entry.duration;
			session.gcMaxDurationMs = Math.max(
				session.gcMaxDurationMs,
				entry.duration,
			);
			const kind = gcEntryKind(entry);
			const name = gcKindNames.get(kind) ?? `kind${kind}`;
			session.gcKinds.set(name, (session.gcKinds.get(name) ?? 0) + 1);
		}
	}

	function delaySummary(s: DiagnosticsSession) {
		const count = s.sampler.count;
		const toMs = (ns: number) => round3(ns / NS_PER_MS);
		return {
			count,
			minMs: count > 0 ? toMs(s.sampler.min) : 0,
			meanMs: count > 0 ? toMs(s.sampler.mean) : 0,
			maxMs: count > 0 ? toMs(s.sampler.max) : 0,
			p50Ms: count > 0 ? toMs(s.sampler.percentile(50)) : 0,
			p90Ms: count > 0 ? toMs(s.sampler.percentile(90)) : 0,
			p95Ms: count > 0 ? toMs(s.sampler.percentile(95)) : 0,
			p99Ms: count > 0 ? toMs(s.sampler.percentile(99)) : 0,
		};
	}

	function utilizationSummary(
		s: DiagnosticsSession,
		now: EventLoopUtilization,
	) {
		const idleMs = now.idle - s.prevUtilization.idle;
		const activeMs = now.active - s.prevUtilization.active;
		const totalMs = idleMs + activeMs;
		return {
			idleMs: round3(idleMs),
			activeMs: round3(activeMs),
			utilization: totalMs > 0 ? round3(activeMs / totalMs) : 0,
		};
	}

	// Emits the single bounded summary for the elapsed window, resets every
	// accumulator, then re-anchors the next emit to the wall-clock grid so a
	// blocked loop never causes catch-up bursts or unaligned windows.
	function emit(): void {
		// A timeout already dequeued when stop() cleared it must not emit or
		// re-arm the schedule.
		const s = session;
		if (s === null) return;
		const intervalEndMs = deps.now();
		const utilizationNow = deps.eventLoopUtilization();
		const cpuNow = deps.cpuUsage();
		deps.log(
			JSON.stringify({
				type: "event-loop-diagnostics",
				version: deps.version,
				intervalStart: new Date(s.intervalStartMs).toISOString(),
				intervalEnd: new Date(intervalEndMs).toISOString(),
				uptimeSeconds: round3(deps.uptime()),
				eventLoopDelay: delaySummary(s),
				eventLoopUtilization: utilizationSummary(s, utilizationNow),
				cpu: {
					userMs: round3((cpuNow.user - s.prevCpu.user) / US_PER_MS),
					systemMs: round3((cpuNow.system - s.prevCpu.system) / US_PER_MS),
				},
				gc: {
					count: s.gcCount,
					totalDurationMs: round3(s.gcTotalDurationMs),
					maxDurationMs: round3(s.gcMaxDurationMs),
					kinds: Object.fromEntries(s.gcKinds),
				},
			}),
		);
		s.prevUtilization = utilizationNow;
		s.prevCpu = cpuNow;
		s.intervalStartMs = intervalEndMs;
		resetAccumulators(s);
		s.timer = scheduleEmit();
	}

	// Timeouts land on UTC interval boundaries so summaries correlate with
	// nginx upstream observations bucketed by wall-clock time.
	function scheduleEmit(): DiagnosticsTimer {
		const delay = intervalMs - (deps.now() % intervalMs);
		const timer = deps.setTimeout(emit, delay);
		timer.unref();
		return timer;
	}

	function start(): void {
		if (session !== null) return;
		session = {
			sampler: deps.createDelaySampler(),
			gcObserver: deps.observeGc(onGcEntries),
			timer: scheduleEmit(),
			// The exit hook lives with the session: stop() removes it, so
			// repeated start/stop cycles cannot accumulate listeners.
			removeExitHook: deps.onExit(stop),
			intervalStartMs: deps.now(),
			prevUtilization: deps.eventLoopUtilization(),
			prevCpu: deps.cpuUsage(),
			gcCount: 0,
			gcTotalDurationMs: 0,
			gcMaxDurationMs: 0,
			gcKinds: new Map(),
		};
		session.sampler.enable();
	}

	function stop(): void {
		const s = session;
		if (s === null) return;
		session = null;
		deps.clearTimeout(s.timer);
		s.gcObserver.disconnect();
		s.sampler.disable();
		s.removeExitHook();
	}

	const handle: EventLoopDiagnostics = {
		get running() {
			return session !== null;
		},
		start,
		stop,
	};
	return handle;
}

// The module-level handle survives hot reloads; a second register() must not
// attach duplicate observers or timers to the same process.
const GLOBAL_HANDLE_KEY = Symbol.for("bible-on-site.event-loop-diagnostics");
type DiagnosticsGlobal = typeof globalThis & {
	[GLOBAL_HANDLE_KEY]?: EventLoopDiagnostics;
};

/**
 * Starts diagnostics when `ENABLE_EVENT_LOOP_DIAGNOSTICS=1`; returns null when
 * disabled (fully inert — nothing is constructed). Repeated calls return the
 * already-running handle instead of duplicating observers.
 */
export function startEventLoopDiagnostics(
	env: DiagnosticsEnv = process.env,
	deps: Partial<EventLoopDiagnosticsDeps> = {},
): EventLoopDiagnostics | null {
	const config = readEventLoopDiagnosticsConfig(env);
	if (!config.enabled) return null;
	const g = globalThis as DiagnosticsGlobal;
	const existing = g[GLOBAL_HANDLE_KEY];
	if (existing) return existing;
	const inner = createEventLoopDiagnostics({
		intervalMs: config.intervalMs,
		...deps,
	});
	const handle: EventLoopDiagnostics = {
		get running() {
			return inner.running;
		},
		start: () => {
			inner.start();
			// Reclaim the guard slot after a restart: stop() cleared it, and a
			// later register() must still find this handle instead of spawning a
			// second monitor. A different live registrant is never displaced.
			if (inner.running && g[GLOBAL_HANDLE_KEY] === undefined)
				g[GLOBAL_HANDLE_KEY] = handle;
		},
		stop: () => {
			inner.stop();
			if (g[GLOBAL_HANDLE_KEY] === handle) delete g[GLOBAL_HANDLE_KEY];
		},
	};
	g[GLOBAL_HANDLE_KEY] = handle;
	handle.start();
	return handle;
}
