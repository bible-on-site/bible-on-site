/**
 * @jest-environment node
 */
// Module-level state (last-good observations, refresh backoff) is per module
// instance; reset it per test so cases stay deterministic. The pure parsers
// come from the same fresh instance so coverage counts each test's hits.
let getStoreMetadata: typeof import("@/lib/store-metadata").getStoreMetadata;
let parseItunesLookup: typeof import("@/lib/store-metadata").parseItunesLookup;
let parsePlayStoreHtml: typeof import("@/lib/store-metadata").parsePlayStoreHtml;
let parseWindowsCatalog: typeof import("@/lib/store-metadata").parseWindowsCatalog;
beforeEach(async () => {
	jest.resetModules();
	({
		getStoreMetadata,
		parseItunesLookup,
		parsePlayStoreHtml,
		parseWindowsCatalog,
	} = await import("@/lib/store-metadata"));
});

const PLAY_SNIPPET =
	'prefix "141":[[["5.0.139"]],[[[36]],[[[23,"6.0"]]]]] suffix';

describe("parsePlayStoreHtml", () => {
	it("extracts the published version from the 141 details key", () => {
		expect(parsePlayStoreHtml(PLAY_SNIPPET).version).toBe("5.0.139");
	});
	it("returns null version when the anchor is absent or malformed", () => {
		expect(parsePlayStoreHtml("<html></html>").version).toBeNull();
		expect(parsePlayStoreHtml('"141":[[["latest"]]]').version).toBeNull();
	});
	it("extracts a rating only when one is published", () => {
		expect(
			parsePlayStoreHtml(`${PLAY_SNIPPET}aria-label="Rated 4.7 stars"`).rating,
		).toBe(4.7);
		expect(
			parsePlayStoreHtml(
				`${PLAY_SNIPPET}aria-label="Rated 4.9 stars out of five stars"`,
			).rating,
		).toBe(4.9);
		expect(parsePlayStoreHtml(PLAY_SNIPPET).rating).toBeNull();
	});
});

describe("parseWindowsCatalog", () => {
	const SKU_WITH_PACKAGES = {
		Sku: {
			Properties: {
				Packages: [
					{ Version: "1407374885781504" }, // 5.0.34.0 packed
					{ Version: "1407374885781574" }, // 5.0.34.70 packed
				],
			},
		},
	};

	it("decodes the published package version from packed integers", () => {
		const parsed = parseWindowsCatalog({
			Product: {
				LastModifiedDate: "2026-10-15T19:35:42.8391303Z",
				DisplaySkuAvailabilities: [SKU_WITH_PACKAGES],
			},
		});
		expect(parsed.version).toBe("5.0.34.70");
		expect(parsed.sourceUpdatedAt).toBe("2026-10-15T19:35:42.8391303Z");
	});
	it("picks the highest package version regardless of order", () => {
		const parsed = parseWindowsCatalog({
			Product: {
				DisplaySkuAvailabilities: [
					{
						Sku: {
							Properties: {
								Packages: [
									{ Version: "1407374885781574" },
									{ Version: "1407374885781504" },
								],
							},
						},
					},
				],
			},
		});
		expect(parsed.version).toBe("5.0.34.70");
	});
	it("returns nulls when the catalog omits packages", () => {
		const parsed = parseWindowsCatalog({ Product: {} });
		expect(parsed.version).toBeNull();
		expect(parsed.sourceUpdatedAt).toBeNull();
	});
	it("returns nulls when skus or the product itself are absent", () => {
		expect(
			parseWindowsCatalog({
				Product: { DisplaySkuAvailabilities: [{}, { Sku: {} }] },
			}).version,
		).toBeNull();
		expect(parseWindowsCatalog({}).version).toBeNull();
		expect(
			parseWindowsCatalog({
				Product: {
					DisplaySkuAvailabilities: [
						{ Sku: { Properties: { Packages: [{ Version: 12 }] } } },
					],
				},
			}).version,
		).toBeNull();
	});
	it("ignores malformed package versions", () => {
		const parsed = parseWindowsCatalog({
			Product: {
				DisplaySkuAvailabilities: [
					{ Sku: { Properties: { Packages: [{ Version: "abc" }] } } },
				],
			},
		});
		expect(parsed.version).toBeNull();
	});
	it("keeps the highest packed version when malformed entries are mixed in", () => {
		const parsed = parseWindowsCatalog({
			Product: {
				DisplaySkuAvailabilities: [
					{
						Sku: {
							Properties: {
								Packages: [
									{ Version: "abc" },
									{ Version: "1407374885781504" },
									{ Version: 7 },
									{ Version: "1407374885781574" },
								],
							},
						},
					},
				],
			},
		});
		expect(parsed.version).toBe("5.0.34.70");
	});
});

