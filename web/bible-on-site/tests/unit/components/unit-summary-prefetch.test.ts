/**
 * @jest-environment node
 *
 * The sefer-book batch loader primes the flat unit pages' per-unit cache
 * entries (unit-summary-prefetch): a book fetch over N units resolves
 * summaries with two grouped queries, and each unit's first flat-page
 * render reuses that result instead of re-querying — without the
 * per-unit fan-out the grouped queries replaced.
 */

jest.mock("next/cache", () => ({
	unstable_cache: (fn: unknown) => fn,
}));

jest.mock("../../../src/lib/perushim", () => ({
	getPerushimForRanges: jest.fn(),
	getPerushimForRangeGroups: jest.fn(),
	getPerushNotesForRanges: jest.fn(),
}));

jest.mock("../../../src/lib/articles/service", () => ({
	getArticleSummariesForRanges: jest.fn(),
	getArticleSummariesForRangeGroups: jest.fn(),
}));

import { getUnitScopeSummariesBatch } from "../../../src/app/components/reading/unit-book-actions";
import {
	getMasoraRangeArticles,
	getMasoraRangePerushim,
	getParashaRangeArticles,
	getParashaRangePerushim,
} from "../../../src/app/components/reading/unit-range-summaries";
import {
	type UnitSummaryPair,
	clearUnitSummaryPrefetch,
	primeUnitSummaries,
	takeUnitSummaryPrefetch,
} from "../../../src/app/components/reading/unit-summary-prefetch";
import {
	getArticleSummariesForRangeGroups,
	getArticleSummariesForRanges,
} from "../../../src/lib/articles/service";
import {
	getPerushimForRangeGroups,
	getPerushimForRanges,
} from "../../../src/lib/perushim";

const mockGetPerushimForRanges = getPerushimForRanges as jest.MockedFunction<
	typeof getPerushimForRanges
>;
const mockGetPerushimForRangeGroups =
	getPerushimForRangeGroups as jest.MockedFunction<
		typeof getPerushimForRangeGroups
	>;
const mockGetArticleSummariesForRanges =
	getArticleSummariesForRanges as jest.MockedFunction<
		typeof getArticleSummariesForRanges
	>;
const mockGetArticleSummariesForRangeGroups =
	getArticleSummariesForRangeGroups as jest.MockedFunction<
		typeof getArticleSummariesForRangeGroups
	>;

const storeKey = Symbol.for("bible-on-site.unit-summary-prefetch");

const article = { id: 7, name: "מאמר" };
const perush = { id: 38, name: 'רש"י' };
const pair: UnitSummaryPair = {
	articles: [article] as never,
	perushim: [perush] as never,
};

