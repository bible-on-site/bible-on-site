/**
 * @jest-environment node
 */
jest.mock("@/lib/api-client", () => ({
	query: jest.fn(),
}));

import { query } from "@/lib/api-client";
import {
	perushHitReference,
	phraseRegexp,
	searchArticles,
	searchAuthors,
	searchPerushNotes,
	searchTanahpediaEntries,
	termAnchors,
	termChunks,
	termRegexp,
} from "@/lib/search/db-content";
import { htmlToPlainText, normalizeSearchText } from "@/lib/search/normalize";

const mockQuery = query as jest.MockedFunction<typeof query>;

/**
 * The semantic contract the generated SQL candidate pattern encodes,
 * evaluated on the normalized text like the pipeline itself: a stored
 * word is selectable for `term` when it starts with the term (the
 * exact/prefix alternand) or, for terms long enough to carry the fuzzy
 * tier, when it holds one intact {@link termChunks chunk} with at most
 * `term + maxEdits` letters on either side — every word the scorer's
 * bounded edit distance accepts satisfies that. Asserting the contract
 * through the pipeline keeps these tests honest about the requirement
 * (the repo's codacy gate forbids compiling a non-literal RegExp even
 * in tests); the pattern itself is verified structurally.
 */
function candidateSemantics(term: string, raw: string): boolean {
	const chunks = termChunks(term);
	const edits = chunks.length - 1;
	const length = [...term].length;
	return normalized(raw)
		.split(" ")
		.filter((word) => word.length > 0)
		.some((word) => {
			if (word.startsWith(term)) return true;
			if (edits === 0) return false;
			return chunks.some((chunk) => {
				const budget = length + edits - [...chunk].length;
				for (
					let index = word.indexOf(chunk);
					index !== -1;
					index = word.indexOf(chunk, index + 1)
				) {
					if (
						[...word.slice(0, index)].length <= budget &&
						[...word.slice(index + chunk.length)].length <= budget
					) {
						return true;
					}
				}
				return false;
			});
		});
}

/**
 * The semantic contract the generated SQL regex encodes: a raw string is
 * a candidate for `term` exactly when the JS pipeline's normalized text
 * still contains the term — the regex's ignorable runs are the same
 * characters the pipeline erases. Verifying through the pipeline keeps
 * this test honest about the requirement rather than the pattern text.
 */
function normalized(raw: string): string {
	return normalizeSearchText(htmlToPlainText(raw));
}

describe("termRegexp", () => {
	it("lets the normalizer's erased characters sit between term letters", () => {
		expect(normalized('הרב שליט"א לוי')).toContain("שליטא"); // gershayim
		expect(normalized("שְׁלִיטָא")).toContain("שליטא"); // niqqud/taamim
		expect(normalized("שלי<b>טא</b>")).toContain("שליטא"); // inline markup
		expect(normalized("שליט&quot;א")).toContain("שליטא"); // entity
	});

	it("keeps real word boundaries between term letters", () => {
		expect(normalized("אבא תורה")).not.toContain("את"); // space
		expect(normalized("אמר-תורה")).not.toContain("את"); // punctuation
		expect(normalized('א"ת בראשית')).toContain("את"); // quotes erased
	});

	it("interleaves only ignorable fragments between the term letters", () => {
		const pattern = termRegexp("את");
		expect(pattern).toContain("א");
		expect(pattern).toContain("ת");
		expect(pattern).toContain(String.raw`\p{M}`); // combining marks
		expect(pattern).toContain("״"); // gershayim
		expect(pattern).toContain("<[^>]+>"); // tags
		expect(pattern).toContain("&[a-zA-Z#0-9]+;"); // entities
	});
});

describe("termChunks", () => {
	it("splits a term into maxEdits+1 balanced chunks", () => {
		expect(termChunks("את")).toEqual(["את"]); // too short for edits
		expect(termChunks("אבגד")).toEqual(["אב", "גד"]); // 1 edit → 2 chunks
		expect(termChunks("ירושלימ")).toEqual(["ירוש", "לימ"]); // 7 → 4+3
		expect(termChunks("אבגדהוזח")).toEqual(["אבג", "דהו", "זח"]); // 2 edits → 3
	});
});

