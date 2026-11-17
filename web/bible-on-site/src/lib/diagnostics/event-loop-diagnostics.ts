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
	/**
	 * True only when the runtime can actually deliver `gc` performance
	 * entries. `supportedEntryTypes` is the honest probe: Bun accepts
	 * `observe({entryTypes: ["gc"]})` without throwing yet never delivers
	 * entries, which would report permanent healthy-looking zeros (#3351).
	 */
	gcEntryTypeSupported: () => boolean;
	observeGc: (onEntries: (entries: readonly PerformanceEntry[]) => void) => {
		disconnect(): void;
	};
	setTimeout: (callback: () => void, delay: number) => DiagnosticsTimer;
	clearTimeout: (timer: DiagnosticsTimer) => void;
	now: () => number;
	/** Registers a teardown hook run at process exit; returns its remover. */
	onExit: (callback: () => void) => () => void;
	log: (line: string) => void;
	/**
	 * Surfaces swallowed primitive failures. A capability probe or reader
	 * that throws must stay visible to operators; the emitted field still
	 * reports `unsupported`, but the cause is never silently dropped.
	 */
	warn: (message: string, error: unknown) => void;
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
	// A missing capability list means support cannot be verified — the caller
	// treats a false return as unsupported. A throwing probe propagates into
	// the acquirer's catch, which logs it instead of hiding it.
	gcEntryTypeSupported: () => {
		const types = PerformanceObserver.supportedEntryTypes;
		return Array.isArray(types) && types.includes("gc");
	},
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
	warn: (message, error) => console.warn(message, error),
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

/** Explicit per-field marker for primitives the runtime cannot provide. */
const UNSUPPORTED = { unsupported: true } as const;

interface DiagnosticsSession {
	sampler: EventLoopDelaySampler | null;
	gcObserver: { disconnect(): void } | null;
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

	// null while stopped. Inside a live session, `sampler`/`gcObserver` are
	// null only when the runtime cannot provide that primitive — the emitted
	// field then reports `unsupported` instead of healthy-looking zeros.
	let session: DiagnosticsSession | null = null;

	// Readers run every window, so a permanently broken primitive must not
	// re-warn each emit; the dedupe resets with each start().
	const warnedKeys = new Set<string>();
	function warnOnce(key: string, message: string, error: unknown): void {
		if (warnedKeys.has(key)) return;
		warnedKeys.add(key);
		deps.warn(message, error);
	}

	// A diagnostics session must never take the server down: a runtime that
	// lacks a primitive reports it unsupported per window instead of throwing
	// during start() and failing instrumentation register(). The failure is
	// still logged — unsupported marks the field, not the cause.
	function acquireSampler(): EventLoopDelaySampler | null {
		try {
			const sampler = deps.createDelaySampler();
			sampler.enable();
			return sampler;
		} catch (error) {
			warnOnce(
				"delay-sampler",
				"event-loop diagnostics: delay sampler unavailable; reporting eventLoopDelay unsupported",
				error,
			);
			return null;
		}
	}

	function acquireGcObserver(): { disconnect(): void } | null {
		try {
			if (!deps.gcEntryTypeSupported()) return null;
			return deps.observeGc(onGcEntries);
		} catch (error) {
			warnOnce(
				"gc-observer",
				"event-loop diagnostics: gc observer unavailable; reporting gc unsupported",
				error,
			);
			return null;
		}
	}

	// A cumulative counter that still reads exactly zero while the emit
	// callback itself executes is a stub, not a real measurement: running this
	// callback required loop-active time and CPU, so a working counter cannot
	// still total 0. Bun's `performance.eventLoopUtilization()` is exactly
	// that stub — the function exists yet returns `{idle:0, active:0,
	// utilization:0}` forever (#3351).
	function readUtilization(): EventLoopUtilization | null {
		try {
			const u = deps.eventLoopUtilization();
			if (
				u !== null &&
				typeof u === "object" &&
				Number.isFinite(u.idle) &&
				Number.isFinite(u.active)
			)
				return u;
		} catch (error) {
			warnOnce(
				"elu-read",
				"event-loop diagnostics: eventLoopUtilization() unavailable; reporting unsupported",
				error,
			);
		}
		return null;
	}

