jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
	revalidateTag: jest.fn(),
	revalidatePath: jest.fn(),
}));

const mockArticlesByPerek = jest.fn();
const mockPerushimByPerek = jest.fn();
const mockArticleById = jest.fn();
const mockPerushDetail = jest.fn();
const mockAuthorSlugs = jest.fn();
const mockAuthorByName = jest.fn();
const mockArticlesByAuthor = jest.fn();
const mockPublishedMoadim = jest.fn();
const mockMoedBySlug = jest.fn();
const mockMoedArticles = jest.fn();
const mockMoedPerushim = jest.fn();
const mockParashaArticles = jest.fn();
const mockParashaPerushim = jest.fn();
const mockMasoraArticles = jest.fn();
const mockMasoraPerushim = jest.fn();
const mockEntryByUniqueName = jest.fn();
const mockEntryOccurrences = jest.fn();
const mockResolveSynonym = jest.fn();
const mockEntitiesWithEntries = jest.fn();
const mockParashaEntry = jest.fn();

jest.mock("@/lib/articles/service", () => ({
	getArticleById: (...args: unknown[]) => mockArticleById(...args),
	getArticleSummariesByPerekId: (...args: unknown[]) =>
		mockArticlesByPerek(...args),
}));
jest.mock("@/lib/perushim/service", () => ({
	getPerushimByPerekId: (...args: unknown[]) => mockPerushimByPerek(...args),
	getPerushDetail: (...args: unknown[]) => mockPerushDetail(...args),
	getPerushimForRanges: (...args: unknown[]) => mockMoedPerushim(...args),
}));
jest.mock("@/lib/authors", () => ({
	getAllAuthorSlugs: () => mockAuthorSlugs(),
	getAuthorByName: (...args: unknown[]) => mockAuthorByName(...args),
	getArticlesByAuthorId: (...args: unknown[]) => mockArticlesByAuthor(...args),
}));
jest.mock("@/lib/moadim/service", () => ({
	MOED_STALE_BOUND_SECONDS: 3600,
	getPublishedMoadim: () => mockPublishedMoadim(),
	getMoedBySlug: (...args: unknown[]) => mockMoedBySlug(...args),
	getMoedArticleSummaries: (...args: unknown[]) => mockMoedArticles(...args),
}));
jest.mock("@/app/components/reading/unit-range-summaries", () => ({
	getParashaRangeArticles: (...args: unknown[]) => mockParashaArticles(...args),
	getParashaRangePerushim: (...args: unknown[]) => mockParashaPerushim(...args),
	getMasoraRangeArticles: (...args: unknown[]) => mockMasoraArticles(...args),
	getMasoraRangePerushim: (...args: unknown[]) => mockMasoraPerushim(...args),
}));
jest.mock("@/lib/tanahpedia/service", () => ({
	ENTITY_TYPE_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
		EVENT: "אירועים",
		WAR: "מלחמות",
		ANIMAL: "בעלי חיים",
		OBJECT: "חפצים",
		TEMPLE_TOOL: "כלי מקדש",
		PLANT: "צמחים",
		ASTRONOMICAL_OBJECT: "גרמי שמיים",
		SAYING: "אמרות",
		SEFER: "ספרים",
		TANAH_SEFER: 'ספרי תנ"ך',
		PROPHECY: "נבואות",
		NATION: "עמים",
	},
	CATEGORY_LABELS: {
		PERSON: "אישים",
		PLACE: "מקומות",
		EVENT: "אירועים",
		WAR: "מלחמות",
		ANIMAL: "בעלי חיים",
		OBJECT: "חפצים",
		TEMPLE_TOOL: "כלי מקדש",
		PLANT: "צמחים",
		ASTRONOMICAL_OBJECT: "גרמי שמיים",
		SAYING: "אמרות",
		SEFER: "ספרים",
		TANAH_SEFER: 'ספרי תנ"ך',
		PROPHECY: "נבואות",
		NATION: "עמים",
		PROPHET: "נביאים",
		KING: "מלכים",
		BEHEMA: "בהמות",
		CHAYA: "חיות",
		OF: "עופות",
		SHERETZ: "שרצים",
		TAHOR: "טהורים",
		TAMEH: "טמאים",
	},
	getAnimalsByClassification: jest.fn(async () => []),
	getEntitiesWithEntries: (...args: unknown[]) =>
		mockEntitiesWithEntries(...args),
	getEntitiesWithEntriesByRole: (...args: unknown[]) =>
		mockEntitiesWithEntries(...args),
	getEntryByUniqueName: (...args: unknown[]) => mockEntryByUniqueName(...args),
	getEntryOccurrences: (...args: unknown[]) => mockEntryOccurrences(...args),
}));
jest.mock("@/lib/tanahpedia/synonym-resolution", () => ({
	entryHref: (uniqueName: string) => `/pedia/${encodeURIComponent(uniqueName)}`,
	resolveSynonymSlug: (...args: unknown[]) => mockResolveSynonym(...args),
}));
jest.mock("@/data/parasha/parasha-units", () => ({
	...jest.requireActual<typeof import("@/data/parasha/parasha-units")>(
		"@/data/parasha/parasha-units",
	),
	getParashaEntry: (unitId: number) => mockParashaEntry(unitId),
}));