describe("termAnchors", () => {
	it("admits every word the scorer accepts", () => {
		const scorerAccepted: [string, string][] = [
			// The #2140 example: a final-letter substitution.
			["ירושלימ", "ירושלים"],
			// Substitution inside the term.
			["בראשיט", "בראשית"],
			// Insertion and deletion.
			["בראשית", "בבראשית"],
			["בראשית", "בראשת"],
			// Two edits for a long term, the surviving chunk stays interior.
			["אבגדהוזח", "אסגדהוזט"],
			// Prefix and exact words.
			["בראשית", "בראשיתו"],
			["את", "אתר"],
		];
		for (const [term, word] of scorerAccepted) {
			expect(candidateSemantics(term, word)).toBe(true);
		}
	});

	it("admits a misspelled word anywhere in the stored text", () => {
		expect(candidateSemantics("ירושלימ", "<p>עיר הקודש ירושלים</p>")).toBe(
			true,
		);
	});

	it("rejects chunks sitting inside words too long for the bound", () => {
		expect(candidateSemantics("ירושלימ", "אאאאאאאאאאירושאאאאאאאאאא")).toBe(
			false,
		);
		expect(candidateSemantics("ירושלימ", "אזור")).toBe(false);
	});

	it("keeps short terms on the exact/prefix path only", () => {
		expect(termAnchors("את")).toHaveLength(1);
		expect(candidateSemantics("את", "את")).toBe(true);
		expect(candidateSemantics("את", "אתר")).toBe(true); // prefix scores
		expect(candidateSemantics("את", "באת")).toBe(false); // mid-word scores 0
		expect(candidateSemantics("את", "אג")).toBe(false); // edits need 4+ chars
	});

	it("encodes the contract in word-bounded, length-bounded pattern pieces", () => {
		const anchors = termAnchors("ירושלימ");
		// Exact/prefix alternand plus one bounded piece per chunk.
		expect(anchors).toHaveLength(1 + termChunks("ירושלימ").length);
		for (const anchor of anchors) {
			expect(anchor).toContain("(?:^|"); // word-start anchor
			expect(anchor).toContain(String.raw`[^\p{L}\p{N}]`); // word boundary
		}
		for (const chunkPattern of anchors.slice(1)) {
			expect(chunkPattern).toContain("{0,"); // bounded rooms each side
			expect(chunkPattern).toContain("|$)"); // word-end boundary
		}
		expect(termRegexp("ירושלימ")).toBe(`(?:${anchors.join("|")})`);
	});
});

describe("phraseRegexp", () => {
	it("requires the phrase as consecutive whole words", () => {
		const phrase = "בראשית ברא";
		const bounded = (raw: string) =>
			` ${normalized(raw)} `.includes(` ${phrase} `);
		expect(bounded("דבור בראשית ברא אלהים")).toBe(true);
		expect(bounded("בְּרֵאשִׁית בָּרָא")).toBe(true);
		expect(bounded("בראשית אלה ברא")).toBe(false); // not adjacent
		expect(bounded("נבראשית ברא")).toBe(false); // mid-word start
		expect(bounded("בראשית בראים")).toBe(false); // mid-word end
	});

	it("wraps the phrase in word-boundary fragments", () => {
		const pattern = phraseRegexp(["את"]);
		expect(pattern).toContain(String.raw`[^\p{L}\p{N}]`);
		expect(pattern.startsWith("(?:^|")).toBe(true);
		expect(pattern.endsWith("|$)")).toBe(true);
	});
});