	function readCpu(): NodeJS.CpuUsage | null {
		try {
			const c = deps.cpuUsage();
			if (
				c !== null &&
				typeof c === "object" &&
				Number.isFinite(c.user) &&
				Number.isFinite(c.system)
			)
				return c;
		} catch (error) {
			warnOnce(
				"cpu-read",
				"event-loop diagnostics: cpuUsage() unavailable; reporting unsupported",
				error,
			);
		}
		return null;
	}

	function resetAccumulators(s: DiagnosticsSession): void {
		s.sampler?.reset();
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

	function delaySummary(sampler: EventLoopDelaySampler) {
		const count = sampler.count;
		const toMs = (ns: number) => round3(ns / NS_PER_MS);
		return {
			count,
			minMs: count > 0 ? toMs(sampler.min) : 0,
			meanMs: count > 0 ? toMs(sampler.mean) : 0,
			maxMs: count > 0 ? toMs(sampler.max) : 0,
			p50Ms: count > 0 ? toMs(sampler.percentile(50)) : 0,
			p90Ms: count > 0 ? toMs(sampler.percentile(90)) : 0,
			p95Ms: count > 0 ? toMs(sampler.percentile(95)) : 0,
			p99Ms: count > 0 ? toMs(sampler.percentile(99)) : 0,
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
		const utilizationNow = readUtilization();
		const cpuNow = readCpu();
		deps.log(
			JSON.stringify({
				type: "event-loop-diagnostics",
				version: deps.version,
				intervalStart: new Date(s.intervalStartMs).toISOString(),
				intervalEnd: new Date(intervalEndMs).toISOString(),
				uptimeSeconds: round3(deps.uptime()),
				eventLoopDelay:
					s.sampler === null ? UNSUPPORTED : delaySummary(s.sampler),
				// A cumulative counter still at zero while this callback runs is
				// a stub (Bun ships one for eventLoopUtilization); real per-window
				// zeros keep reporting whenever the counters are live.
				eventLoopUtilization:
					utilizationNow !== null &&
					utilizationNow.idle + utilizationNow.active > 0
						? utilizationSummary(s, utilizationNow)
						: UNSUPPORTED,
				cpu:
					cpuNow !== null && cpuNow.user + cpuNow.system > 0
						? {
								userMs: round3(
									(cpuNow.user - s.prevCpu.user) / US_PER_MS,
								),
								systemMs: round3(
									(cpuNow.system - s.prevCpu.system) / US_PER_MS,
								),
							}
						: UNSUPPORTED,
				gc:
					s.gcObserver === null
						? UNSUPPORTED
						: {
								count: s.gcCount,
								totalDurationMs: round3(s.gcTotalDurationMs),
								maxDurationMs: round3(s.gcMaxDurationMs),
								kinds: Object.fromEntries(s.gcKinds),
							},
			}),
		);
		if (utilizationNow !== null) s.prevUtilization = utilizationNow;
		if (cpuNow !== null) s.prevCpu = cpuNow;
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
		// A new session re-warns on primitive failures: a runtime that recovers
		// and breaks again must not hide the second failure behind dedupe.
		warnedKeys.clear();
		session = {
			sampler: acquireSampler(),
			gcObserver: acquireGcObserver(),
			timer: scheduleEmit(),
			// The exit hook lives with the session: stop() removes it, so
			// repeated start/stop cycles cannot accumulate listeners.
			removeExitHook: deps.onExit(stop),
			intervalStartMs: deps.now(),
			// A stub/absent primitive anchors at zero so a later live snapshot
			// still produces honest deltas rather than a thrown start().
			prevUtilization: readUtilization() ?? {
				idle: 0,
				active: 0,
				utilization: 0,
			},
			prevCpu: readCpu() ?? { user: 0, system: 0 },
			gcCount: 0,
			gcTotalDurationMs: 0,
			gcMaxDurationMs: 0,
			gcKinds: new Map(),
		};
	}

	function stop(): void {
		const s = session;
		if (s === null) return;
		session = null;
		deps.clearTimeout(s.timer);
		s.gcObserver?.disconnect();
		s.sampler?.disable();
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
