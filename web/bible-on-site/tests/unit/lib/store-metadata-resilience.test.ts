/**
 * @jest-environment node
 */
// Regression coverage for #2395: the store-metadata pipeline must survive
// transient store failures without evicting last-known-good data, without
// letting a synchronous scrape exceed the Shields upstream timeout (3.5 s),
// and without letting error answers poison downstream caches.

describe("getStoreMetadata resilience (#2395)", () => {
	const PLAY_SNIPPET =
		'prefix "141":[[["5.0.139"]],[[[36]],[[[23,"6.0"]]]]] suffix';
	const PLAY_SNIPPET_RATED = `${PLAY_SNIPPET} aria-label="Rated 4.9 stars"`;
	const PLAY_WITHOUT_FIELDS =
		"<html>play markup with no details anchor</html>";

	const MINUTE_MS = 60_000;
	const HOUR_MS = 60 * MINUTE_MS;

	async function loadLib() {
		jest.resetModules();
		return await import("@/lib/store-metadata");
	}

	/** Let a fire-and-forget background refresh settle before asserting. */
	async function flushBackgroundRefresh(): Promise<void> {
		// Microtask yields only: setImmediate is faked while fake timers are on.
		for (let i = 0; i < 10; i++) await Promise.resolve();
	}

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
		// Restore the empty snapshot mock registered in jest.setup.js.
		jest.doMock(
			"@/data/db/store-metadata-snapshot.generated.json",
			() => ({}),
		);
	});

	it("keeps last-known-good when a refresh answer parses to zero fields", async () => {
		const { getStoreMetadata } = await loadLib();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET_RATED));
		const fresh = await getStoreMetadata("android");
		expect(fresh.version).toBe("5.0.139");
		expect(fresh.rating).toBe(4.9);
		expect(fresh.stale).toBe(false);

		// Past the fresh window: an HTTP 200 that parses to nothing must not
		// evict the last-good snapshot nor be reported as a fresh observation.
		jest.useFakeTimers().setSystemTime(Date.now() + 61 * MINUTE_MS);
		spy.mockResolvedValue(new Response(PLAY_WITHOUT_FIELDS));
		const degraded = await getStoreMetadata("android");
		expect(degraded.version).toBe("5.0.139");
		expect(degraded.rating).toBe(4.9);
		expect(degraded.stale).toBe(true);
		await flushBackgroundRefresh();

		// Once the failure backoff elapses the next request retries upstream;
		// a transport failure still serves the retained last-good values.
		jest.setSystemTime(Date.now() + 2 * MINUTE_MS);
		spy.mockRejectedValue(new Error("down"));
		const stillGood = await getStoreMetadata("android");
		await flushBackgroundRefresh();
		expect(stillGood.version).toBe("5.0.139");
		expect(stillGood.rating).toBe(4.9);
		expect(stillGood.stale).toBe(true);
	});

	it("merges fields per-field: a refresh missing the rating keeps the last-good rating", async () => {
		const { getStoreMetadata } = await loadLib();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET_RATED));
		await getStoreMetadata("android");

		jest.useFakeTimers().setSystemTime(Date.now() + 61 * MINUTE_MS);
		spy.mockResolvedValue(new Response(PLAY_SNIPPET)); // version only
		await getStoreMetadata("android");
		await flushBackgroundRefresh();

		jest.setSystemTime(Date.now() + MINUTE_MS);
		const meta = await getStoreMetadata("android");
		expect(meta.version).toBe("5.0.139");
		// The rating was not re-observed but is still inside its last-good window.
		expect(meta.rating).toBe(4.9);
		expect(meta.stale).toBe(true);
	});

	it("expires a field whose last-good observation outlives the retention window", async () => {
		const { getStoreMetadata } = await loadLib();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET_RATED));
		await getStoreMetadata("android");

		// Version is re-observed 23 h later without a rating.
		jest.useFakeTimers().setSystemTime(Date.now() + 23 * HOUR_MS);
		spy.mockResolvedValue(new Response(PLAY_SNIPPET));
		await getStoreMetadata("android");
		await flushBackgroundRefresh();

		// Two hours on: the version is still inside its 24 h window but the
		// rating's last-good observation has expired — the field drops out
		// instead of being served as if freshly verified.
		jest.setSystemTime(Date.now() + 2 * HOUR_MS);
		spy.mockResolvedValue(new Response(PLAY_SNIPPET));
		const meta = await getStoreMetadata("android");
		expect(meta.version).toBe("5.0.139");
		expect(meta.rating).toBeNull();
		expect(meta.stale).toBe(true);
	});

	it("dedupes concurrent cold-start requests into one upstream fetch", async () => {
		const { getStoreMetadata } = await loadLib();
		let resolveFetch: (response: Response) => void = () => {};
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				() =>
					new Promise<Response>((resolve) => {
						resolveFetch = resolve;
					}),
			);
		const pending = Promise.all([
			getStoreMetadata("android"),
			getStoreMetadata("android"),
			getStoreMetadata("android"),
		]);
		await flushBackgroundRefresh();
		expect(spy).toHaveBeenCalledTimes(1);
		resolveFetch(new Response(PLAY_SNIPPET_RATED));
		const results = await pending;
		for (const meta of results) {
			expect(meta.version).toBe("5.0.139");
			expect(meta.stale).toBe(false);
		}
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("backs off after failures instead of refetching once per request", async () => {
		const { getStoreMetadata } = await loadLib();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("down"));
		const first = await getStoreMetadata("android");
		expect(first.version).toBeNull();
		expect(first.stale).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);

		// Inside the failure backoff no new upstream attempt is made.
		await getStoreMetadata("android");
		expect(spy).toHaveBeenCalledTimes(1);

		jest.useFakeTimers().setSystemTime(Date.now() + 61 * 1000);
		await getStoreMetadata("android");
		await flushBackgroundRefresh();
		expect(spy).toHaveBeenCalledTimes(2);

		// A second consecutive failure doubles the backoff window.
		jest.setSystemTime(Date.now() + 61 * 1000);
		await getStoreMetadata("android");
		expect(spy).toHaveBeenCalledTimes(2);
		jest.setSystemTime(Date.now() + 61 * 1000);
		await getStoreMetadata("android");
		await flushBackgroundRefresh();
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it("answers within the downstream deadline on a cold start instead of awaiting the scrape", async () => {
		const { getStoreMetadata } = await loadLib();
		jest.useFakeTimers();
		jest
			.spyOn(globalThis, "fetch")
			.mockImplementation(() => new Promise<Response>(() => {})); // hangs
		const pending = getStoreMetadata("android");
		await jest.advanceTimersByTimeAsync(3_500); // Shields times out at 3.5 s
		const answered = await Promise.race([
			pending.then(() => true),
			Promise.resolve().then(() => false),
		]);
		expect(answered).toBe(true);
		const meta = await pending;
		expect(meta.version).toBeNull();
		expect(meta.stale).toBe(true);
	});

	it("reports the last attempt without pretending a failed one refreshed the data", async () => {
		const { getStoreMetadata } = await loadLib();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET_RATED));
		await getStoreMetadata("android");

		jest.useFakeTimers().setSystemTime(Date.now() + 61 * MINUTE_MS);
		spy.mockRejectedValue(new Error("down"));
		await getStoreMetadata("android");
		await flushBackgroundRefresh();
		const second = await getStoreMetadata("android");
		expect(second.fetchedAt).toBeTruthy();
		expect(second.attemptedAt).toBeTruthy();
		expect(Date.parse(second.attemptedAt ?? "")).toBeGreaterThanOrEqual(
			Date.parse(second.fetchedAt ?? ""),
		);
	});

	it("serves a still-fresh observation without refetching", async () => {
		const { getStoreMetadata } = await loadLib();
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET_RATED));
		await getStoreMetadata("android");
		const second = await getStoreMetadata("android");
		expect(second.stale).toBe(false);
		expect(second.version).toBe("5.0.139");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("seeds each snapshot field independently, including partial payloads", async () => {
		jest.resetModules();
		jest.doMock(
			"@/data/db/store-metadata-snapshot.generated.json",
			() => ({
				android: {
					platform: "android",
					version: null,
					rating: 4.9,
					ratingCount: null,
					source: "https://play.google.com/store/apps/details",
					sourceUpdatedAt: null,
					fetchedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
					stale: false,
				},
				windows: {
					platform: "windows",
					version: null,
					rating: null,
					ratingCount: null,
					source: "https://displaycatalog.mp.microsoft.com",
					sourceUpdatedAt: "2026-10-15T19:35:42.8391303Z",
					fetchedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
					stale: false,
				},
				ios: {
					platform: "ios",
					version: null,
					rating: null,
					ratingCount: 7,
					source: "https://itunes.apple.com/lookup",
					sourceUpdatedAt: null,
					fetchedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
					stale: false,
				},
			}),
		);
		const { getStoreMetadata } = await import("@/lib/store-metadata");
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));

		const android = await getStoreMetadata("android");
		expect(android.version).toBeNull();
		expect(android.rating).toBe(4.9);

		const windows = await getStoreMetadata("windows");
		expect(windows.version).toBeNull();
		expect(windows.sourceUpdatedAt).toBe("2026-10-15T19:35:42.8391303Z");

		const ios = await getStoreMetadata("ios");
		expect(ios.version).toBeNull();
		expect(ios.ratingCount).toBe(7);
	});

	it("ignores a snapshot entry whose fetchedAt is not a valid date", async () => {
		jest.resetModules();
		jest.doMock(
			"@/data/db/store-metadata-snapshot.generated.json",
			() => ({
				android: {
					platform: "android",
					version: "5.0.139",
					rating: null,
					ratingCount: null,
					source: "https://play.google.com/store/apps/details",
					sourceUpdatedAt: null,
					fetchedAt: "not-a-date",
					stale: false,
				},
			}),
		);
		const { getStoreMetadata } = await import("@/lib/store-metadata");
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		const meta = await getStoreMetadata("android");
		expect(meta.version).toBeNull();
		expect(meta.stale).toBe(true);
	});

	it("ignores a snapshot entry that carries no usable fields", async () => {
		jest.resetModules();
		jest.doMock(
			"@/data/db/store-metadata-snapshot.generated.json",
			() => ({
				windows: {
					platform: "windows",
					version: null,
					rating: null,
					ratingCount: null,
					source: "https://displaycatalog.mp.microsoft.com",
					sourceUpdatedAt: null,
					fetchedAt: new Date().toISOString(),
					stale: false,
				},
			}),
		);
		const { getStoreMetadata } = await import("@/lib/store-metadata");
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		const meta = await getStoreMetadata("windows");
		expect(meta.version).toBeNull();
		expect(meta.fetchedAt).toBeNull();
		expect(meta.stale).toBe(true);
	});

	it("seeds last-good from the build snapshot so a cold start has real data", async () => {
		jest.resetModules();
		jest.doMock(
			"@/data/db/store-metadata-snapshot.generated.json",
			() => ({
				android: {
					platform: "android",
					version: "5.0.139",
					rating: 4.9,
					ratingCount: null,
					ratingScale: 5,
					source: "https://play.google.com/store/apps/details",
					sourceUpdatedAt: null,
					fetchedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
					stale: false,
				},
			}),
		);
		const { getStoreMetadata } = await import("@/lib/store-metadata");
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		const meta = await getStoreMetadata("android");
		await flushBackgroundRefresh();
		expect(meta.version).toBe("5.0.139");
		expect(meta.rating).toBe(4.9);
		expect(meta.stale).toBe(true);
	});

	it("expires the build snapshot like any other last-good data", async () => {
		jest.resetModules();
		jest.doMock(
			"@/data/db/store-metadata-snapshot.generated.json",
			() => ({
				windows: {
					platform: "windows",
					version: "5.0.34.70",
					rating: null,
					ratingCount: null,
					ratingScale: 5,
					source: "https://displaycatalog.mp.microsoft.com",
					sourceUpdatedAt: null,
					fetchedAt: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
					stale: false,
				},
			}),
		);
		const { getStoreMetadata } = await import("@/lib/store-metadata");
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		const meta = await getStoreMetadata("windows");
		expect(meta.version).toBeNull();
		expect(meta.stale).toBe(true);
	});
});
