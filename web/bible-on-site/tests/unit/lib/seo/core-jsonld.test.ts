import type { PerekObj } from "../../../../src/data/perek-dto";
import type { Article } from "../../../../src/lib/articles";
import type { AuthorDetails } from "../../../../src/lib/authors";
import type { PerushDetail } from "../../../../src/lib/perushim";
import {
	AUTHORS_PATH,
	articlePath,
	authorPath,
	buildArticleGraph,
	buildAuthorGraph,
	buildAuthorsListGraph,
	buildPerekGraph,
	buildPerushGraph,
	parshanId,
	perekPath,
	perushPath,
	seferId,
	TANAH_ID,
} from "../../../../src/lib/seo/core-jsonld";
import { SITE_ORIGIN } from "../../../../src/lib/seo/jsonld";

type NodeMap = Record<string, unknown> & { "@type": string; "@id"?: string };

function perekObj(over: Partial<PerekObj> = {}): PerekObj {
	return {
		perekId: 1,
		perekHeb: "א",
		header: "בראשית",
		pesukim: [],
		helek: "תורה",
		sefer: "בראשית",
		source: "בראשית א",
		...over,
	};
}

function article(over: Partial<Article> = {}): Article {
	return {
		id: 42,
		perekId: 1,
		authorId: 7,
		abstract: "<p>תקציר המאמר.</p>",
		content: "<p>גוף המאמר המלא.</p>",
		name: "כותרת המאמר",
		priority: 1,
		authorName: "הרב פלוני",
		authorImageUrl: "https://cdn.example/authors/high-res/7.jpg",
		...over,
	};
}

function perushDetail(over: Partial<PerushDetail> = {}): PerushDetail {
	return {
		id: 3,
		name: 'רש"י',
		parshanName: "רבי שלמה יצחקי",
		parshanBirthYear: 1040,
		notes: [],
		...over,
	};
}

function authorDetails(over: Partial<AuthorDetails> = {}): AuthorDetails {
	return {
		id: 7,
		name: "הרב פלוני",
		details: "<p>קורות חייו של הרב.</p>",
		imageUrl: "https://cdn.example/authors/high-res/7.jpg",
		...over,
	};
}

function nodesOf(graph: { "@graph": unknown }): NodeMap[] {
	return graph["@graph"] as unknown as NodeMap[];
}

function nodeByType(graph: { "@graph": unknown }, type: string) {
	return nodesOf(graph).find((n) => n["@type"] === type);
}

