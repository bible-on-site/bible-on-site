/**
 * @jest-environment node
 */
// HTTP contract for #2395: error and degraded answers must not be cached
// downstream (Shields/Camo), and unavailable fields must be omitted so badges
// render a clear "no result" instead of a bare "/5" or "inaccessible".

describe("GET /api/store-metadata/[platform] resilience (#2395)", () => {
	const PLAY_SNIPPET =
		'prefix "141":[[["5.0.139"]],[[[36]],[[[23,"6.0"]]]]] suffix';
	const PLAY_SNIPPET_RATED = `${PLAY_SNIPPET} aria-label="Rated 4.9 stars"`;
	const MINUTE_MS = 60_000;

	async function loadRoute() {
		jest.resetModules();
		const route = await import(
			"../../../src/app/api/store-metadata/[platform]/route"
		);
		return route.GET;
	}

	function args(platform: string) {
		return [
			new Request(`http://x/api/store-metadata/${platform}`),
			{ params: Promise.resolve({ platform }) },
		] as const;
	}

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it("answers 503 with no-store and Retry-After when nothing was ever observed", async () => {
		const GET = await loadRoute();
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		const response = await GET(...args("android"));
		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(response.headers.get("retry-after")).toBe("60");
	});

	it("omits absent fields so badges show 'no result' rather than a bare /5", async () => {
		const GET = await loadRoute();
		jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET)); // version only
		const response = await GET(...args("android"));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.version).toBe("5.0.139");
		expect("rating" in body).toBe(false);
		expect("ratingCount" in body).toBe(false);
		expect(body.stale).toBe(false);
	});

	it("marks stale answers no-store while fresh ones keep a bounded max-age", async () => {
		const GET = await loadRoute();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET_RATED));
		const fresh = await GET(...args("android"));
		expect(fresh.status).toBe(200);
		expect(fresh.headers.get("cache-control")).toContain("max-age");
		expect(fresh.headers.get("cache-control")).not.toContain("no-store");

		// Past the fresh window with the store down: last-good is served but
		// must not be pinned in downstream caches.
		jest.useFakeTimers().setSystemTime(Date.now() + 61 * MINUTE_MS);
		spy.mockRejectedValue(new Error("down"));
		const stale = await GET(...args("android"));
		expect(stale.status).toBe(200);
		expect(stale.headers.get("cache-control")).toContain("no-store");
		const body = await stale.json();
		expect(body.version).toBe("5.0.139");
		expect(body.stale).toBe(true);
	});
});
