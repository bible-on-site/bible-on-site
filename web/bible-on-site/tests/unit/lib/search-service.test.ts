/**
 * @jest-environment node
 */
jest.mock("@/lib/search/db-content", () => ({
	searchPerushNotes: jest.fn(),
	searchAuthors: jest.fn(),
	searchArticles: jest.fn(),
	perushHitReference: jest.fn(() => 'רש"י בראשית א א'),
}));

// Spied (not replaced) so individual tests can force a provider failure.
jest.mock("@/lib/search/corpus", () => {
	const actual = jest.requireActual<typeof import("@/lib/search/corpus")>(
		"@/lib/search/corpus",
	);
	return {
		...actual,
		searchPerakim: jest.fn(actual.searchPerakim),
		searchPesukim: jest.fn(actual.searchPesukim),
	};
});

import {
	searchPerakim,
	searchPesukim,
} from "@/lib/search/corpus";
import {
	searchArticles,
	searchAuthors,
	searchPerushNotes,
} from "@/lib/search/db-content";
import { searchSite } from "@/lib/search/service";
import { parseSearchTypes } from "@/lib/search/types";

const mockNotes = searchPerushNotes as jest.MockedFunction<
	typeof searchPerushNotes
>;
const mockAuthors = searchAuthors as jest.MockedFunction<typeof searchAuthors>;
const mockArticles = searchArticles as jest.MockedFunction<
	typeof searchArticles
>;
const mockPerakim = searchPerakim as jest.MockedFunction<typeof searchPerakim>;
const mockPesukim = searchPesukim as jest.MockedFunction<typeof searchPesukim>;
const actualCorpus = jest.requireActual<typeof import("@/lib/search/corpus")>(
	"@/lib/search/corpus",
);

describe("parseSearchTypes", () => {
	it("defaults to all types when the param is missing", () => {
		expect(parseSearchTypes(null)).toEqual([
			"perek",
			"pasuk",
			"perush",
			"author",
			"article",
		]);
		expect(parseSearchTypes(undefined)).toHaveLength(5);
	});

	it("parses csv and repeated params, dropping unknown values", () => {
		expect(parseSearchTypes("perek,pasuk")).toEqual(["perek", "pasuk"]);
		expect(parseSearchTypes(["perek", "author"])).toEqual(["perek", "author"]);
		expect(parseSearchTypes("perek,bogus")).toEqual(["perek"]);
		expect(parseSearchTypes("bogus")).toEqual([]);
	});

	it("dedupes", () => {
		expect(parseSearchTypes("perek,perek")).toEqual(["perek"]);
	});
});

