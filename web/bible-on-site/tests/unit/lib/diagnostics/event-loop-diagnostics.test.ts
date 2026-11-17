/** @jest-environment node */
import {
	type EventLoopUtilization,
	type PerformanceEntry,
	constants as performanceConstants,
} from "node:perf_hooks";
import packageJson from "../../../../package.json";
import {
	createEventLoopDiagnostics,
	type DiagnosticsTimer,
	type EventLoopDelaySampler,
	readEventLoopDiagnosticsConfig,
	startEventLoopDiagnostics,
} from "../../../../src/lib/diagnostics/event-loop-diagnostics";

interface FakeTimer extends DiagnosticsTimer {
	cb: () => void;
	delay: number;
	cleared: boolean;
	unref: jest.Mock;
}

interface FakeObserver {
	disconnect: jest.Mock;
	emit(entries: readonly unknown[]): void;
}

type FakeSampler = Omit<
	EventLoopDelaySampler,
	"count" | "min" | "mean" | "max"
> & {
	enabled: boolean;
	count: number;
	min: number;
	mean: number;
	max: number;
};

function makeDeps() {
	let nowValue = 0;
	let utilization = { idle: 0, active: 0, utilization: 0 };
	let cpu = { user: 0, system: 0 };
	let uptimeSeconds = 0;
	const timers: FakeTimer[] = [];
	const observers: FakeObserver[] = [];
	const samplers: FakeSampler[] = [];
	const exitRegistrations: { cb: () => void; removed: boolean }[] = [];
	const percentileValues = new Map<number, number>();

	const deps = {
		createDelaySampler: jest.fn((): EventLoopDelaySampler => {
			const sampler: FakeSampler = {
				enabled: false,
				count: 0,
				min: 0,
				mean: 0,
				max: 0,
				enable: jest.fn(() => {
					sampler.enabled = true;
					return true;
				}),
				disable: jest.fn(() => {
					sampler.enabled = false;
					return true;
				}),
				reset: jest.fn(),
				percentile: jest.fn((p: number) => percentileValues.get(p) ?? 0),
			};
			samplers.push(sampler);
			return sampler;
		}),
		eventLoopUtilization: jest.fn((): EventLoopUtilization => utilization),
		cpuUsage: jest.fn((): NodeJS.CpuUsage => cpu),
		uptime: jest.fn((): number => uptimeSeconds),
		gcEntryTypeSupported: jest.fn((): boolean => true),
		observeGc: jest.fn(
			(
				onEntries: (entries: readonly PerformanceEntry[]) => void,
			): { disconnect(): void } => {
				const observer: FakeObserver = {
					disconnect: jest.fn(),
					emit: (entries) => onEntries(entries as readonly PerformanceEntry[]),
				};
				observers.push(observer);
				return observer;
			},
		),
		setTimeout: jest.fn((cb: () => void, delay: number): DiagnosticsTimer => {
			const timer: FakeTimer = {
				cb,
				delay,
				cleared: false,
				unref: jest.fn(),
			};
			timers.push(timer);
			return timer;
		}),
		clearTimeout: jest.fn((timer: DiagnosticsTimer): void => {
			(timer as FakeTimer).cleared = true;
		}),
		now: jest.fn((): number => nowValue),
		onExit: jest.fn((cb: () => void): (() => void) => {
			const registration = { cb, removed: false };
			exitRegistrations.push(registration);
			return () => {
				registration.removed = true;
			};
		}),
		log: jest.fn(),
		warn: jest.fn(),
		version: "0.0.0-test",
	};

	return {
		deps,
		timers,
		observers,
		samplers,
		exitRegistrations,
		percentileValues,
		setNow: (ms: number) => {
			nowValue = ms;
		},
		setUtilization: (value: typeof utilization) => {
			utilization = value;
		},
		setCpu: (value: typeof cpu) => {
			cpu = value;
		},
		setUptime: (seconds: number) => {
			uptimeSeconds = seconds;
		},
	};
}