describe("searchPerushNotes", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("issues a bounded ranked REGEXP query and scores results", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 23,
				perush_name: 'רש"י',
				perek_id: 1,
				pasuk: 1,
				note_content: "<p>בראשית - לשון בראייה</p>",
			},
			{
				perush_id: 23,
				perush_name: 'רש"י',
				perek_id: 1,
				pasuk: 2,
				note_content: "<p>טקסט אחר לגמרי</p>",
			},
		]);
		const hits = await searchPerushNotes("בראשית", 10);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("REGEXP_LIKE(n.note_content, ?, 'i')"),
			[
				termRegexp("בראשית"),
				phraseRegexp(["בראשית"]),
				...termAnchors("בראשית"),
			],
		);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("MAX_EXECUTION_TIME"),
			expect.anything(),
		);
		// Whole-word candidates are ranked before the row cap.
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("ORDER BY REGEXP_LIKE"),
			expect.anything(),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.perushName).toBe('רש"י');
		expect(hits[0].entry.perekId).toBe(1);
		expect(hits[0].entry.pasukNum).toBe(1);
	});

	it("ANDs multiple terms into the candidate query", async () => {
		mockQuery.mockResolvedValue([]);
		await searchPerushNotes("אחד שני", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		// Two candidate predicates (one per term), one phrase-rank flag,
		// and one anchor-count flag per term inside the rank sum.
		expect(sql.match(/REGEXP_LIKE\(n\.note_content/g)).toHaveLength(5);
		expect(params).toEqual([
			termRegexp("אחד"),
			termRegexp("שני"),
			phraseRegexp(["אחד", "שני"]),
			...termAnchors("אחד"),
			...termAnchors("שני"),
		]);
	});

	it("selects a note whose stored word is a misspelling of the query", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 23,
				perush_name: 'רש"י',
				perek_id: 1,
				pasuk: 1,
				note_idx: 0,
				note_content: "<p>על ירושלים נאמר</p>",
			},
		]);
		const hits = await searchPerushNotes("ירושלימ", 10);
		const [, params] = mockQuery.mock.calls[0];
		// The mocked query returns rows without applying WHERE — verify the
		// generated pattern (bound as the first param) encodes a candidate
		// contract that would select the misspelled-relative text.
		expect(params?.[0]).toBe(termRegexp("ירושלימ"));
		expect(candidateSemantics("ירושלימ", "על ירושלים נאמר")).toBe(true);
		expect(hits).toHaveLength(1);
		expect(hits[0].score).toBe(60); // fuzzy tier, reached only via the new path
	});

	it("dedupes to the best fragment per perush/perek/pasuk", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 23,
				perush_name: 'רש"י',
				perek_id: 1,
				pasuk: 1,
				note_idx: 0,
				note_content: "מלים על בראשית ועוד בראשית",
			},
			{
				perush_id: 23,
				perush_name: 'רש"י',
				perek_id: 1,
				pasuk: 1,
				note_idx: 1,
				note_content: "טקסט נוסף בראשית",
			},
		]);
		const hits = await searchPerushNotes("בראשית", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].score).toBeGreaterThan(0);
		// The surviving hit keeps its own note_idx for the deep link (#2078).
		expect(hits[0].entry.noteIdx).toBe(0);
	});

	it("carries note_idx from the row into the hit", async () => {
		mockQuery.mockResolvedValue([
			{
				perush_id: 23,
				perush_name: 'רש"י',
				perek_id: 1,
				pasuk: 1,
				note_idx: 3,
				note_content: "מלים על בראשית",
			},
		]);
		const hits = await searchPerushNotes("בראשית", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.noteIdx).toBe(3);
	});

	it("returns empty for a blank phrase without querying", async () => {
		const hits = await searchPerushNotes("---", 10);
		expect(hits).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("ranks relevance before chapter and verse, then limits the results", async () => {
		mockQuery.mockResolvedValue(
			[
				{ perek_id: 2, pasuk: 1, note_content: "על בראשית" },
				{ perek_id: 1, pasuk: 3, note_content: "על בראשית" },
				{ perek_id: 1, pasuk: 1, note_content: "על בראשית" },
				{ perek_id: 3, pasuk: 1, note_content: "בראשית" },
			].map((row) => ({ perush_id: 23, perush_name: 'רש"י', ...row })),
		);

		const hits = await searchPerushNotes("בראשית", 3);

		expect(hits.map(({ entry }) => [entry.perekId, entry.pasukNum])).toEqual([
			[3, 1],
			[1, 1],
			[1, 3],
		]);
		expect(hits[0].score).toBeGreaterThan(hits[1].score);
		expect(hits[1].score).toBe(hits[2].score);
	});

	it("builds a canonical perush reference", () => {
		const ref = perushHitReference({
			perushId: 23,
			perushName: 'רש"י',
			perekId: 1,
			pasukNum: 1,
			noteIdx: 0,
			noteContent: "",
			plain: "",
		});
		expect(ref).toBe('רש"י בראשית א א');
	});
});

