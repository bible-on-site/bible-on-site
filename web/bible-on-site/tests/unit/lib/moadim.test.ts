/**
 * @jest-environment node
 *
 * מועדים על הפרק reads (#3101): the published catalogue, ordered
 * sections/ranges on the detail, and the article union — range matches
 * merged with explicit article↔moed links, deduplicated and in
 * deterministic order. The schema-missing degradation keeps the site
 * shipping before Data CD deploys the tables.
 */
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

jest.mock("../../../src/lib/articles/service", () => ({
	getArticleSummariesForRanges: jest.fn(),
}));

jest.mock("../../../src/lib/authors/service", () => ({
	getAuthorImageUrl: jest.fn(
		(authorId: number) => `https://img.test/authors/${authorId}.jpg`,
	),
}));

jest.mock("../../../src/lib/reading-metrics", () => ({
	getArticleMetrics: jest.fn(async () => new Map()),
	metricOrFallback: jest.fn(
		async (
			_label: string,
			_fallback: unknown,
			loader: () => Promise<unknown>,
		) => loader(),
	),
}));

import { query } from "../../../src/lib/api-client";
import { getArticleSummariesForRanges } from "../../../src/lib/articles/service";
import { getArticleMetrics } from "../../../src/lib/reading-metrics";
import type { ArticleSummary } from "../../../src/lib/articles/types";
import {
	getMoedArticleSummaries,
	getMoedBySlug,
	getPublishedMoadim,
	getPublishedMoedSlugs,
} from "../../../src/lib/moadim";
import type { ScriptureRange } from "../../../src/lib/reading/contract";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockRangeArticles = getArticleSummariesForRanges as jest.MockedFunction<
	typeof getArticleSummariesForRanges
>;
const mockGetMetrics = getArticleMetrics as jest.MockedFunction<
	typeof getArticleMetrics
>;

const MOED_ROW = {
	id: 3,
	slug: "פסח",
	name: "פסח",
	summary: "מועד חרותנו",
	hebrew_month: "ניסן",
	date_label: "ט\"ו בניסן",
	annual_order: 1,
};

/** Dispatch the service's reads by SQL shape. */
function stubDb(handlers: {
	moadim?: Record<string, unknown>[];
	moedRow?: Record<string, unknown> | null;
	sections?: { id: number; label: string; position: number }[];
	ranges?: {
		section_id: number;
		position: number;
		perek_id_start: number;
		pasuk_start: number;
		perek_id_end: number;
		pasuk_end: number;
	}[];
	linkedArticles?: Record<string, unknown>[];
}) {
	mockQuery.mockImplementation(async (sql: string) => {
		if (/FROM tanah_moed\s+WHERE published/.test(sql))
			return handlers.moadim ?? [];
		if (/FROM tanah_moed\s+WHERE slug/.test(sql))
			return handlers.moedRow ? [handlers.moedRow] : [];
		if (/FROM tanah_moed_section/.test(sql)) return handlers.sections ?? [];
		if (/FROM tanah_moed_range/.test(sql)) return handlers.ranges ?? [];
		if (/FROM tanah_article_moed/.test(sql))
			return handlers.linkedArticles ?? [];
		throw new Error(`unstubbed SQL: ${sql}`);
	});
}

const article = (id: number, extra: Partial<ArticleSummary> = {}) =>
	({
		id,
		perekId: 1,
		authorId: 1,
		abstract: null,
		name: `מאמר ${id}`,
		priority: 1,
		authorName: "מחבר",
		authorImageUrl: "x",
		...extra,
	}) as ArticleSummary;

