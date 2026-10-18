/**
 * @jest-environment node
 */
import {
	getStoreMetadata,
	parseItunesLookup,
	parsePlayStoreHtml,
} from "@/lib/store-metadata";

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
			parsePlayStoreHtml(PLAY_SNIPPET + 'aria-label="Rated 4.7 stars"').rating,
		).toBe(4.7);
		expect(parsePlayStoreHtml(PLAY_SNIPPET).rating).toBeNull();
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
		jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(PLAY_SNIPPET));
		const meta = await getStoreMetadata("android");
		expect(meta.platform).toBe("android");
		expect(meta.version).toBe("5.0.139");
		expect(meta.ratingScale).toBe(5);
		expect(meta.stale).toBe(false);
		expect(meta.fetchedAt).toBeTruthy();
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
		jest.useFakeTimers().setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
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

	it("windows reports catalog reachability with honest nulls", async () => {
		jest.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					Product: { LastModifiedDate: "2026-10-15T00:00:00Z" },
				}),
			),
		);
		const meta = await getStoreMetadata("windows");
		expect(meta.platform).toBe("windows");
		expect(meta.version).toBeNull();
		expect(meta.rating).toBeNull();
		expect(meta.fetchedAt).toBe("2026-10-15T00:00:00Z");
		expect(meta.stale).toBe(false);
	});

	it("windows without a product timestamp stamps the fetch time", async () => {
		jest
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify({ Product: {} })));
		const meta = await getStoreMetadata("windows");
		expect(meta.fetchedAt).toBeTruthy();
	});
});
