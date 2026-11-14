/** @jest-environment node */
jest.mock("server-only", () => ({}));

import type { ResponseTimeMonitor } from "@/lib/response-time";

let service: typeof import("@/lib/response-time");
let fetchSpy: jest.SpyInstance;
const NOW = Date.parse("2026-10-24T20:00:30Z");
const END = Math.floor(NOW / 60_000) * 60;
const point = (secondsAgo: number, value: number) => ({
	datetime: END - secondsAgo,
	value,
});
const points = () => [point(60, 300), point(1800, 600)];
const payload = (responseTimes: unknown = points(), id = 802412112) => ({
	stat: "ok",
	monitors: [
		{ id, response_times: responseTimes, average_response_time: "999999" },
	],
});
const response = (data: unknown = payload()) =>
	new Response(JSON.stringify(data));

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(NOW);
	jest.resetModules();
	service = jest.requireActual("@/lib/response-time");
	fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(response());
});
afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
});

describe("response-time measurement window", () => {
	it("requests an explicit rolling 60-minute UTC window and computes its own TTFB mean", async () => {
		const result = await service.getResponseTime("website-co-il");
		expect(result).toEqual({
			monitor: "website-co-il",
			metric: "ttfb_ms",
			meanMs: 450,
			windowStart: "2026-10-24T19:00:00.000Z",
			windowEnd: "2026-10-24T20:00:00.000Z",
			firstSampleAt: "2026-10-24T19:30:00.000Z",
			latestSampleAt: "2026-10-24T19:59:00.000Z",
			sampleCount: 2,
			fetchedAt: "2026-10-24T20:00:30.000Z",
		});
		const [url, options] = fetchSpy.mock.calls[0];
		expect(url).toBe("https://api.uptimerobot.com/v2/getMonitors");
		expect(options).toMatchObject({
			method: "POST",
			cache: "no-store",
			redirect: "error",
		});
		expect(options.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(options.body)).toEqual({
			api_key: expect.stringMatching(/^m802412112-/),
			response_times: 1,
			response_times_average: 0,
			response_times_limit: 200,
			response_times_start_date: END - 3600,
			response_times_end_date: END - 1,
		});
		expect(JSON.stringify(result)).not.toContain("api_key");
		expect(JSON.stringify(result)).not.toContain("m802412112-");
	});

	it("rolls the window by minute rather than selecting the previous clock hour", async () => {
		const now = Date.parse("2026-10-24T20:37:45Z");
		const end = Date.parse("2026-10-24T20:37:00Z") / 1000;
		jest.setSystemTime(now);
		fetchSpy.mockResolvedValueOnce(
			response(payload([{ datetime: end - 60, value: 450 }])),
		);
		expect(await service.getResponseTime("website-co-il")).toMatchObject({
			windowStart: "2026-10-24T19:37:00.000Z",
			windowEnd: "2026-10-24T20:37:00.000Z",
			fetchedAt: "2026-10-24T20:37:45.000Z",
		});
		expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
			response_times_start_date: end - 3600,
			response_times_end_date: end - 1,
		});
	});

	it("filters yesterday, future and incomplete-minute points without biasing the mean", async () => {
		fetchSpy.mockResolvedValueOnce(
			response(
				payload([
					point(86400, 30_000),
					point(3600, 0),
					point(60, 1000),
					point(0, 30_000),
					point(-60, 30_000),
				]),
			),
		);
		expect(await service.getResponseTime("website-co-il")).toMatchObject({
			meanMs: 500,
			sampleCount: 2,
			firstSampleAt: "2026-10-24T19:00:00.000Z",
		});
	});

	it("rounds only the final arithmetic mean to three decimals", async () => {
		fetchSpy.mockResolvedValueOnce(
			response(payload([point(60, 100), point(120, 100), point(180, 101)])),
		);
		expect(await service.getResponseTime("website-co-il")).toMatchObject({
			meanMs: 100.333,
		});
	});

	it.each([
		{ invalid: [] },
		{ invalid: [point(86400, 300)] },
		{ invalid: [point(-60, 300)] },
		{ invalid: [point(360, 300)] },
		{ invalid: [point(270, 300)] },
		{ invalid: [point(60, 300), point(60, 600)] },
	])(
		"rejects an empty, old, future-only or duplicate sample set: %j",
		async ({ invalid }) => {
			fetchSpy.mockResolvedValueOnce(response(payload(invalid)));
			expect(await service.getResponseTime("website-co-il")).toBeNull();
		},
	);

	it.each([
		{ invalid: null },
		{ invalid: [] },
		{ invalid: {} },
		{ invalid: { stat: "fail" } },
		{ invalid: { stat: "ok", monitors: null } },
		{ invalid: { stat: "ok", monitors: [] } },
		{ invalid: { stat: "ok", monitors: [null] } },
		{
			invalid: { stat: "ok", monitors: [{ id: 802412112 }, { id: 802412112 }] },
		},
		{ invalid: payload(points(), 123) },
		{ invalid: payload(null) },
		{ invalid: payload([]) },
		{ invalid: payload(Array.from({ length: 201 }, () => point(60, 100))) },
	])("fails closed on malformed upstream data: %j", async ({ invalid }) => {
		fetchSpy.mockResolvedValueOnce(response(invalid));
		expect(await service.getResponseTime("website-co-il")).toBeNull();
	});

	it.each([
		{ invalid: null },
		{ invalid: [] },
		{ invalid: {} },
		{ invalid: { datetime: "2026-10-24", value: 100 } },
		{ invalid: { datetime: END - 1.5, value: 100 } },
		{ invalid: { datetime: END - 60, value: "100" } },
		{ invalid: { datetime: END - 60, value: -1 } },
		{ invalid: { datetime: END - 60, value: 30_001 } },
	])(
		"rejects malformed or impossible sample values: %j",
		async ({ invalid }) => {
			fetchSpy.mockResolvedValueOnce(response(payload([invalid])));
			expect(await service.getResponseTime("website-co-il")).toBeNull();
		},
	);

	it("rejects a non-finite value even if a JSON numeric literal overflows", async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response(
				`{"stat":"ok","monitors":[{"id":802412112,"response_times":[{"datetime":${END - 60},"value":1e400}]}]}`,
			),
		);
		expect(await service.getResponseTime("website-co-il")).toBeNull();
	});

	it.each([
		new Response("bad JSON"),
		new Response("unavailable", { status: 503 }),
	])("returns unavailable for a bad HTTP/JSON response", async (invalid) => {
		fetchSpy.mockResolvedValueOnce(invalid);
		expect(await service.getResponseTime("website-co-il")).toBeNull();
	});
});

