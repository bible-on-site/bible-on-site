import {
	type AuthorArticleRow,
	DEFAULT_ARTICLE_SORT,
	distinctSefarim,
	filterAuthorArticles,
	sortAuthorArticles,
} from "../../../src/lib/authors/articles-grid";

const rows: AuthorArticleRow[] = [
	{
		id: 1,
		perekId: 1,
		name: "מאמר א",
		abstract: "על בראשית",
		sefer: "בראשית",
		source: "בראשית א",
	},
	{
		id: 2,
		perekId: 5,
		name: "מאמר ב",
		abstract: null,
		sefer: "בראשית",
		source: "בראשית ה",
	},
	{
		id: 3,
		perekId: 240,
		name: "גמח",
		abstract: "פרק גמח",
		sefer: "ישעיהו",
		source: "ישעיהו א",
	},
	{
		id: 4,
		perekId: 300,
		name: "מאמר ד",
		abstract: "",
		sefer: "תהילים",
		source: "תהילים א",
	},
];

describe("distinctSefarim", () => {
	it("returns sefarim in canonical order", () => {
		expect(distinctSefarim(rows)).toEqual(["בראשית", "ישעיהו", "תהילים"]);
	});

	it("deduplicates repeated sefarim", () => {
		expect(distinctSefarim(rows)).toHaveLength(3);
	});
});

describe("filterAuthorArticles", () => {
	it("returns all rows when search and sefer are empty", () => {
		expect(filterAuthorArticles(rows, "", "")).toHaveLength(4);
	});

	it("filters by sefer", () => {
		const result = filterAuthorArticles(rows, "", "בראשית");
		expect(result.map((r) => r.id)).toEqual([1, 2]);
	});

	it("searches by article name", () => {
		const result = filterAuthorArticles(rows, "מאמר ד", "");
		expect(result.map((r) => r.id)).toEqual([4]);
	});

	it("searches by abstract", () => {
		const result = filterAuthorArticles(rows, "גמח", "");
		expect(result.map((r) => r.id)).toEqual([3]);
	});

	it("matches visible abstract text but not HTML markup", () => {
		const htmlRows: AuthorArticleRow[] = [
			{ ...rows[0], abstract: "<h1>כותרת</h1><p>תוכן הכתבה</p>" },
		];
		expect(filterAuthorArticles(htmlRows, "תוכן", "")).toHaveLength(1);
		expect(filterAuthorArticles(htmlRows, "h1", "")).toHaveLength(0);
	});

	it("searches by source citation", () => {
		const result = filterAuthorArticles(rows, "תהילים א", "");
		expect(result.map((r) => r.id)).toEqual([4]);
	});

	it("combines sefer filter and search", () => {
		const result = filterAuthorArticles(rows, "מאמר", "בראשית");
		expect(result.map((r) => r.id)).toEqual([1, 2]);
	});

	it("returns empty when nothing matches", () => {
		expect(filterAuthorArticles(rows, "zzz", "")).toHaveLength(0);
	});
});

describe("sortAuthorArticles", () => {
	it("sorts by perek ascending by default", () => {
		const result = sortAuthorArticles(rows, DEFAULT_ARTICLE_SORT);
		expect(result.map((r) => r.perekId)).toEqual([1, 5, 240, 300]);
	});

	it("sorts by perek descending", () => {
		const result = sortAuthorArticles(rows, {
			key: "perek",
			direction: "desc",
		});
		expect(result.map((r) => r.perekId)).toEqual([300, 240, 5, 1]);
	});

	it("sorts by name with Hebrew collation", () => {
		const result = sortAuthorArticles(rows, { key: "name", direction: "asc" });
		expect(result.map((r) => r.name)).toEqual([
			"גמח",
			"מאמר א",
			"מאמר ב",
			"מאמר ד",
		]);
	});

	it("sorts by sefer in canonical order then perek", () => {
		const shuffled = [rows[3], rows[2], rows[1], rows[0]];
		const result = sortAuthorArticles(shuffled, {
			key: "sefer",
			direction: "asc",
		});
		expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4]);
	});

	it("does not mutate the input array", () => {
		const input = [...rows];
		sortAuthorArticles(input, { key: "perek", direction: "desc" });
		expect(input.map((r) => r.id)).toEqual([1, 2, 3, 4]);
	});
});