describe("seo/core-jsonld", () => {
	describe("path + id helpers", () => {
		it("builds stable paths and URNs", () => {
			expect(perekPath(5)).toBe("/929/5");
			expect(articlePath(5, 42)).toBe("/929/5/42");
			expect(perushPath(5, 'רש"י')).toBe(
				`/929/5/${encodeURIComponent('רש"י')}`,
			);
			expect(authorPath("plony")).toBe("/929/authors/plony");
			expect(TANAH_ID).toBe("urn:bible-on-site:tanah");
			expect(seferId("בראשית")).toBe(
				`urn:bible-on-site:sefer:${encodeURIComponent("בראשית")}`,
			);
			expect(parshanId("רבי שלמה יצחקי")).toBe(
				`urn:bible-on-site:parshan:${encodeURIComponent("רבי שלמה יצחקי")}`,
			);
		});
	});

	describe("buildPerekGraph", () => {
		it("emits a Chapter in the Tanah → Sefer hierarchy + breadcrumb", () => {
			const graph = buildPerekGraph(perekObj());
			const chapter = nodeByType(graph, "Chapter");
			expect(chapter?.["@id"]).toBe(`${SITE_ORIGIN}/929/1#chapter`);
			expect(chapter?.isPartOf).toEqual({ "@id": seferId("בראשית") });
			const books = nodesOf(graph).filter((n) => n["@type"] === "Book");
			const tanah = books.find((b) => b["@id"] === TANAH_ID);
			const sefer = books.find((b) => b["@id"] === seferId("בראשית"));
			expect(tanah?.name).toBe('תנ"ך');
			expect(sefer?.isPartOf).toEqual({ "@id": TANAH_ID });
			expect(sefer?.genre).toBe("תורה");
			const page = nodeByType(graph, "WebPage");
			expect(page?.about).toEqual({ "@id": chapter?.["@id"] });
			const crumb = nodeByType(graph, "BreadcrumbList");
			const crumbs = crumb?.itemListElement as Array<{ name: string }>;
			expect(crumbs.map((c) => c.name)).toEqual(["בית", "בראשית א"]);
		});

		it("omits the sefer genre when there is no helek", () => {
			const graph = buildPerekGraph(perekObj({ helek: "" }));
			const sefer = nodesOf(graph).find(
				(n) => n["@type"] === "Book" && n["@id"] === seferId("בראשית"),
			);
			expect(sefer?.genre).toBeUndefined();
		});
	});

	describe("buildArticleGraph", () => {
		it("emits an Article with author Person, about Chapter, and description", () => {
			const graph = buildArticleGraph({
				article: article(),
				perekObj: perekObj(),
				authorSlug: "harav-ploni",
			});
			const node = nodeByType(graph, "Article");
			expect(node?.["@id"]).toBe(`${SITE_ORIGIN}/929/1/42#article`);
			expect(node?.headline).toBe("כותרת המאמר");
			expect(node?.about).toEqual({ "@id": `${SITE_ORIGIN}/929/1#chapter` });
			expect(node?.description).toBe("תקציר המאמר.");
			const person = nodeByType(graph, "Person");
			expect(person?.["@id"]).toBe(
				`${SITE_ORIGIN}/929/authors/harav-ploni#person`,
			);
			expect(person?.image).toBe("https://cdn.example/authors/high-res/7.jpg");
			expect(node?.author).toEqual({ "@id": person?.["@id"] });
		});

		it("omits description when the abstract and content are empty", () => {
			const graph = buildArticleGraph({
				article: article({ abstract: "<p></p>", content: "" }),
				perekObj: perekObj(),
				authorSlug: "harav-ploni",
			});
			expect(nodeByType(graph, "Article")?.description).toBeUndefined();
		});

		it("falls back to content for the description and omits image when absent", () => {
			const graph = buildArticleGraph({
				article: article({
					abstract: null,
					content: "<p>גוף בלבד.</p>",
					authorImageUrl: "",
				}),
				perekObj: perekObj(),
				authorSlug: "harav-ploni",
			});
			expect(nodeByType(graph, "Article")?.description).toBe("גוף בלבד.");
			expect(nodeByType(graph, "Person")?.image).toBeUndefined();
		});

		it("omits description when both abstract and content are null", () => {
			const graph = buildArticleGraph({
				article: article({ abstract: null, content: null }),
				perekObj: perekObj(),
				authorSlug: "harav-ploni",
			});
			expect(nodeByType(graph, "Article")?.description).toBeUndefined();
		});
	});

	describe("buildPerushGraph", () => {
		it("emits a commentary Article with the parshan Person + birthDate", () => {
			const graph = buildPerushGraph({
				perush: perushDetail(),
				perekObj: perekObj(),
			});
			const node = nodeByType(graph, "Article");
			expect(node?.headline).toBe('רש"י על בראשית א');
			expect(node?.author).toEqual({
				"@id": parshanId("רבי שלמה יצחקי"),
			});
			const person = nodeByType(graph, "Person");
			expect(person?.name).toBe("רבי שלמה יצחקי");
			expect(person?.birthDate).toBe("1040");
			expect(person?.sameAs).toBeUndefined();
		});

		it("attaches sameAs when external references are provided", () => {
			const graph = buildPerushGraph({
				perush: perushDetail(),
				perekObj: perekObj(),
				sameAs: ["https://www.wikidata.org/wiki/Q131338"],
			});
			expect(nodeByType(graph, "Person")?.sameAs).toEqual([
				"https://www.wikidata.org/wiki/Q131338",
			]);
		});
	});

	describe("buildAuthorGraph", () => {
		it("emits a ProfilePage with a Person mainEntity", () => {
			const graph = buildAuthorGraph({
				author: authorDetails(),
				slug: "harav-ploni",
			});
			const page = nodeByType(graph, "ProfilePage");
			const person = nodeByType(graph, "Person");
			expect(person?.["@id"]).toBe(
				`${SITE_ORIGIN}/929/authors/harav-ploni#person`,
			);
			expect(person?.description).toBe("קורות חייו של הרב.");
			expect(page?.mainEntity).toEqual({ "@id": person?.["@id"] });
			const crumb = nodeByType(graph, "BreadcrumbList");
			const crumbs = crumb?.itemListElement as Array<{ name: string }>;
			expect(crumbs.map((c) => c.name)).toEqual(["בית", "הרבנים", "הרב פלוני"]);
		});

		it("omits image and description when absent", () => {
			const graph = buildAuthorGraph({
				author: authorDetails({ imageUrl: "", details: "" }),
				slug: "harav-ploni",
			});
			const person = nodeByType(graph, "Person");
			expect(person?.image).toBeUndefined();
			expect(person?.description).toBeUndefined();
		});

		it("attaches sameAs when external references are provided", () => {
			const graph = buildAuthorGraph({
				author: authorDetails(),
				slug: "harav-ploni",
				sameAs: ["https://www.wikidata.org/wiki/Q1234"],
			});
			expect(nodeByType(graph, "Person")?.sameAs).toEqual([
				"https://www.wikidata.org/wiki/Q1234",
			]);
		});
	});

	describe("buildAuthorsListGraph", () => {
		it("emits a CollectionPage + ItemList of authors", () => {
			const graph = buildAuthorsListGraph({
				authors: [
					{ name: "הרב א", slug: "harav-a" },
					{ name: "הרב ב", slug: "harav-b" },
				],
			});
			const page = nodeByType(graph, "CollectionPage");
			expect(page?.["@id"]).toBe(`${SITE_ORIGIN}${AUTHORS_PATH}#webpage`);
			const list = nodeByType(graph, "ItemList");
			expect(list?.numberOfItems).toBe(2);
			const items = list?.itemListElement as Array<{
				position: number;
				url: string;
				name: string;
			}>;
			expect(items[1]).toMatchObject({
				position: 2,
				url: `${SITE_ORIGIN}/929/authors/harav-b`,
				name: "הרב ב",
			});
		});
	});
});