describe("bounded response-time cache", () => {
	it("deduplicates concurrent requests before caching the successful measurement", async () => {
		let finish!: (value: Response) => void;
		fetchSpy.mockReturnValueOnce(
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
		);
		const requests = Array.from({ length: 12 }, () =>
			service.getResponseTime("website-co-il"),
		);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		finish(response());
		const results = await Promise.all(requests);
		expect(results.every((result) => result === results[0])).toBe(true);
		jest.setSystemTime(NOW + 209_999);
		expect(await service.getResponseTime("website-co-il")).toBe(results[0]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("refreshes when sample freshness expires and never serves an expired success on failure", async () => {
		const original = await service.getResponseTime("website-co-il");
		expect(original).not.toBeNull();
		jest.setSystemTime(NOW + 210_000);
		fetchSpy.mockRejectedValueOnce(new Error("Network unavailable"));
		expect(await service.getResponseTime("website-co-il")).toBeNull();
		expect(await service.getResponseTime("website-co-il")).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		jest.setSystemTime(NOW + 270_000);
		fetchSpy.mockResolvedValueOnce(
			response(payload([{ datetime: END + 240, value: 400 }])),
		);
		expect(await service.getResponseTime("website-co-il")).toMatchObject({
			meanMs: 400,
			windowEnd: "2026-10-24T20:05:00.000Z",
		});
		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});

	it("rejects a sample that reaches its freshness limit while the upstream request is pending", async () => {
		let finish!: (value: Response) => void;
		fetchSpy.mockReturnValueOnce(
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
		);
		const result = service.getResponseTime("website-co-il");
		jest.setSystemTime(NOW + 1000);
		finish(response(payload([point(269, 300)])));
		expect(await result).toBeNull();
	});

	it("expires a nearly stale success without retrying more than once per minute", async () => {
		fetchSpy.mockResolvedValueOnce(response(payload([point(269, 300)])));
		const original = await service.getResponseTime("website-co-il");
		expect(original).not.toBeNull();
		jest.setSystemTime(NOW + 999);
		expect(await service.getResponseTime("website-co-il")).toBe(original);
		jest.setSystemTime(NOW + 1000);
		expect(await service.getResponseTime("website-co-il")).toBeNull();
		jest.setSystemTime(NOW + 59_999);
		expect(await service.getResponseTime("website-co-il")).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		jest.setSystemTime(NOW + 60_000);
		fetchSpy.mockResolvedValueOnce(
			response(payload([{ datetime: END, value: 600 }])),
		);
		expect(await service.getResponseTime("website-co-il")).toMatchObject({
			meanMs: 600,
		});
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("bounds all four monitors to four failed upstream calls per minute", async () => {
		fetchSpy.mockRejectedValue(new Error("Network unavailable"));
		const monitors: ResponseTimeMonitor[] = [
			"website-co-il",
			"website-com",
			"api-co-il",
			"api-com",
		];
		await Promise.all(
			monitors.map((monitor) => service.getResponseTime(monitor)),
		);
		jest.setSystemTime(NOW + 59_999);
		await Promise.all(
			monitors.flatMap((monitor) =>
				Array.from({ length: 5 }, () => service.getResponseTime(monitor)),
			),
		);
		expect(fetchSpy).toHaveBeenCalledTimes(4);
		jest.setSystemTime(NOW + 60_000);
		await Promise.all(
			monitors.map((monitor) => service.getResponseTime(monitor)),
		);
		expect(fetchSpy).toHaveBeenCalledTimes(8);
	});

	it("keeps successful monitors separate and only accepts the four fixed names", async () => {
		fetchSpy.mockResolvedValueOnce(response(payload(points(), 802412088)));
		expect(await service.getResponseTime("api-com")).toMatchObject({
			monitor: "api-com",
		});
		for (const value of [
			"website-co-il",
			"website-com",
			"api-co-il",
			"api-com",
		]) {
			expect(service.isResponseTimeMonitor(value)).toBe(true);
		}
		for (const value of [
			"__proto__",
			"constructor",
			"https://other.test",
			"API-COM",
		]) {
			expect(service.isResponseTimeMonitor(value)).toBe(false);
		}
	});
});