describe("unit summary prefetch", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, "warn").mockImplementation(() => {});
		Reflect.deleteProperty(globalThis, storeKey);
		mockGetArticleSummariesForRangeGroups.mockImplementation(async (groups) =>
			groups.map(() => []),
		);
		mockGetPerushimForRangeGroups.mockImplementation(async (groups) =>
			groups.map(() => []),
		);
		mockGetArticleSummariesForRanges.mockResolvedValue([]);
		mockGetPerushimForRanges.mockResolvedValue([]);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("primeUnitSummaries + takeUnitSummaryPrefetch", () => {
		it("returns each kind once and drops the entry after both are consumed", () => {
			primeUnitSummaries("parasha", "torah", [5], { "5": pair });

			expect(takeUnitSummaryPrefetch("parasha:5:torah", "articles")).toEqual([
				article,
			]);
			expect(takeUnitSummaryPrefetch("parasha:5:torah", "perushim")).toEqual([
				perush,
			]);
			expect(
				takeUnitSummaryPrefetch("parasha:5:torah", "articles"),
			).toBeUndefined();
		});

		it("keeps the entry for the other kind after a single consume", () => {
			primeUnitSummaries("masora", "torah", [8], { "8": pair });

			expect(takeUnitSummaryPrefetch("masora:8", "articles")).toEqual([
				article,
			]);
			expect(takeUnitSummaryPrefetch("masora:8", "perushim")).toEqual([perush]);
		});

		it("returns undefined for unprimed keys and other scopes", () => {
			primeUnitSummaries("parasha", "haftara", [1], { "1": pair });

			expect(
				takeUnitSummaryPrefetch("parasha:1:torah", "articles"),
			).toBeUndefined();
			expect(
				takeUnitSummaryPrefetch("parasha:2:haftara", "articles"),
			).toBeUndefined();
			expect(takeUnitSummaryPrefetch("masora:1", "articles")).toBeUndefined();
		});

		it("clearUnitSummaryPrefetch drops every primed entry", () => {
			primeUnitSummaries("parasha", "torah", [5], { "5": pair });
			primeUnitSummaries("masora", "torah", [8], { "8": pair });

			clearUnitSummaryPrefetch();

			expect(
				takeUnitSummaryPrefetch("parasha:5:torah", "articles"),
			).toBeUndefined();
			expect(takeUnitSummaryPrefetch("masora:8", "perushim")).toBeUndefined();
		});

		it("expires entries after the TTL", () => {
			primeUnitSummaries("parasha", "torah", [5], { "5": pair });
			const now = jest
				.spyOn(Date, "now")
				.mockReturnValue(Date.now() + 3 * 60 * 1000);

			expect(
				takeUnitSummaryPrefetch("parasha:5:torah", "articles"),
			).toBeUndefined();
			expect(
				takeUnitSummaryPrefetch("parasha:5:torah", "perushim"),
			).toBeUndefined();
			now.mockRestore();
		});

		it("sweeps expired entries on the next prime", () => {
			primeUnitSummaries("parasha", "torah", [5], { "5": pair });
			const now = jest
				.spyOn(Date, "now")
				.mockReturnValue(Date.now() + 3 * 60 * 1000);
			primeUnitSummaries("parasha", "torah", [6], { "6": pair });
			now.mockRestore();

			expect(
				takeUnitSummaryPrefetch("parasha:5:torah", "articles"),
			).toBeUndefined();
			expect(takeUnitSummaryPrefetch("parasha:6:torah", "articles")).toEqual([
				article,
			]);
		});

		it("never primes divisions or scopes without a flat loader", () => {
			primeUnitSummaries("perek", "torah", [1], { "1": pair });
			primeUnitSummaries("masora", "haftara", [8], { "8": pair });

			expect(takeUnitSummaryPrefetch("masora:8", "articles")).toBeUndefined();
			expect(
				takeUnitSummaryPrefetch("parasha:1:torah", "articles"),
			).toBeUndefined();
		});

		it("skips units missing from the summaries record", () => {
			primeUnitSummaries("parasha", "torah", [5, 6], { "5": pair });

			expect(takeUnitSummaryPrefetch("parasha:5:torah", "articles")).toEqual([
				article,
			]);
			expect(
				takeUnitSummaryPrefetch("parasha:6:torah", "articles"),
			).toBeUndefined();
		});
	});

	describe("book fetch warms flat-page loaders", () => {
		it("a masora batch serves both flat loaders without re-querying", async () => {
			mockGetArticleSummariesForRangeGroups.mockResolvedValue([
				[article],
			] as never);
			mockGetPerushimForRangeGroups.mockResolvedValue([[perush]] as never);

			await getUnitScopeSummariesBatch("masora", [8], "torah");

			expect(await getMasoraRangeArticles(8)).toEqual([article]);
			expect(await getMasoraRangePerushim(8)).toEqual([perush]);
			expect(mockGetArticleSummariesForRanges).not.toHaveBeenCalled();
			expect(mockGetPerushimForRanges).not.toHaveBeenCalled();
		});

		it("a parasha haftara batch warms only the haftara scope", async () => {
			mockGetArticleSummariesForRangeGroups.mockResolvedValue([
				[article],
			] as never);
			mockGetPerushimForRangeGroups.mockResolvedValue([[perush]] as never);
			const torahArticles = [{ id: 9, name: "תורה" }];
			mockGetArticleSummariesForRanges.mockResolvedValue(
				torahArticles as never,
			);

			await getUnitScopeSummariesBatch("parasha", [1], "haftara");

			expect(await getParashaRangeArticles(1, "haftara")).toEqual([article]);
			expect(await getParashaRangePerushim(1, "haftara")).toEqual([perush]);
			// The torah scope was never primed — its loader still queries.
			expect(await getParashaRangeArticles(1, "torah")).toEqual(torahArticles);
			expect(mockGetArticleSummariesForRanges).toHaveBeenCalledTimes(1);
			expect(mockGetPerushimForRanges).not.toHaveBeenCalled();
		});

		it("a failed batch primes nothing — flat loaders still query", async () => {
			mockGetArticleSummariesForRangeGroups.mockRejectedValue(
				new Error("DB down"),
			);

			const result = await getUnitScopeSummariesBatch("masora", [8], "torah");
			expect(result["8"]).toEqual({ articles: [], perushim: [] });

			mockGetArticleSummariesForRanges.mockResolvedValue([article] as never);
			expect(await getMasoraRangeArticles(8)).toEqual([article]);
			expect(mockGetArticleSummariesForRanges).toHaveBeenCalledTimes(1);
		});

		it("primed entries are single-use — a second flat render re-queries", async () => {
			mockGetArticleSummariesForRangeGroups.mockResolvedValue([
				[article],
			] as never);
			mockGetPerushimForRangeGroups.mockResolvedValue([[perush]] as never);
			const fresh = [{ id: 10, name: "טרי" }];
			mockGetArticleSummariesForRanges.mockResolvedValue(fresh as never);

			await getUnitScopeSummariesBatch("masora", [8], "torah");
			expect(await getMasoraRangeArticles(8)).toEqual([article]);
			// unstable_cache is the identity mock here, so the loader re-runs
			// and must fall through to its own query once the entry is spent.
			expect(await getMasoraRangeArticles(8)).toEqual(fresh);
			expect(mockGetArticleSummariesForRanges).toHaveBeenCalledTimes(1);
		});
	});
});