function lastEmitted(log: jest.Mock) {
	expect(log).toHaveBeenCalledTimes(1);
	return JSON.parse(log.mock.calls.at(-1)?.[0] as string);
}

afterEach(() => {
	const key = Symbol.for("bible-on-site.event-loop-diagnostics");
	(globalThis as Record<symbol, { stop?(): void } | undefined>)[key]?.stop?.();
});

describe("readEventLoopDiagnosticsConfig", () => {
	it("is disabled when the flag is absent or not '1'", () => {
		expect(readEventLoopDiagnosticsConfig({}).enabled).toBe(false);
		expect(
			readEventLoopDiagnosticsConfig({
				ENABLE_EVENT_LOOP_DIAGNOSTICS: "0",
			}).enabled,
		).toBe(false);
		expect(
			readEventLoopDiagnosticsConfig({
				ENABLE_EVENT_LOOP_DIAGNOSTICS: "true",
			}).enabled,
		).toBe(false);
	});

	it("reads process.env by default", () => {
		const previous = process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS;
		process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS = "1";
		try {
			expect(readEventLoopDiagnosticsConfig().enabled).toBe(true);
		} finally {
			if (previous === undefined)
				delete process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS;
			else process.env.ENABLE_EVENT_LOOP_DIAGNOSTICS = previous;
		}
	});

	it("is enabled with the flag '1' and defaults to a 60s interval", () => {
		expect(
			readEventLoopDiagnosticsConfig({
				ENABLE_EVENT_LOOP_DIAGNOSTICS: "1",
			}),
		).toEqual({ enabled: true, intervalMs: 60_000 });
	});

	it("parses a configured interval", () => {
		expect(
			readEventLoopDiagnosticsConfig({
				ENABLE_EVENT_LOOP_DIAGNOSTICS: "1",
				EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS: "5000",
			}).intervalMs,
		).toBe(5000);
	});

	it("clamps the interval to the bounded range", () => {
		expect(
			readEventLoopDiagnosticsConfig({
				ENABLE_EVENT_LOOP_DIAGNOSTICS: "1",
				EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS: "10",
			}).intervalMs,
		).toBe(1000);
		expect(
			readEventLoopDiagnosticsConfig({
				ENABLE_EVENT_LOOP_DIAGNOSTICS: "1",
				EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS: "99999999",
			}).intervalMs,
		).toBe(900_000);
	});

	it.each(["abc", "0", "-50", ""])(
		"falls back to the default interval for %p",
		(value) => {
			expect(
				readEventLoopDiagnosticsConfig({
					ENABLE_EVENT_LOOP_DIAGNOSTICS: "1",
					EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS: value,
				}).intervalMs,
			).toBe(60_000);
		},
	);
});