describe("moadim service", () => {
	beforeEach(() => jest.clearAllMocks());

	it("lists the published catalogue in annual order", async () => {
		stubDb({ moadim: [MOED_ROW, { ...MOED_ROW, id: 4, slug: "שבועות", name: "שבועות", annual_order: 2 }] });
		const moadim = await getPublishedMoadim();
		expect(moadim.map((m) => m.slug)).toEqual(["פסח", "שבועות"]);
		expect(moadim[0]).toMatchObject({
			hebrewMonth: "ניסן",
			dateLabel: "ט\"ו בניסן",
			annualOrder: 1,
		});
		expect(mockQuery.mock.calls[0][0]).toContain("published = TRUE");
	});

	it("returns an empty catalogue while the moed schema is missing", async () => {
		const error = Object.assign(new Error("Table 'tanah_moed' doesn't exist"), {
			code: "ER_NO_SUCH_TABLE",
		});
		mockQuery.mockRejectedValue(error);
		expect(await getPublishedMoadim()).toEqual([]);
		expect(await getPublishedMoedSlugs()).toEqual([]);
	});

	it("assembles a detail with ordered sections and their ranges", async () => {
		stubDb({
			moedRow: MOED_ROW,
			sections: [
				{ id: 10, label: "קריאה ראשונה", position: 1 },
				{ id: 11, label: "קריאה שנייה", position: 2 },
			],
			ranges: [
				{
					section_id: 11,
					position: 1,
					perek_id_start: 20,
					pasuk_start: 1,
					perek_id_end: 20,
					pasuk_end: 8,
				},
				{
					section_id: 10,
					position: 1,
					perek_id_start: 12,
					pasuk_start: 15,
					perek_id_end: 13,
					pasuk_end: 2,
				},
			],
		});
		const moed = await getMoedBySlug("פסח");
		expect(moed?.sections.map((s) => s.label)).toEqual([
			"קריאה ראשונה",
			"קריאה שנייה",
		]);
		// Cross-perek coordinates survive as an inclusive ScriptureRange —
		// no parent sefer is fabricated for a cross-sefer reading.
		expect(moed?.sections[0].ranges).toEqual([
			{
				start: { perekId: 12, pasuk: 15 },
				end: { perekId: 13, pasuk: 2 },
			},
		]);
		expect(moed?.ranges).toHaveLength(2);
	});

	it("returns null for an unknown or unpublished slug", async () => {
		stubDb({ moedRow: null });
		expect(await getMoedBySlug("לא-קיים")).toBeNull();
		expect(mockQuery.mock.calls[0][0]).toContain("published = TRUE");
	});

	it("unions range matches with explicit links, deduplicated", async () => {
		const ranges: ScriptureRange[] = [
			{ start: { perekId: 1, pasuk: 1 }, end: { perekId: 1, pasuk: 5 } },
		];
		mockRangeArticles.mockResolvedValue([article(1), article(2)]);
		stubDb({
			linkedArticles: [
				// id 2 already matched by range — lists exactly once.
				{ id: 2, perek_id: 1, author_id: 1, abstract: null, name: "מאמר 2", priority: 1, author_name: "מחבר" },
				{ id: 9, perek_id: 30, author_id: 5, abstract: null, name: "מאמר 9", priority: 1, author_name: "אחר" },
				{ id: 8, perek_id: 30, author_id: 5, abstract: null, name: "מאמר 8", priority: 2, author_name: "אחר" },
			],
		});
		const articles = await getMoedArticleSummaries(3, ranges);
		expect(articles.map((a) => a.id)).toEqual([1, 2, 9, 8]);
		expect(articles[2].authorName).toBe("אחר");
	});

	it("serves a detail with no sections and skips the range join", async () => {
		stubDb({ moedRow: MOED_ROW, sections: [] });
		const moed = await getMoedBySlug("פסח");
		expect(moed?.sections).toEqual([]);
		expect(moed?.ranges).toEqual([]);
		expect(
			mockQuery.mock.calls.some(([sql]) =>
				/FROM tanah_moed_range/.test(sql),
			),
		).toBe(false);
	});

	it("keeps a section empty when the range join returns none of its rows", async () => {
		stubDb({
			moedRow: MOED_ROW,
			sections: [{ id: 10, label: "קריאה", position: 1 }],
			ranges: [
				{
					section_id: 99,
					position: 1,
					perek_id_start: 1,
					pasuk_start: 1,
					perek_id_end: 1,
					pasuk_end: 5,
				},
			],
		});
		const moed = await getMoedBySlug("פסח");
		expect(moed?.sections).toEqual([
			{ id: 10, label: "קריאה", ranges: [] },
		]);
	});

	it("answers null while the moed schema is missing and propagates other errors", async () => {
		const missing = Object.assign(new Error("no table"), {
			code: "ER_NO_SUCH_TABLE",
		});
		mockQuery.mockRejectedValue(missing);
		expect(await getMoedBySlug("פסח")).toBeNull();

		mockQuery.mockRejectedValue(new Error("connection lost"));
		await expect(getPublishedMoadim()).rejects.toThrow("connection lost");
		await expect(getMoedBySlug("פסח")).rejects.toThrow("connection lost");
	});

	it("decorates explicit-only articles with stored reading metrics", async () => {
		mockRangeArticles.mockResolvedValue([]);
		mockGetMetrics.mockResolvedValueOnce(
			new Map([[9, { wordCount: 1200, estimatedSeconds: 327 }]]),
		);
		stubDb({
			linkedArticles: [
				{
					id: 9,
					perek_id: 30,
					author_id: 5,
					abstract: null,
					name: "מאמר 9",
					priority: 1,
					author_name: "אחר",
				},
			],
		});
		const articles = await getMoedArticleSummaries(3, []);
		expect(articles).toHaveLength(1);
		expect(articles[0].metric).toEqual({
			wordCount: 1200,
			estimatedSeconds: 327,
		});
	});
});