describe("searchSite", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockNotes.mockResolvedValue([]);
		mockAuthors.mockResolvedValue([]);
		mockArticles.mockResolvedValue([]);
		mockPerakim.mockImplementation(actualCorpus.searchPerakim);
		mockPesukim.mockImplementation(actualCorpus.searchPesukim);
		jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("returns perakim and pesukim from the bundled corpus", async () => {
		const response = await searchSite("בראשית ברא", ["perek", "pasuk"]);
		const perek = response.results.find((item) => item.type === "perek");
		expect(perek?.title).toBe("בראשית א");
		expect(perek?.href).toBe("/929/1");
		const pasuk = response.results.find((item) => item.type === "pasuk");
		expect(pasuk?.href).toMatch(/^\/929\/\d+#pasuk-\d+$/);
		expect(pasuk?.snippetHtml).toContain("<mark>");
	});

	it("normalizes the query and echoes it back", async () => {
		const response = await searchSite('  בְּרֵאשִׁית  ', ["perek"]);
		expect(response.query).toBe("בראשית");
		expect(response.results[0]?.title).toBe("בראשית א");
	});

	it("returns empty results for a blank query without calling providers", async () => {
		const response = await searchSite("---", ["perush", "author", "article"]);
		expect(response.results).toHaveLength(0);
		expect(mockNotes).not.toHaveBeenCalled();
		expect(mockAuthors).not.toHaveBeenCalled();
		expect(mockArticles).not.toHaveBeenCalled();
	});

	it("rejects queries with too many terms", async () => {
		const response = await searchSite(
			Array.from({ length: 17 }, (_, i) => `מ${i}`).join(" "),
			["perek"],
		);
		expect(response.results).toHaveLength(0);
	});

	it("maps perush hits to canonical deep links", async () => {
		mockNotes.mockResolvedValue([
			{
				score: 90,
				entry: {
					perushId: 23,
					perushName: "רש\"י",
					perekId: 1,
					pasukNum: 1,
					noteContent: "טקסט",
					plain: "טקסט בראשית",
				},
			},
		]);
		const response = await searchSite("בראשית", ["perush"]);
		const perush = response.results[0];
		expect(perush.type).toBe("perush");
		expect(perush.href).toBe(
			`/929/1/${encodeURIComponent('רש"י')}?pasuk=1`,
		);
		expect(perush.title).toBe('רש"י בראשית א א');
	});

	it("maps author hits to author page links", async () => {
		mockAuthors.mockResolvedValue([
			{
				score: 180,
				entry: {
					id: 7,
					name: "הרב לוי",
					details: "רב ומחבר",
					slug: encodeURIComponent("הרב לוי"),
				},
			},
		]);
		const response = await searchSite("לוי", ["author"]);
		expect(response.results[0].href).toBe(
			`/929/authors/${encodeURIComponent("הרב לוי")}`,
		);
	});

	it("maps article hits to article page links with author in the title", async () => {
		mockArticles.mockResolvedValue([
			{
				score: 200,
				entry: {
					id: 42,
					perekId: 1,
					name: "מאמר על בראשית",
					authorName: "הרב לוי",
					plain: "תוכן על בראשית",
				},
			},
		]);
		const response = await searchSite("בראשית", ["article"]);
		expect(response.results[0].href).toBe("/929/1/42");
		expect(response.results[0].title).toBe("מאמר על בראשית - הרב לוי");
	});

	it("degrades a failing DB provider and reports availability", async () => {
		mockNotes.mockRejectedValue(new Error("db down"));
		const response = await searchSite("בראשית", ["perush", "perek"]);
		expect(response.results.some((item) => item.type === "perek")).toBe(true);
		expect(response.results.some((item) => item.type === "perush")).toBe(false);
		expect(response.availability).toContain("חיפוש הפירושים אינו זמין כרגע");
	});

	it("degrades when the perek provider throws", async () => {
		mockPerakim.mockImplementation(() => {
			throw new Error("corrupt index");
		});
		const response = await searchSite("בראשית", ["perek", "pasuk"]);
		expect(response.results.some((item) => item.type === "pasuk")).toBe(true);
		expect(response.availability).toContain("חיפוש הפרקים אינו זמין כרגע");
	});

	it("degrades when the pasuk provider throws", async () => {
		mockPesukim.mockImplementation(() => {
			throw new Error("corrupt index");
		});
		const response = await searchSite("בראשית", ["perek", "pasuk"]);
		expect(response.results.some((item) => item.type === "perek")).toBe(true);
		expect(response.availability).toContain("חיפוש הפסוקים אינו זמין כרגע");
	});

	it("degrades a failing author provider, including non-Error rejections", async () => {
		mockAuthors.mockRejectedValue("plain failure");
		const response = await searchSite("לוי", ["author", "article"]);
		expect(response.availability).toContain("חיפוש הרבנים אינו זמין כרגע");
	});

	it("degrades a failing article provider", async () => {
		mockArticles.mockRejectedValue(new Error("db down"));
		const response = await searchSite("בראשית", ["article", "perek"]);
		expect(response.results.some((item) => item.type === "perek")).toBe(true);
		expect(response.availability).toContain("חיפוש המאמרים אינו זמין כרגע");
	});

	it("honors the limit per type", async () => {
		const response = await searchSite("את", ["pasuk"], { limit: 3 });
		expect(response.counts.pasuk).toBeLessThanOrEqual(3);
	});
});
