/** @jest-environment node */
jest.mock("server-only", () => ({}));

let GET: typeof import("@/app/api/response-time/[monitor]/route").GET;
let fetchSpy: jest.SpyInstance;
const NOW = Date.parse("2026-10-24T20:00:30Z");
const END = Math.floor(NOW / 60_000) * 60;
const request = (monitor: string, query = "") =>
	GET(new Request(`https://site.test/api/response-time/${monitor}${query}`), {
		params: Promise.resolve({ monitor }),
	});

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(NOW);
	jest.resetModules();
	GET = jest.requireActual("@/app/api/response-time/[monitor]/route").GET;
	fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			new Response(
				JSON.stringify({
					stat: "ok",
					monitors: [
						{
							id: 802412112,
							response_times: [{ datetime: END - 60, value: 450 }],
						},
					],
				}),
			),
	);
});
afterEach(() => {
	jest.restoreAllMocks();
	jest.useRealTimers();
});

describe("GET /api/response-time/[monitor]", () => {
	it.each(["unknown", "__proto__", "constructor"])(
		"rejects unknown monitor %s before fetching",
		async (monitor) => {
			const result = await request(monitor);
			expect(result.status).toBe(404);
			expect(result.headers.get("cache-control")).toBe("no-store");
			expect(fetchSpy).not.toHaveBeenCalled();
		},
	);

	it("returns real window/freshness metadata and decreases the cache lifetime with snapshot age", async () => {
		const first = await request("website-co-il");
		expect(first.status).toBe(200);
		expect(first.headers.get("cache-control")).toBe(
			"public, max-age=210, s-maxage=210, must-revalidate",
		);
		const body = await first.json();
		expect(body).toMatchObject({
			meanMs: 450,
			metric: "ttfb_ms",
			sampleCount: 1,
			windowStart: "2026-10-24T19:00:00.000Z",
			windowEnd: "2026-10-24T20:00:00.000Z",
			fetchedAt: "2026-10-24T20:00:30.000Z",
		});
		jest.setSystemTime(NOW + 120_000);
		const cached = await request(
			"website-co-il",
			"?url=https://other.test&api_key=ignored&cachebust=123",
		);
		expect(await cached.json()).toEqual(body);
		expect(cached.headers.get("cache-control")).toBe(
			"public, max-age=90, s-maxage=90, must-revalidate",
		);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("caps HTTP caching at sample expiry and stops serving a nearly stale success", async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					stat: "ok",
					monitors: [
						{
							id: 802412112,
							response_times: [{ datetime: END - 269, value: 450 }],
						},
					],
				}),
			),
		);
		const first = await request("website-co-il");
		expect(first.status).toBe(200);
		expect(first.headers.get("cache-control")).toBe(
			"public, max-age=1, s-maxage=1, must-revalidate",
		);
		jest.setSystemTime(NOW + 1000);
		const expired = await request("website-co-il");
		expect(expired.status).toBe(503);
		expect(expired.headers.get("cache-control")).toBe("no-store");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("returns 503/no-store when a refresh fails instead of the old successful window", async () => {
		expect((await request("website-co-il")).status).toBe(200);
		jest.setSystemTime(NOW + 300_000);
		fetchSpy.mockRejectedValue(new Error("Private upstream failure"));
		const result = await request("website-co-il");
		expect(result.status).toBe(503);
		expect(result.headers.get("cache-control")).toBe("no-store");
		expect(result.headers.get("retry-after")).toBe("60");
		expect(await result.json()).toEqual({
			error: "Response-time measurement unavailable",
		});
	});
});