const realParashaUnits = jest.requireActual<
	typeof import("@/data/parasha/parasha-units")
>("@/data/parasha/parasha-units");

import {
	getAllParashaUnits,
	getParashaUnitById,
} from "@/data/parasha/parasha-units";
import { renderMarkdown } from "@/lib/markdown/render";

beforeEach(() => {
	jest.clearAllMocks();
	mockArticlesByPerek.mockResolvedValue([]);
	mockPerushimByPerek.mockResolvedValue([]);
	mockParashaArticles.mockResolvedValue([]);
	mockParashaPerushim.mockResolvedValue([]);
	mockMasoraArticles.mockResolvedValue([]);
	mockMasoraPerushim.mockResolvedValue([]);
	mockMoedPerushim.mockResolvedValue([]);
	mockMoedArticles.mockResolvedValue([]);
	mockParashaEntry.mockImplementation((unitId: number) =>
		realParashaUnits.getParashaEntry(unitId),
	);
});

describe("renderMarkdown", () => {
	it("renders the home index document", async () => {
		const doc = await renderMarkdown({ kind: "home" });
		expect(doc?.canonicalPath).toBe("/");
		expect(doc?.markdown).toContain("## משפחות תוכן");
		expect(doc?.markdown).toContain("/llms.txt");
	});

	it("renders the full 929 index with every perek", async () => {
		const doc = await renderMarkdown({ kind: "tanah-index" });
		expect(doc?.canonicalPath).toBe("/929");
		expect(doc?.markdown).toContain("## בראשית");
		expect(doc?.markdown).toContain("[בראשית א](/929/1)");
		expect(doc?.markdown).toContain("(/929/929)");
	});

	it("renders a perek with canonical text, recitation and related links", async () => {
		mockPerushimByPerek.mockResolvedValue([
			{ id: 5, name: 'רש"י', parshanName: "רש\"י", noteCount: 3 },
		]);
		mockArticlesByPerek.mockResolvedValue([
			{
				id: 9,
				perekId: 1,
				name: "מאמר",
				authorName: "הרב",
				abstract: null,
				authorId: 1,
				authorImageUrl: "",
				priority: 0,
			},
		]);
		const doc = await renderMarkdown({ kind: "perek", perekId: 1 });
		expect(doc?.canonicalPath).toBe("/929/1");
		expect(doc?.markdown).toContain("# בראשית א");
		// Canonical text emits as stored — combining-mark order differs
		// from typed literals, so compare after NFC canonicalization.
		expect(doc?.markdown?.normalize("NFC")).toContain(
			"א. בְּרֵאשִׁ֖ית".normalize("NFC"),
		);
		expect(doc?.markdown).toContain("## פירושים");
		expect(doc?.markdown).toContain(`/929/1/${encodeURIComponent('רש"י')}`);
		expect(doc?.markdown).toContain("[מאמר](/929/1/9)");
	});

	it("renders a full article beyond snippet length with author attribution", async () => {
		const longContent = `<p>${"מלל מאמר ".repeat(400)}</p>`;
		mockArticleById.mockResolvedValue({
			id: 42,
			perekId: 1,
			authorId: 7,
			abstract: "<p>abstract</p>",
			content: longContent,
			name: "שם המאמר",
			priority: 0,
			authorName: "הרב פלוני",
			authorImageUrl: "",
		});
		const doc = await renderMarkdown({
			kind: "article",
			perekId: 1,
			articleId: 42,
		});
		expect(doc?.markdown).toContain("# שם המאמר");
		expect(doc?.markdown).toContain("הרב פלוני");
		// All 400 repeated sentences render — the document is the full
		// article, never a truncated snippet.
		expect(doc?.markdown?.match(/מלל מאמר/g)).toHaveLength(400);
	});

	it("renders the authors index", async () => {
		mockAuthorSlugs.mockResolvedValue(["הרב-אברהם", "הרב-בניון"]);
		const doc = await renderMarkdown({ kind: "authors-index" });
		expect(doc?.canonicalPath).toBe("/929/authors");
		expect(doc?.markdown).toContain("הרב אברהם");
		expect(doc?.markdown).toContain(
			`(/929/authors/${encodeURIComponent("הרב-אברהם")})`,
		);
	});

	it("renders an author page with details, image and articles", async () => {
		mockAuthorByName.mockResolvedValue({
			id: 7,
			name: "הרב פלוני",
			details: "<p>תולדות</p>",
			imageUrl: "https://img.example/rav.png",
		});
		mockArticlesByAuthor.mockResolvedValue([
			{
				id: 9,
				perekId: 1,
				name: "מאמרו",
				authorName: "הרב פלוני",
				abstract: null,
				authorId: 7,
				authorImageUrl: "",
				priority: 0,
			},
		]);
		const doc = await renderMarkdown({
			kind: "author",
			slug: "הרב-פלוני",
		});
		expect(doc?.markdown).toContain("# הרב פלוני");
		expect(doc?.markdown).toContain("תולדות");
		expect(doc?.markdown).toContain("![הרב פלוני](https://img.example/rav.png)");
		expect(doc?.markdown).toContain("[מאמרו](/929/1/9)");
		expect(doc?.markdown).toContain("בראשית א");
	});

	it("404s an unknown author slug", async () => {
		mockAuthorByName.mockResolvedValue(null);
		expect(
			await renderMarkdown({ kind: "author", slug: "לא-קיים" }),
		).toBeNull();
	});

	it("404s an article that does not belong to the path's perek", async () => {
		mockArticleById.mockResolvedValue({
			id: 42,
			perekId: 99,
			authorId: 7,
			abstract: null,
			content: "<p>x</p>",
			name: "מאמר",
			priority: 0,
			authorName: "הרב",
			authorImageUrl: "",
		});
		expect(
			await renderMarkdown({ kind: "article", perekId: 1, articleId: 42 }),
		).toBeNull();
	});

	it("renders perush notes with pasuk references", async () => {
		mockPerushimByPerek.mockResolvedValue([
			{ id: 5, name: "רש\"י", parshanName: "רש\"י", noteCount: 2 },
		]);
		mockPerushDetail.mockResolvedValue({
			id: 5,
			name: "רש\"י",
			parshanId: 1,
			parshanName: "רש\"י",
			notes: [
				{ pasuk: 1, noteIdx: 0, noteContent: "<p>במדרש</p>" },
				{ pasuk: 3, noteIdx: 1, noteContent: "<p>פירוש נוסף</p>" },
			],
		});
		const doc = await renderMarkdown({
			kind: "perush",
			perekId: 1,
			name: 'רש"י',
		});
		expect(doc?.markdown).toContain("**א:** במדרש");
		expect(doc?.markdown).toContain("**ג:** פירוש נוסף");
	});

	it("404s a perush name not present on the perek", async () => {
		mockPerushimByPerek.mockResolvedValue([]);
		expect(
			await renderMarkdown({ kind: "perush", perekId: 1, name: "נעלם" }),
		).toBeNull();
	});

	it("renders a parasha with its haftara auxiliary reading", async () => {
		const doc = await renderMarkdown({ kind: "parasha", unitId: 1 });
		const unit = getParashaUnitById(1);
		expect(doc?.canonicalPath).toBe(`/פרשה/${unit.slug}`);
		expect(doc?.markdown).toContain(`# פרשת ${unit.heading}`);
		// בראשית's haftarah (ישעיה מב) appears as an auxiliary reading.
		expect(doc?.markdown).toContain("## הפטרה");
		expect(mockParashaArticles).toHaveBeenCalledWith(1, "torah");
		expect(mockParashaPerushim).toHaveBeenCalledWith(1, "haftara");
	});

	it("renders the parasha index grouped by sefer", async () => {
		const doc = await renderMarkdown({ kind: "parasha-index" });
		expect(doc?.canonicalPath).toBe("/פרשה");
		expect(doc?.markdown).toContain("## בראשית");
		expect(doc?.markdown).toContain("(/פרשה/בראשית)");
		expect(doc?.markdown).toContain("(/פרשה/וזאת-הברכה)");
	});

	it("prints parasha editorial and haftara notes", async () => {
		// אחרי-מות carries an editorial note; ויצא's haftarot carry
		// printed-table custom notes.
		const withNote = getAllParashaUnits().find(
			(unit) => unit.slug === "אחרי-מות",
		);
		const withHaftaraNote = getAllParashaUnits().find(
			(unit) => unit.slug === "ויצא",
		);
		if (!withNote || !withHaftaraNote) {
			throw new Error("expected parasha fixtures are missing");
		}
		const noted = await renderMarkdown({
			kind: "parasha",
			unitId: withNote.unitId,
		});
		expect(noted?.markdown).toContain("> ");
		const haftara = await renderMarkdown({
			kind: "parasha",
			unitId: withHaftaraNote.unitId,
		});
		expect(haftara?.markdown).toContain("## הפטרה");
		expect(haftara?.markdown).toContain("> ויש אומרים");
	});

	it("renders a masora unit and its closing break", async () => {
		mockMasoraPerushim.mockResolvedValue([
			{
				id: 5,
				name: "אונקלוס",
				parshanName: "אונקלוס",
				noteCount: 1,
				perekId: 1,
			},
		]);
		const doc = await renderMarkdown({ kind: "masora", unitId: 1 });
		expect(doc?.canonicalPath).toBe("/מסורה/1");
		expect(doc?.markdown).toContain("# בראשית פרשה א");
		expect(doc?.markdown).toContain("פרשה פתוחה");
		expect(doc?.markdown).toContain("## פירושים");
	});

	it("renders the masora index grouped by sefer", async () => {
		const doc = await renderMarkdown({ kind: "masora-index" });
		expect(doc?.markdown).toContain("## בראשית");
		expect(doc?.markdown).toContain("(/מסורה/1)");
	});

	it("renders a published moed with sections and ranges", async () => {
		mockMoedBySlug.mockResolvedValue({
			id: 3,
			slug: "פסח",
			name: "פסח",
			summary: "מועד חירות",
			hebrewMonth: "ניסן",
			dateLabel: "טו בניסן",
			annualOrder: 1,
			sections: [
				{
					id: 1,
					label: "קריאת התורה",
					ranges: [
						{
							start: { perekId: 58, pasuk: 17 },
							end: { perekId: 58, pasuk: 19 },
						},
					],
				},
			],
			ranges: [
				{
					start: { perekId: 58, pasuk: 17 },
					end: { perekId: 58, pasuk: 19 },
				},
			],
		});
		mockMoedArticles.mockResolvedValue([
			{
				id: 8,
				perekId: 58,
				name: "מאמר פסח",
				authorName: "הרב",
				abstract: null,
				authorId: 1,
				authorImageUrl: "",
				priority: 0,
			},
		]);
		const doc = await renderMarkdown({ kind: "moed", slug: "פסח" });
		expect(doc?.canonicalPath).toBe("/מועדים/פסח");
		expect(doc?.markdown).toContain("# פסח");
		expect(doc?.markdown).toContain("קריאת התורה");
		expect(doc?.markdown).toContain("[מאמר פסח](/929/58/8)");
	});

	it("renders a sectionless moed from its flat ranges", async () => {
		mockMoedBySlug.mockResolvedValue({
			id: 4,
			slug: "חנוכה",
			name: "חנוכה",
			summary: null,
			hebrewMonth: null,
			dateLabel: null,
			annualOrder: 8,
			sections: [],
			ranges: [
				{
					start: { perekId: 156, pasuk: 1 },
					end: { perekId: 156, pasuk: 2 },
				},
			],
		});
		const doc = await renderMarkdown({ kind: "moed", slug: "חנוכה" });
		expect(doc?.markdown).toContain("# חנוכה");
		// The flat-range fallback renders the pesukim themselves.
		expect(doc?.markdown).toContain("א. ");
	});

	it("404s an unpublished or unknown moed", async () => {
		mockMoedBySlug.mockResolvedValue(null);
		expect(await renderMarkdown({ kind: "moed", slug: "לא-קיים" })).toBeNull();
	});

	it("renders the moadim index only with published moadim", async () => {
		mockPublishedMoadim.mockResolvedValue([
			{
				id: 1,
				slug: "פסח",
				name: "פסח",
				summary: null,
				hebrewMonth: "ניסן",
				dateLabel: "טו",
				annualOrder: 1,
			},
		]);
		const doc = await renderMarkdown({ kind: "moadim-index" });
		expect(doc?.markdown).toContain("[פסח](/מועדים/פסח)");
	});

	it("renders a pedia category listing", async () => {
		mockEntitiesWithEntries.mockResolvedValue([
			{
				entityType: "PERSON",
				entityId: "e1",
				entityName: "אברהם",
				linkedEntries: [
					{ id: "en1", uniqueName: "אברהם", title: "אברהם אבינו" },
				],
			},
		]);
		const doc = await renderMarkdown({ kind: "pedia", slug: "אישים" });
		expect(doc?.markdown).toContain("אברהם אבינו");
		expect(doc?.markdown).toContain("](/pedia/");
	});

	it("renders the pedia index with every category", async () => {
		const doc = await renderMarkdown({ kind: "pedia-index" });
		expect(doc?.canonicalPath).toBe("/pedia");
		expect(doc?.markdown).toContain("## קטגוריות");
		expect(doc?.markdown).toContain("(/pedia/אישים)");
	});

	it("renders a role subcategory through the role entity loader", async () => {
		mockEntitiesWithEntries.mockResolvedValue([
			{
				entityType: "PERSON",
				entityId: "p1",
				entityName: "ישעיהו",
				linkedEntries: [],
			},
		]);
		const doc = await renderMarkdown({ kind: "pedia", slug: "נביאים" });
		expect(doc?.canonicalPath).toBe("/pedia/נביאים");
		expect(doc?.markdown).toContain("# נביאים - תנכפדיה");
		// Entities without a linked entry still list by name.
		expect(doc?.markdown).toContain("- ישעיהו");
	});

	it("renders animal kind and purity subcategories", async () => {
		for (const slug of ["חיות", "טהורים"]) {
			const doc = await renderMarkdown({ kind: "pedia", slug });
			expect(doc?.canonicalPath).toBe(`/pedia/${slug}`);
			expect(doc?.markdown).toContain("עדיין אין ערכים בקטגוריה זו.");
		}
	});

	it("renders a full pedia entry with occurrences", async () => {
		mockEntryByUniqueName.mockResolvedValue({
			id: "e1",
			uniqueName: "אברהם",
			title: "אברהם אבינו",
			content: `<p>${"תוכן ערך ".repeat(300)}</p>`,
			createdAt: "",
			updatedAt: "",
			entities: [
				{ id: "ee1", entityType: "PERSON", entityName: "אברהם", entityId: "e1" },
			],
		});
		mockEntryOccurrences.mockResolvedValue([
			{ perekId: 1, pasukNumber: 17, segmentStart: null, segmentEnd: null },
		]);
		const doc = await renderMarkdown({ kind: "pedia", slug: "אברהם" });
		expect(doc?.canonicalPath).toBe(`/pedia/${encodeURIComponent("אברהם")}`);
		expect(doc?.markdown).toContain("# אברהם אבינו");
		expect(doc?.markdown).toContain("## מראי מקום");
		expect(doc?.markdown?.match(/תוכן ערך/g)).toHaveLength(300);
	});

	it("renders a disambiguation list for an ambiguous synonym", async () => {
		mockEntryByUniqueName.mockResolvedValue(null);
		mockResolveSynonym.mockResolvedValue({
			kind: "disambiguation",
			targets: [
				{ entryId: "a", uniqueName: "משה-רבנו", title: "משה רבנו", label: "הנביא" },
				{ entryId: "b", uniqueName: "משה-בן-מימון", title: "רמב\"ם", label: null },
			],
		});
		const doc = await renderMarkdown({ kind: "pedia", slug: "משה" });
		expect(doc?.markdown).toContain("משה רבנו");
		expect(doc?.markdown).toContain("רמב\"ם");
	});

	it("serves the alias target document for a known synonym", async () => {
		mockEntryByUniqueName.mockImplementation(async (name: string) =>
			name === "משה-רבנו"
				? {
						id: "e1",
						uniqueName: "משה-רבנו",
						title: "משה רבנו",
						content: "<p>תוכן</p>",
						createdAt: "",
						updatedAt: "",
						entities: [],
					}
				: null,
		);
		mockEntryOccurrences.mockResolvedValue([]);
		mockResolveSynonym.mockResolvedValue({
			kind: "alias",
			target: { entryId: "e1", uniqueName: "משה-רבנו", title: "משה רבנו", label: null },
		});
		const doc = await renderMarkdown({ kind: "pedia", slug: "משה" });
		expect(doc?.canonicalPath).toBe(`/pedia/${encodeURIComponent("משה-רבנו")}`);
		expect(doc?.markdown).toContain("# משה רבנו");
	});

	it("404s a pedia slug that resolves to nothing", async () => {
		mockEntryByUniqueName.mockResolvedValue(null);
		mockResolveSynonym.mockResolvedValue({ kind: "missing" });
		expect(await renderMarkdown({ kind: "pedia", slug: "נעלם" })).toBeNull();
	});

	it("propagates transient backend failures instead of a false 404", async () => {
		mockPerushimByPerek.mockRejectedValue(new Error("db down"));
		await expect(
			renderMarkdown({ kind: "perek", perekId: 1 }),
		).rejects.toThrow("db down");
	});

	it("renders a perek without recitation or related links", async () => {
		// Perek 142 has no published recitation recording.
		const doc = await renderMarkdown({ kind: "perek", perekId: 142 });
		expect(doc?.canonicalPath).toBe("/929/142");
		expect(doc?.markdown).not.toContain("## הקראה");
		expect(doc?.markdown).not.toContain("## פירושים");
		expect(doc?.markdown).not.toContain("## מאמרים");
	});

	it("renders an article without abstract or body", async () => {
		mockArticleById.mockResolvedValue({
			id: 42,
			perekId: 1,
			authorId: 7,
			abstract: null,
			content: "",
			name: "מאמר ריק",
			priority: 0,
			authorName: "הרב",
			authorImageUrl: "",
		});
		const doc = await renderMarkdown({
			kind: "article",
			perekId: 1,
			articleId: 42,
		});
		expect(doc?.markdown).toContain("# מאמר ריק");
		expect(doc?.markdown).toContain("Canonical:");
	});

	it("404s when the perush detail fails to load", async () => {
		mockPerushimByPerek.mockResolvedValue([
			{ id: 5, name: 'רש"י', parshanName: 'רש"י', noteCount: 2 },
		]);
		mockPerushDetail.mockResolvedValue(null);
		expect(
			await renderMarkdown({ kind: "perush", perekId: 1, name: 'רש"י' }),
		).toBeNull();
	});

	it("skips perush notes with empty content", async () => {
		mockPerushimByPerek.mockResolvedValue([
			{ id: 5, name: 'רש"י', parshanName: 'רש"י', noteCount: 2 },
		]);
		mockPerushDetail.mockResolvedValue({
			id: 5,
			name: 'רש"י',
			parshanId: 1,
			parshanName: 'רש"י',
			notes: [
				{ pasuk: 1, noteIdx: 0, noteContent: "" },
				{ pasuk: 2, noteIdx: 1, noteContent: "<p>יש תוכן</p>" },
			],
		});
		const doc = await renderMarkdown({
			kind: "perush",
			perekId: 1,
			name: 'רש"י',
		});
		expect(doc?.markdown).toContain("**ב:** יש תוכן");
		expect(doc?.markdown).not.toContain("**א:**");
	});

	it("renders an author without details, image, or articles", async () => {
		mockAuthorByName.mockResolvedValue({
			id: 7,
			name: "הרב פלוני",
			details: "",
			imageUrl: "",
		});
		mockArticlesByAuthor.mockResolvedValue([]);
		const doc = await renderMarkdown({ kind: "author", slug: "הרב-פלוני" });
		expect(doc?.markdown).toContain("# הרב פלוני");
		expect(doc?.markdown).not.toContain("## מאמרים");
	});

	it("renders a parasha without auxiliary readings", async () => {
		mockParashaEntry.mockReturnValue({
			...realParashaUnits.getParashaEntry(1),
			haftarot: [],
		});
		const doc = await renderMarkdown({ kind: "parasha", unitId: 1 });
		expect(doc?.markdown).not.toContain("## הפטרה");
		expect(mockParashaPerushim).toHaveBeenCalledWith(1, "torah");
		expect(mockParashaPerushim).not.toHaveBeenCalledWith(1, "haftara");
	});

	it("links parasha-related perushim and articles", async () => {
		mockParashaPerushim.mockResolvedValue([
			{ id: 5, name: 'רש"י', parshanName: 'רש"י', noteCount: 1, perekId: 1 },
		]);
		mockParashaArticles.mockResolvedValue([
			{
				id: 9,
				perekId: 1,
				name: "מאמר פרשה",
				authorName: "הרב",
				abstract: null,
				authorId: 1,
				authorImageUrl: "",
				priority: 0,
			},
		]);
		const doc = await renderMarkdown({ kind: "parasha", unitId: 1 });
		expect(doc?.markdown).toContain("## פירושים על הפרשה");
		expect(doc?.markdown).toContain("## מאמרים על ההפטרה");
	});

	it("renders a stuma masora unit without related content", async () => {
		const doc = await renderMarkdown({ kind: "masora", unitId: 8 });
		expect(doc?.markdown).toContain("פרשה סתומה");
		expect(doc?.markdown).not.toContain("## פירושים");
	});

	it("renders a masora unit without a closing break", async () => {
		const doc = await renderMarkdown({ kind: "masora", unitId: 93 });
		expect(doc?.markdown).not.toContain("פרשה סתומה");
		expect(doc?.markdown).not.toContain("פרשה פתוחה");
	});

	it("lists a published moed without a date label", async () => {
		mockPublishedMoadim.mockResolvedValue([
			{
				id: 2,
				slug: "חנוכה",
				name: "חנוכה",
				summary: null,
				hebrewMonth: null,
				dateLabel: null,
				annualOrder: 8,
			},
		]);
		const doc = await renderMarkdown({ kind: "moadim-index" });
		expect(doc?.markdown).toContain("[חנוכה](/מועדים/חנוכה)");
	});

	it("keeps the raw entity type when it has no Hebrew label", async () => {
		mockEntryByUniqueName.mockResolvedValue({
			id: "e1",
			uniqueName: "נס",
			title: "נס",
			content: "<p>x</p>",
			createdAt: "",
			updatedAt: "",
			entities: [
				{ id: "ee1", entityType: "ALIEN", entityName: "נס", entityId: "e1" },
			],
		});
		mockEntryOccurrences.mockResolvedValue([]);
		const doc = await renderMarkdown({ kind: "pedia", slug: "נס" });
		expect(doc?.markdown).toContain("[ALIEN]");
	});

	it("shows a placeholder when a pedia entry has no content", async () => {
		mockEntryByUniqueName.mockResolvedValue({
			id: "e1",
			uniqueName: "נס",
			title: "נס",
			content: "",
			createdAt: "",
			updatedAt: "",
			entities: [],
		});
		mockEntryOccurrences.mockResolvedValue([]);
		const doc = await renderMarkdown({ kind: "pedia", slug: "נס" });
		expect(doc?.markdown).toContain("אין תוכן עדיין לערך זה.");
	});
});