describe("createEventLoopDiagnostics", () => {
	it("stays quiet until the first aligned interval boundary", () => {
		const { deps, timers, samplers, observers, setNow } = makeDeps();
		setNow(6100);
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		expect(handle.running).toBe(true);
		expect(samplers[0].enable).toHaveBeenCalled();
		expect(observers).toHaveLength(1);
		// 6100ms into a 5000ms grid: the next boundary is 10000, i.e. +3900ms.
		expect(deps.setTimeout).toHaveBeenCalledWith(expect.any(Function), 3900);
		expect(timers[0].unref).toHaveBeenCalled();
		expect(deps.log).not.toHaveBeenCalled();
	});

	it("emits one bounded structured summary per interval", () => {
		const {
			deps,
			timers,
			samplers,
			percentileValues,
			setNow,
			setUtilization,
			setCpu,
			setUptime,
		} = makeDeps();
		setNow(6100);
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		const sampler = samplers[0];
		sampler.count = 40;
		sampler.min = 500_000; // 0.5ms
		sampler.mean = 2_000_000; // 2ms
		sampler.max = 3_000_000_000; // 3000ms
		percentileValues.set(50, 1_000_000);
		percentileValues.set(90, 5_000_000);
		percentileValues.set(95, 8_000_000);
		percentileValues.set(99, 900_000_000);
		setUtilization({ idle: 3000, active: 2000, utilization: 0.4 });
		setCpu({ user: 500_000, system: 100_000 });
		setUptime(42.5);
		setNow(10_000);
		timers[0].cb();

		const summary = lastEmitted(deps.log);
		expect(summary).toEqual({
			type: "event-loop-diagnostics",
			version: "0.0.0-test",
			intervalStart: new Date(6100).toISOString(),
			intervalEnd: new Date(10_000).toISOString(),
			uptimeSeconds: 42.5,
			eventLoopDelay: {
				count: 40,
				minMs: 0.5,
				meanMs: 2,
				maxMs: 3000,
				p50Ms: 1,
				p90Ms: 5,
				p95Ms: 8,
				p99Ms: 900,
			},
			eventLoopUtilization: {
				idleMs: 3000,
				activeMs: 2000,
				utilization: 0.4,
			},
			cpu: { userMs: 500, systemMs: 100 },
			gc: {
				count: 0,
				totalDurationMs: 0,
				maxDurationMs: 0,
				kinds: {},
			},
		});
	});

	it("resets accumulators and keeps windows contiguous", () => {
		const { deps, timers, samplers, setNow } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		setNow(10_000);
		timers[0].cb();
		expect(samplers[0].reset).toHaveBeenCalledTimes(1);
		expect(deps.setTimeout).toHaveBeenLastCalledWith(
			expect.any(Function),
			5000,
		);
		setNow(15_000);
		timers[1].cb();
		expect(deps.log).toHaveBeenCalledTimes(2);
		const second = JSON.parse(deps.log.mock.calls[1][0]);
		expect(second.intervalStart).toBe(new Date(10_000).toISOString());
		expect(second.intervalEnd).toBe(new Date(15_000).toISOString());
	});

	it("accumulates GC entries with runtime kind names", () => {
		const { deps, timers, observers, setNow } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		observers[0].emit([
			{
				duration: 12.5,
				detail: { kind: performanceConstants.NODE_PERFORMANCE_GC_MAJOR },
			},
			{
				duration: 2,
				detail: { kind: performanceConstants.NODE_PERFORMANCE_GC_MINOR },
			},
			{ duration: 3, detail: { kind: 42 } },
		]);
		setNow(5000);
		timers[0].cb();
		const summary = lastEmitted(deps.log);
		expect(summary.gc).toEqual({
			count: 3,
			totalDurationMs: 17.5,
			maxDurationMs: 12.5,
			kinds: { major: 1, minor: 1, kind42: 1 },
		});
	});

	it("reads the legacy kind accessor when detail is absent", () => {
		const { deps, timers, observers, setNow } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		observers[0].emit([
			{
				duration: 1,
				kind: performanceConstants.NODE_PERFORMANCE_GC_WEAKCB,
			},
			{ duration: 1 },
		]);
		setNow(5000);
		timers[0].cb();
		expect(lastEmitted(deps.log).gc.kinds).toEqual({
			weakcb: 1,
			kind0: 1,
		});
	});

	it("emits zero delay stats when no samples were recorded", () => {
		const { deps, timers, setNow } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		setNow(5000);
		timers[0].cb();
		expect(lastEmitted(deps.log).eventLoopDelay).toEqual({
			count: 0,
			minMs: 0,
			meanMs: 0,
			maxMs: 0,
			p50Ms: 0,
			p90Ms: 0,
			p95Ms: 0,
			p99Ms: 0,
		});
	});

	it("reports zero utilization deltas when live counters did not advance", () => {
		const { deps, timers, setNow, setUtilization } = makeDeps();
		setUtilization({ idle: 100, active: 50, utilization: 0.25 });
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		setNow(5000);
		timers[0].cb();
		expect(lastEmitted(deps.log).eventLoopUtilization).toEqual({
			idleMs: 0,
			activeMs: 0,
			utilization: 0,
		});
	});

	it.each([
		// The makeDeps default {0,0,0} snapshot already is the Bun stub shape.
		["a zero-returning stub", undefined, false],
		[
			"a throwing primitive",
			() => {
				throw new Error("not implemented");
			},
			true,
		],
		[
			"a malformed snapshot",
			() => ({ idle: Number.NaN, active: 0, utilization: 0 }),
			false,
		],
		[
			"a snapshot with a non-finite active",
			() => ({ idle: 5, active: Number.NaN, utilization: 0 }),
			false,
		],
		[
			"a null snapshot",
			() => null as unknown as EventLoopUtilization,
			false,
		],
		[
			"a non-object snapshot",
			() => "nope" as unknown as EventLoopUtilization,
			false,
		],
	])(
		"marks eventLoopUtilization unsupported for %s",
		(_label, implementation, throws) => {
			const { deps, timers, setNow } = makeDeps();
			if (implementation !== undefined) {
				deps.eventLoopUtilization.mockImplementation(
					implementation as () => EventLoopUtilization,
				);
			}
			const handle = createEventLoopDiagnostics({
				intervalMs: 5000,
				...deps,
			});
			handle.start();
			setNow(5000);
			timers[0].cb();
			expect(lastEmitted(deps.log).eventLoopUtilization).toEqual({
				unsupported: true,
			});
			// A thrown read is caught and reported once per session — the
			// anchor read at start() and the emit read dedupe to one warn;
			// malformed returns carry no error to log.
			expect(deps.warn).toHaveBeenCalledTimes(throws ? 1 : 0);
			if (throws) {
				expect(deps.warn).toHaveBeenCalledWith(
					expect.stringContaining("eventLoopUtilization"),
					expect.any(Error),
				);
			}
			handle.stop();
		},
	);

	it("reports cumulative deltas once stub counters start advancing", () => {
		const { deps, timers, setNow, setUtilization } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		setNow(5000);
		timers[0].cb();
		expect(
			JSON.parse(deps.log.mock.calls[0][0]).eventLoopUtilization,
		).toEqual({ unsupported: true });
		setUtilization({ idle: 300, active: 100, utilization: 0.25 });
		setNow(10_000);
		timers[1].cb();
		// The first live window is anchored at zero, so the delta is the
		// counter's cumulative measured work — real data, not a fake zero.
		expect(
			JSON.parse(deps.log.mock.calls[1][0]).eventLoopUtilization,
		).toEqual({ idleMs: 300, activeMs: 100, utilization: 0.25 });
		setUtilization({ idle: 700, active: 300, utilization: 0.3 });
		setNow(15_000);
		timers[2].cb();
		expect(
			JSON.parse(deps.log.mock.calls[2][0]).eventLoopUtilization,
		).toEqual({ idleMs: 400, activeMs: 200, utilization: 0.333 });
	});

	it.each([
		// The makeDeps default {0,0} snapshot already is the stub shape.
		["a zero-returning stub", undefined, false],
		[
			"a throwing primitive",
			() => {
				throw new Error("not implemented");
			},
			true,
		],
		["a malformed snapshot", () => ({ user: 500, system: Number.NaN }), false],
		["a snapshot missing user", () => ({ user: Number.NaN, system: 5 }), false],
		["a null snapshot", () => null as unknown as NodeJS.CpuUsage, false],
		["a non-object snapshot", () => 7 as unknown as NodeJS.CpuUsage, false],
	])(
		"marks cpu unsupported for %s",
		(_label, implementation, throws) => {
			const { deps, timers, setNow } = makeDeps();
			if (implementation !== undefined) {
				deps.cpuUsage.mockImplementation(
					implementation as () => NodeJS.CpuUsage,
				);
			}
			const handle = createEventLoopDiagnostics({
				intervalMs: 5000,
				...deps,
			});
			handle.start();
			setNow(5000);
			timers[0].cb();
			expect(lastEmitted(deps.log).cpu).toEqual({ unsupported: true });
			expect(deps.warn).toHaveBeenCalledTimes(throws ? 1 : 0);
			if (throws) {
				expect(deps.warn).toHaveBeenCalledWith(
					expect.stringContaining("cpuUsage"),
					expect.any(Error),
				);
			}
			handle.stop();
		},
	);

	it("marks gc unsupported without attaching an observer when the entry type is unavailable", () => {
		const { deps, timers, observers, setNow } = makeDeps();
		deps.gcEntryTypeSupported.mockReturnValue(false);
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		setNow(5000);
		timers[0].cb();
		expect(deps.observeGc).not.toHaveBeenCalled();
		expect(observers).toHaveLength(0);
		expect(lastEmitted(deps.log).gc).toEqual({ unsupported: true });
		handle.stop();
	});

	it("marks gc unsupported when observing throws despite claimed support", () => {
		const { deps, timers, setNow } = makeDeps();
		deps.observeGc.mockImplementation(() => {
			throw new Error("observe failed");
		});
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		setNow(5000);
		timers[0].cb();
		expect(lastEmitted(deps.log).gc).toEqual({ unsupported: true });
		expect(deps.warn).toHaveBeenCalledWith(
			expect.stringContaining("gc observer"),
			expect.any(Error),
		);
		handle.stop();
	});

	it("marks gc unsupported when the real probe cannot verify the entry type", () => {
		const { PerformanceObserver } = jest.requireActual<
			typeof import("node:perf_hooks")
		>("node:perf_hooks");
		const original = Object.getOwnPropertyDescriptor(
			PerformanceObserver,
			"supportedEntryTypes",
		);
		const { deps, timers, setNow } = makeDeps();
		// Drop the injected probe so the default reads the patched getter.
		const { gcEntryTypeSupported: _gcProbe, ...realProbeDeps } = deps;
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...realProbeDeps,
		});
		try {
			// A capability list that omits "gc" — the Bun signature.
			Object.defineProperty(PerformanceObserver, "supportedEntryTypes", {
				get: () => ["mark", "measure"],
				configurable: true,
			});
			handle.start();
			setNow(5000);
			timers[0].cb();
			expect(JSON.parse(deps.log.mock.calls[0][0]).gc).toEqual({
				unsupported: true,
			});
			expect(deps.observeGc).not.toHaveBeenCalled();
			handle.stop();

			// A getter that throws — support cannot be verified at all.
			Object.defineProperty(PerformanceObserver, "supportedEntryTypes", {
				get: () => {
					throw new Error("no list");
				},
				configurable: true,
			});
			deps.log.mockClear();
			handle.start();
			setNow(10_000);
			timers[2].cb();
			expect(JSON.parse(deps.log.mock.calls[0][0]).gc).toEqual({
				unsupported: true,
			});
			// The throwing capability getter is caught by the acquirer and
			// logged once — unsupported marks the field, warn keeps the cause.
			expect(deps.warn).toHaveBeenCalledTimes(1);
			expect(deps.warn).toHaveBeenCalledWith(
				expect.stringContaining("gc observer"),
				expect.any(Error),
			);
			handle.stop();
		} finally {
			if (original) {
				Object.defineProperty(
					PerformanceObserver,
					"supportedEntryTypes",
					original,
				);
			}
		}
	});

	it("marks eventLoopDelay unsupported without crashing when the sampler cannot be created", () => {
		const { deps, timers, setNow } = makeDeps();
		deps.createDelaySampler.mockImplementation(() => {
			throw new Error("monitorEventLoopDelay missing");
		});
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		expect(() => handle.start()).not.toThrow();
		expect(handle.running).toBe(true);
		expect(deps.warn).toHaveBeenCalledTimes(1);
		expect(deps.warn).toHaveBeenCalledWith(
			expect.stringContaining("delay sampler"),
			expect.any(Error),
		);
		setNow(5000);
		timers[0].cb();
		expect(
			JSON.parse(deps.log.mock.calls[0][0]).eventLoopDelay,
		).toEqual({ unsupported: true });
		// A second window exercises accumulator reset with no sampler.
		setNow(10_000);
		timers[1].cb();
		expect(
			JSON.parse(deps.log.mock.calls[1][0]).eventLoopDelay,
		).toEqual({ unsupported: true });
		expect(() => handle.stop()).not.toThrow();
	});

	it("start is idempotent", () => {
		const { deps } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		handle.start();
		expect(deps.createDelaySampler).toHaveBeenCalledTimes(1);
		expect(deps.observeGc).toHaveBeenCalledTimes(1);
		expect(deps.setTimeout).toHaveBeenCalledTimes(1);
	});

	it("stop releases timer, observer and sampler", () => {
		const { deps, timers, samplers, observers, setNow } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		handle.stop();
		expect(handle.running).toBe(false);
		expect(timers[0].cleared).toBe(true);
		expect(observers[0].disconnect).toHaveBeenCalled();
		expect(samplers[0].disable).toHaveBeenCalled();
		setNow(5000);
		timers[0].cb();
		expect(deps.log).not.toHaveBeenCalled();
	});

	it("ignores GC entries that arrive after stop", () => {
		const { deps, observers } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.start();
		handle.stop();
		expect(() =>
			observers[0].emit([{ duration: 5, detail: { kind: 1 } }]),
		).not.toThrow();
	});

	it("stop is idempotent and start after stop re-arms", () => {
		const { deps } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		handle.stop();
		handle.start();
		handle.stop();
		handle.stop();
		expect(deps.createDelaySampler).toHaveBeenCalledTimes(1);
		expect(deps.clearTimeout).toHaveBeenCalledTimes(1);
		handle.start();
		expect(deps.createDelaySampler).toHaveBeenCalledTimes(2);
	});

	it("registers an exit teardown per session and releases it on stop", () => {
		const { deps, exitRegistrations } = makeDeps();
		const a = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		const b = createEventLoopDiagnostics({
			intervalMs: 5000,
			...deps,
		});
		a.start();
		b.start();
		expect(deps.onExit).toHaveBeenCalledTimes(2);
		b.stop();
		expect(exitRegistrations[1].removed).toBe(true);
		// A hook already released before it fires stays an inert no-op.
		exitRegistrations[1].cb();
		expect(b.running).toBe(false);
		exitRegistrations[0].cb();
		expect(a.running).toBe(false);
		expect(exitRegistrations[0].removed).toBe(true);
	});

	it("does not retain exit hooks across start/stop cycles", () => {
		const { deps, exitRegistrations } = makeDeps();
		for (let i = 0; i < 3; i++) {
			const handle = createEventLoopDiagnostics({
				intervalMs: 5000,
				...deps,
			});
			handle.start();
			handle.stop();
		}
		expect(exitRegistrations).toHaveLength(3);
		expect(exitRegistrations.every((r) => r.removed)).toBe(true);
	});

	it("clamps a non-positive interval to 1ms", () => {
		const { deps } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: 0,
			...deps,
		});
		handle.start();
		expect(deps.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1);
	});

	it("falls back to the default interval for a non-finite intervalMs", () => {
		const { deps } = makeDeps();
		const handle = createEventLoopDiagnostics({
			intervalMs: Number.NaN,
			...deps,
		});
		handle.start();
		expect(deps.setTimeout).toHaveBeenCalledWith(
			expect.any(Function),
			60_000,
		);
	});

	it("emits through the real runtime primitives, GC observer, console sink and version", async () => {
		const { deps, timers, setNow } = makeDeps();
		const {
			createDelaySampler: _createDelaySampler,
			eventLoopUtilization: _eventLoopUtilization,
			cpuUsage: _cpuUsage,
			gcEntryTypeSupported: _gcEntryTypeSupported,
			log: _log,
			uptime: _uptime,
			observeGc: _observeGc,
			version: _version,
			...defaults
		} = deps;
		const consoleSpy = jest
			.spyOn(console, "log")
			.mockImplementation(() => undefined);
		try {
			const handle = createEventLoopDiagnostics({
				intervalMs: 5000,
				...defaults,
			});
			handle.start();
			// Allocation churn guarantees the real GC observer delivers entries.
			for (let i = 0; i < 200; i++) {
				const churn = new Array(1e6).fill(i);
				churn.length = 0;
			}
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));
			setNow(5000);
			timers[0].cb();
			const line = consoleSpy.mock.calls
				.map((call) => call[0])
				.find(
					(arg) =>
						typeof arg === "string" && arg.includes("event-loop-diagnostics"),
				);
			expect(line).toBeDefined();
			const summary = JSON.parse(line as string);
			expect(summary.version).toBe(packageJson.version);
			expect(summary.uptimeSeconds).toBeGreaterThan(0);
			// Under Node every primitive is supported and reports real values.
			expect(summary.eventLoopDelay.unsupported).not.toBe(true);
			expect(summary.eventLoopDelay.count).toBeGreaterThanOrEqual(0);
			expect(summary.eventLoopUtilization.unsupported).not.toBe(true);
			expect(summary.eventLoopUtilization.idleMs).toBeGreaterThanOrEqual(0);
			expect(summary.cpu.unsupported).not.toBe(true);
			expect(summary.cpu.userMs).toBeGreaterThanOrEqual(0);
			expect(summary.gc.unsupported).not.toBe(true);
			expect(summary.gc.count).toBeGreaterThan(0);
			handle.stop();
		} finally {
			consoleSpy.mockRestore();
		}
	});
});