describe("parseItunesLookup", () => {
	it("maps version, rating, and count from results[0]", () => {
		expect(
			parseItunesLookup({
				results: [
					{
						version: "5.0.180",
						averageUserRating: 4.8,
						userRatingCount: 123,
					},
				],
			}),
		).toEqual({ version: "5.0.180", rating: 4.8, ratingCount: 123 });
	});
	it("returns nulls for an empty result set", () => {
		expect(parseItunesLookup({ results: [] })).toEqual({
			version: null,
			rating: null,
			ratingCount: null,
		});
	});
	it("keeps nulls for fields that are present but mistyped", () => {
		expect(
			parseItunesLookup({
				results: [
					{
						version: "5.0.180",
						averageUserRating: "4.8",
						userRatingCount: "123",
					},
				],
			}),
		).toEqual({ version: "5.0.180", rating: null, ratingCount: null });
	});
});

describe("getStoreMetadata", () => {
	afterEach(() => jest.restoreAllMocks());

	it.each([
		["android", "play.google.com"],
		["windows", "displaycatalog"],
		["ios", "itunes.apple.com"],
	] as const)(
		"returns stale nulls for %s when the store answers !ok",
		async (platform, sourceFragment) => {
			jest
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response("upstream", { status: 503 }));
			const meta = await getStoreMetadata(platform);
			expect(meta.platform).toBe(platform);
			expect(meta.fetchedAt).toBeNull();
			expect(meta.stale).toBe(true);
			expect(meta.version).toBeNull();
			expect(meta.source).toContain(sourceFragment);
		},
	);

	it("reports the android version and a non-stale fresh fetch", async () => {
		const spy = jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET));
		const meta = await getStoreMetadata("android");
		expect(meta.platform).toBe("android");
		expect(meta.version).toBe("5.0.139");
		expect(meta.ratingScale).toBe(5);
		expect(meta.stale).toBe(false);
		expect(meta.fetchedAt).toBeTruthy();
		// The rating is only published for the IL market listing.
		expect(String(spy.mock.calls[0][0])).toContain("gl=IL");
	});

	it("never fabricates: failed upstream yields nulls marked stale", async () => {
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		const meta = await getStoreMetadata("windows");
		expect(meta.fetchedAt).toBeNull();
		expect(meta.stale).toBe(true);
		expect(meta.version).toBeNull();
		expect(meta.rating).toBeNull();
		expect(meta.ratingCount).toBeNull();
		expect(meta.source).toContain("displaycatalog");
	});

	it("serves the last good value stale when a refresh fails", async () => {
		jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET));
		await getStoreMetadata("android");
		jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
		// Past the 1 h fresh window but inside the 24 h last-good retention.
		jest.useFakeTimers().setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
		const meta = await getStoreMetadata("android");
		jest.useRealTimers();
		expect(meta.version).toBe("5.0.139");
		expect(meta.stale).toBe(true);
	});
});

describe("store-metadata route and remaining platforms", () => {
	afterEach(() => jest.restoreAllMocks());

	it("ios maps itunes fields with scale and source", async () => {
		jest.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{
							version: "5.0.180",
							averageUserRating: 4.8,
							userRatingCount: 123,
						},
					],
				}),
			),
		);
		const meta = await getStoreMetadata("ios");
		expect(meta.platform).toBe("ios");
		expect(meta.version).toBe("5.0.180");
		expect(meta.rating).toBe(4.8);
		expect(meta.ratingCount).toBe(123);
		expect(meta.stale).toBe(false);
	});

	it("windows reports the published version and keeps fetchedAt as fetch time", async () => {
		jest.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					Product: {
						LastModifiedDate: "2026-10-15T19:35:42.8391303Z",
						DisplaySkuAvailabilities: [
							{
								Sku: {
									Properties: {
										Packages: [
											{ Version: "1407374885781504" },
											{ Version: "1407374885781574" },
										],
									},
								},
							},
						],
					},
				}),
			),
		);
		const meta = await getStoreMetadata("windows");
		expect(meta.platform).toBe("windows");
		expect(meta.version).toBe("5.0.34.70");
		expect(meta.rating).toBeNull();
		expect(meta.sourceUpdatedAt).toBe("2026-10-15T19:35:42.8391303Z");
		// fetchedAt is the observation time, not the catalog timestamp.
		expect(Date.parse(meta.fetchedAt ?? "")).toBeGreaterThan(
			Date.parse("2026-10-19T00:00:00Z"),
		);
		expect(meta.stale).toBe(false);
	});

	it("windows answer carrying no usable fields records an attempt, not an observation", async () => {
		jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify({ Product: {} })));
		const meta = await getStoreMetadata("windows");
		// The attempt is recorded, but no field was observed, so fetchedAt
		// stays null rather than stamping a fresh-looking fetch time (#2395).
		expect(meta.attemptedAt).toBeTruthy();
		expect(meta.fetchedAt).toBeNull();
		expect(meta.sourceUpdatedAt).toBeNull();
		expect(meta.stale).toBe(true);
	});
});