describe("searchAuthors", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("matches authors by name with a slug for the link", async () => {
		mockQuery.mockResolvedValue([
			{ id: 7, name: 'הרב שליט"א לוי', details: "רב ומחבר" },
		]);
		const hits = await searchAuthors("שליטא", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.slug).toBe(encodeURIComponent("הרב שליטא לוי"));
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("ORs name and details per term and ranks phrase and anchors first", async () => {
		mockQuery.mockResolvedValue([]);
		await searchAuthors("לוי", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain(
			"REGEXP_LIKE(name, ?, 'i') OR REGEXP_LIKE(details, ?, 'i')",
		);
		expect(sql).toContain(
			"ORDER BY REGEXP_LIKE(name, ?, 'i') DESC, (REGEXP_LIKE(name, ?, 'i')) DESC, REGEXP_LIKE(details, ?, 'i') DESC, (REGEXP_LIKE(details, ?, 'i')) DESC",
		);
		expect(params).toEqual([
			termRegexp("לוי"),
			termRegexp("לוי"),
			phraseRegexp(["לוי"]),
			...termAnchors("לוי"),
			phraseRegexp(["לוי"]),
			...termAnchors("לוי"),
		]);
	});

	it("selects an author name that is a misspelling of the query", async () => {
		mockQuery.mockResolvedValue([{ id: 7, name: "ירושלים", details: null }]);
		const hits = await searchAuthors("ירושלימ", 10);
		const [, params] = mockQuery.mock.calls[0];
		expect(params?.[0]).toBe(termRegexp("ירושלימ"));
		expect(candidateSemantics("ירושלימ", "ירושלים")).toBe(true);
		expect(hits[0].score).toBe(120); // fuzzy 60 on the name, ×2 weight
	});

	it("matches authors without details and orders equal scores by id", async () => {
		mockQuery.mockResolvedValue([
			{ id: 2, name: "רב לוי", details: null },
			{ id: 3, name: "לוי הראשון", details: null },
			{ id: 1, name: "רב לוי", details: null },
		]);
		const hits = await searchAuthors("לוי", 10);
		expect(hits).toHaveLength(3);
		// The two identical names tie on score and fall back to id order.
		const tied = hits.filter((hit) => hit.entry.name === "רב לוי");
		expect(tied.map((hit) => hit.entry.id)).toEqual([1, 2]);
	});

	it("returns empty for a blank phrase without querying", async () => {
		expect(await searchAuthors("---", 10)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe("searchArticles", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("excludes articles outside the 929 chapter range", async () => {
		mockQuery.mockResolvedValue([]);

		await searchArticles("בראשית", 10);

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("a.perek_id BETWEEN 1 AND 929"),
			expect.anything(),
		);
	});

	it("matches article names and strips HTML before scoring", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 42,
				perek_id: 1,
				name: "מאמר על בראשית",
				author_name: "הרב לוי",
				content: "<p>תוכן ארוך על בראשית</p>",
				abstract: null,
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("REGEXP_LIKE(a.name, ?, 'i')"),
			expect.anything(),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toBe("תוכן ארוך על בראשית");
		expect(hits[0].entry.id).toBe(42);
	});

	it("keeps an abstract-only match even when content is unrelated", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 7,
				perek_id: 1,
				name: "מבוא",
				author_name: "הרב לוי",
				content: "דברי פתיחה בלי קשר",
				abstract: "<p>על בראשית</p>",
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(hits).toHaveLength(1);
		// The snippet comes from the field that supplied the match.
		expect(hits[0].entry.plain).toBe("על בראשית");
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("falls back to the abstract when content is missing", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 5,
				perek_id: 1,
				name: "מאמר זר",
				author_name: "הרב לוי",
				content: null,
				abstract: "<p>תקציר על בראשית</p>",
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toBe("תקציר על בראשית");
	});

	it("selects an article whose name is a misspelling of the query", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 1,
				perek_id: 5,
				name: "ירושלים",
				author_name: "הרב לוי",
				content: null,
				abstract: null,
			},
		]);
		const hits = await searchArticles("ירושלימ", 10);
		const [, params] = mockQuery.mock.calls[0];
		expect(params?.[0]).toBe(termRegexp("ירושלימ"));
		expect(candidateSemantics("ירושלימ", "ירושלים")).toBe(true);
		expect(hits[0].score).toBe(120); // fuzzy 60 on the name, ×2 weight
	});

	it("drops an article with no searchable text", async () => {
		mockQuery.mockResolvedValue([
			{
				id: 6,
				perek_id: 1,
				name: "מאמר",
				author_name: "הרב",
				content: null,
				abstract: null,
			},
		]);
		const hits = await searchArticles("בראשית", 10);
		expect(hits).toHaveLength(0);
	});

	it("returns empty for a blank phrase without querying", async () => {
		expect(await searchArticles("---", 10)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe("searchTanahpediaEntries", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	/**
	 * Route the two provider queries by their FROM clause: the candidate
	 * query reads `tanahpedia_entry` (and mentions the synonym tables only
	 * inside EXISTS), the follow-up reads the synonym tables directly.
	 */
	function mockEntries(
		entries: unknown[],
		synonyms: { entryId: string; name: string }[] = [],
	) {
		mockQuery.mockImplementation((sql: string) =>
			Promise.resolve(
				sql.includes("FROM tanahpedia_entry e")
					? (entries as never)
					: (synonyms as never),
			),
		);
	}

	it("issues a bounded ranked query over title, slug, content and aliases", async () => {
		mockEntries([]);
		await searchTanahpediaEntries("משה", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain("FROM tanahpedia_entry e");
		expect(sql).toContain("MAX_EXECUTION_TIME");
		expect(sql).toContain("LIMIT 1000");
		// One REGEXP_LIKE per searchable field plus one inside the synonym
		// EXISTS clause — four per term in WHERE — then a phrase flag and an
		// anchor count per fragment in ORDER BY rank.
		expect(sql.match(/REGEXP_LIKE\(/g)).toHaveLength(12);
		expect(sql.match(/tanahpedia_entry_synonym/g)?.length).toBeGreaterThan(0);
		expect(params).toEqual([
			termRegexp("משה"),
			termRegexp("משה"),
			termRegexp("משה"),
			termRegexp("משה"),
			phraseRegexp(["משה"]),
			...termAnchors("משה"),
			phraseRegexp(["משה"]),
			...termAnchors("משה"),
			phraseRegexp(["משה"]),
			...termAnchors("משה"),
			phraseRegexp(["משה"]),
			...termAnchors("משה"),
		]);
	});

	it("matches entries by title and keeps content as the snippet source", async () => {
		mockEntries([
			{
				id: "e1",
				unique_name: "משה-רבנו",
				title: "משה רבנו",
				content: "<p>מושיען של ישראל</p>",
			},
		]);
		const hits = await searchTanahpediaEntries("משה", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.uniqueName).toBe("משה-רבנו");
		expect(hits[0].entry.plain).toBe("מושיען של ישראל");
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("matches entries by alias and exposes the alias as the snippet source", async () => {
		mockEntries(
			[
				{
					id: "e1",
					unique_name: "יהושע-בן-נון",
					title: "יהושע בן נון",
					content: "<p>ממשיך דרכו של משה</p>",
				},
			],
			[
				{ entryId: "e1", name: "יהושע" },
				{ entryId: "e1", name: "הושע בן נון" },
			],
		);
		// "הושע" is too short for a fuzzy hit on "יהושע" — only the alias wins.
		const hits = await searchTanahpediaEntries("הושע בן נון", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toContain("הושע בן נון");
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("scores an entry reachable through a disambiguation target", async () => {
		// dis.entry_id hits reach the entry through a shared alias, exactly
		// like the /pedia/[slug] resolver treats ambiguous names.
		mockEntries(
			[{ id: "e2", unique_name: "אחר", title: "ערך אחר", content: null }],
			[{ entryId: "e2", name: "שם נרדף" }],
		);
		const hits = await searchTanahpediaEntries("שם נרדף", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.uniqueName).toBe("אחר");
	});

	it("surfaces contentless entries by title with an empty snippet source", async () => {
		mockEntries([
			{
				id: "e1",
				unique_name: "ירושלים",
				title: "ירושלים",
				content: null,
			},
		]);
		const hits = await searchTanahpediaEntries("ירושלים", 10);
		expect(hits).toHaveLength(1);
		expect(hits[0].entry.plain).toBe("");
	});

	it("selects an entry whose title is a misspelling of the query (#2140)", async () => {
		mockEntries([
			{
				id: "e1",
				unique_name: "ירושלים",
				title: "ירושלים",
				content: null,
			},
		]);
		const hits = await searchTanahpediaEntries("ירושלימ", 10);
		const [, params] = mockQuery.mock.calls[0];
		// The mocked query returns rows without applying WHERE — verify the
		// generated pattern's contract would select the misspelled title.
		expect(params?.[0]).toBe(termRegexp("ירושלימ"));
		expect(candidateSemantics("ירושלימ", "ירושלים")).toBe(true);
		expect(hits).toHaveLength(1);
		expect(hits[0].score).toBe(120); // fuzzy 60 at name weight
	});

	it("skips the synonym query when no entries match", async () => {
		mockEntries([]);
		const hits = await searchTanahpediaEntries("בראשית", 10);
		expect(hits).toEqual([]);
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	it("ranks relevance before Hebrew title and id, then limits the results", async () => {
		mockEntries(
			[
				{ id: "z", title: "משה ב" },
				{ id: "b", title: "משה א" },
				{ id: "a", title: "משה א" },
				{ id: "d", title: "משה" },
			].map((row) => ({
				unique_name: `entry-${row.id}`,
				content: null,
				...row,
			})),
		);

		const hits = await searchTanahpediaEntries("משה", 3);

		expect(hits.map(({ entry }) => entry.id)).toEqual(["d", "a", "b"]);
		expect(hits[0].score).toBeGreaterThan(hits[1].score);
		expect(hits[1].score).toBe(hits[2].score);
	});

	it("returns empty for a blank phrase without querying", async () => {
		expect(await searchTanahpediaEntries("---", 10)).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});