describe("startEventLoopDiagnostics", () => {
	it("returns null and constructs nothing when disabled", () => {
		const { deps } = makeDeps();
		expect(startEventLoopDiagnostics({}, deps)).toBeNull();
		expect(
			startEventLoopDiagnostics({ ENABLE_EVENT_LOOP_DIAGNOSTICS: "0" }, deps),
		).toBeNull();
		expect(deps.createDelaySampler).not.toHaveBeenCalled();
		expect(deps.setTimeout).not.toHaveBeenCalled();
	});

	it("starts one guarded process-wide instance", () => {
		const { deps } = makeDeps();
		const env = {
			ENABLE_EVENT_LOOP_DIAGNOSTICS: "1",
			EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS: "5000",
		};
		const first = startEventLoopDiagnostics(env, deps);
		const second = startEventLoopDiagnostics(env, deps);
		expect(first).not.toBeNull();
		expect(second).toBe(first);
		expect(deps.createDelaySampler).toHaveBeenCalledTimes(1);
		expect(deps.observeGc).toHaveBeenCalledTimes(1);
		expect(first?.running).toBe(true);
	});

	it("creates a fresh instance after the guarded handle stops", () => {
		const { deps } = makeDeps();
		const env = { ENABLE_EVENT_LOOP_DIAGNOSTICS: "1" };
		const first = startEventLoopDiagnostics(env, deps);
		first?.stop();
		const second = startEventLoopDiagnostics(env, deps);
		expect(second).not.toBe(first);
		expect(deps.createDelaySampler).toHaveBeenCalledTimes(2);
		// Stopping a superseded handle must not clear the live global.
		first?.stop();
		expect(second?.running).toBe(true);
		second?.stop();
	});

	it("keeps the process-wide guard after a stop/start restart", () => {
		const { deps } = makeDeps();
		const env = { ENABLE_EVENT_LOOP_DIAGNOSTICS: "1" };
		const handle = startEventLoopDiagnostics(env, deps);
		handle?.stop();
		handle?.start();
		const again = startEventLoopDiagnostics(env, deps);
		expect(again).toBe(handle);
		// One sampler and observer per session — restart made a second pair,
		// never a leaked third.
		expect(deps.createDelaySampler).toHaveBeenCalledTimes(2);
		expect(deps.observeGc).toHaveBeenCalledTimes(2);
		handle?.stop();
	});

	it("releases the exit hook on every guarded stop", () => {
		const { deps, exitRegistrations } = makeDeps();
		const env = { ENABLE_EVENT_LOOP_DIAGNOSTICS: "1" };
		for (let i = 0; i < 3; i++) {
			startEventLoopDiagnostics(env, deps)?.stop();
		}
		expect(exitRegistrations).toHaveLength(3);
		expect(exitRegistrations.every((r) => r.removed)).toBe(true);
	});
});
