/**
 * @jest-environment node
 */
jest.mock("@/lib/api-client", () => ({
	query: jest.fn(),
	queryText: jest.fn(),
}));

import { queryText } from "@/lib/api-client";
import {
	perushHitReference,
	phraseRegexp,
	searchArticles,
	searchAuthors,
	searchPerushNotes,
	searchTanahpediaEntries,
	termAnchors,
	termChunks,
	termGateRegexp,
	termRankPatterns,
	termRegexp,
} from "@/lib/search/db-content";
import { htmlToPlainText, normalizeSearchText } from "@/lib/search/normalize";

const mockQuery = queryText as jest.MockedFunction<typeof queryText>;

/**
 * The semantic contract the generated SQL candidate pattern encodes,
 * evaluated on the normalized text like the pipeline itself: a stored
 * word is selectable for `term` when it starts with the term (the
 * exact/prefix alternand) or, for terms long enough to carry the fuzzy
 * tier, when it holds one intact {@link termChunks chunk} while its
 * whole length stays inside `[term - edits, term + edits]` — the only
 * lengths a bounded edit distance can reach. Asserting the contract
 * through the pipeline keeps these tests honest about the requirement
 * (the repo's codacy gate forbids compiling a non-literal RegExp even
 * in tests); the pattern itself is verified structurally, and the
 * e2e suite probes `REGEXP_LIKE` on a real MySQL.
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
			const wordLength = [...word].length;
			if (wordLength < length - edits || wordLength > length + edits) {
				return false;
			}
			return chunks.some((chunk) => word.includes(chunk));
		});
}

/**
 * The contract the generated WHERE gate encodes — {@link termGateRegexp}
 * is the whole WHERE predicate now: a raw text is selectable exactly
 * when the normalized text holds one of the term's chunks *anywhere*,
 * word-anchored or not. It is a pure superset of
 * {@link candidateSemantics} — every scorable word keeps an intact
 * chunk — and everything it over-admits (mid-word chunks, over-long
 * words, bare chunk words) is shed by the rank estimate before the
 * row cap. Deliberately anchor-free: anchored patterns are what
 * exhaust MySQL's `regexp_time_limit` on giant `note_content` rows
 * (#2140 follow-up).
 */
function gateSemantics(term: string, raw: string): boolean {
	const text = normalized(raw);
	return termChunks(term).some((chunk) => text.includes(chunk));
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

	it("rejects chunks sitting inside words outside the length bound", () => {
		// Over the `term + edits` ceiling — the review's `אבגדירושאבגד`
		// example (12 letters for a 7-letter term allowing one edit).
		expect(candidateSemantics("ירושלימ", "אבגדירושאבגד")).toBe(false);
		expect(candidateSemantics("ירושלימ", "אאאאאאאאאאירושאאאאאאאאאא")).toBe(
			false,
		);
		// Under the `term - edits` floor — a bare chunk word is a dead
		// candidate, and two split chunk words never form a fuzzy word.
		expect(candidateSemantics("ירושלימ", "ירוש")).toBe(false);
		expect(candidateSemantics("ירושלימ", "ירוש לימ")).toBe(false);
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
			// Total word length asserted at the word start inside a single
			// bounded-range lookahead: [term - edits, term + edits] =
			// [6, 8] letters for `ירושלימ`. The in-word prefix is bounded
			// to `hi - chunk` letters — an unbounded `*` over the nested
			// ignorable run trips MySQL's regexp_time_limit on a
			// full-table scan (#2140 follow-up).
			expect(chunkPattern).toContain("(?=(?:[\\p{L}\\p{N}]");
			expect(chunkPattern).toContain("){6,8}(?:");
			expect(chunkPattern).toMatch(/\)\{0,[0-9]+\}/);
		}
		expect(termRegexp("ירושלימ")).toBe(`(?:${anchors.join("|")})`);
	});
});

describe("termGateRegexp selection", () => {
	it("admits every word the strict candidate contract admits", () => {
		// WHERE is the bare chunk gate; anything candidateSemantics
		// selects must survive WHERE first.
		for (const [term, word] of [
			["ירושלימ", "ירושלים"],
			["ירושלימ", "על ירושלים נאמר"],
			["ירושלימ", "ירושלמי"],
			["ירושלימ", "בירושלים"],
			["אבגדהוזח", "אסגדהוזט"],
			["בראשית", "בבראשית"],
			["בראשית", "בראשיתו"],
			["את", "אתר"],
		] as const) {
			expect(gateSemantics(term, word)).toBe(true);
		}
	});

	it("admits dead chunk words whose rank flag will be 0", () => {
		// The gate can't tell a real fuzzy word from a chunk sitting
		// inside an over-long word — that window check is the rank
		// estimate's job, so WHERE stays a pure superset.
		expect(candidateSemantics("ירושלימ", "אבגדירושאבגד")).toBe(false);
		expect(gateSemantics("ירושלימ", "אבגדירושאבגד")).toBe(true);
		expect(candidateSemantics("ירושלימ", "ירוש לימ")).toBe(false);
		expect(gateSemantics("ירושלימ", "ירוש לימ")).toBe(true);
		expect(gateSemantics("ירושלימ", "ירוש")).toBe(true);
	});

	it("rejects only text that holds no chunk at all", () => {
		expect(gateSemantics("ירושלימ", "אזור")).toBe(false);
		expect(gateSemantics("את", "בגד")).toBe(false);
		// No word anchor: a mid-word chunk still gates a row in —
		// the scorer's `startsWith`/length checks shed it later.
		expect(gateSemantics("את", "באת")).toBe(true);
	});

	it("stays anchor-free even for multi-chunk terms", () => {
		// The gate evals on every scanned row — it must be the bare
		// ordered-letters shape, the only one safe on giant rows.
		const gate = termGateRegexp("ירושלימ");
		expect(gate).not.toContain("(?:^|");
		expect(gate).not.toContain(String.raw`[^\p{L}\p{N}]`);
	});
});

describe("termGateRegexp", () => {
	it("unions the chunks as bare letter patterns — no anchoring or lookaheads", () => {
		// The gate is the whole WHERE predicate — a strict superset of
		// the candidate anchors (every anchor implies an intact chunk)
		// in the only pattern shape a giant field can't make ICU
		// backtrack on (#2140 follow-up).
		const gate = termGateRegexp("ירושלימ");
		expect(gate.startsWith("(?:")).toBe(true);
		for (const letter of "ירושלימ") {
			expect(gate).toContain(letter);
		}
		expect(gate).not.toContain("(?:^|");
		expect(gate).not.toContain("(?=");
		expect(gate).not.toContain("(?!");
	});

	it("collapses to the term's letters for single-chunk terms", () => {
		// No union wrapper and no word anchor — the same bare
		// ordered-letters scan the pre-#2140 WHERE ran.
		expect(termGateRegexp("את").startsWith("א")).toBe(true);
		expect(termGateRegexp("את")).not.toContain("(?:^|");
	});
});

describe("termRankPatterns", () => {
	it("nests exact inside prefix inside the candidate union", () => {
		const [exact, prefix, candidate] = termRankPatterns("ירושלימ");
		// Textual nesting proves match nesting: the exact pattern is the
		// prefix pattern plus a word-end bound, and the candidate union
		// ORs the prefix piece with the chunk pieces — so the weighted
		// rank `10e + 20p + 60f` lands on the scorer's 90/80/60 tiers.
		expect(exact.startsWith(prefix)).toBe(true);
		expect(candidate).toContain(prefix);
		expect(candidate).toBe(termRegexp("ירושלימ"));
	});

	it("collapses the candidate union to the prefix path for short terms", () => {
		const [exact, prefix, candidate] = termRankPatterns("את");
		expect(candidate).toBe(prefix); // edits=0 → single anchor
		expect(exact.startsWith(prefix)).toBe(true);
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
			[termGateRegexp("בראשית"), ...termRankPatterns("בראשית")],
		);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("MAX_EXECUTION_TIME"),
			expect.anything(),
		);
		// The rank estimate's anchored flags run only on the inner
		// location-ordered LIMIT's rows — a dense term's scan
		// early-terminates on idx_note_perek_pasuk and no more than the
		// eval-budget-scaled bound ever pays a flag (#2140 follow-up):
		// 1 field × 3 rank flags ⇒ inner LIMIT 6000/3 = 2000.
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("ORDER BY n.perek_id, n.pasuk"),
			expect.anything(),
		);
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("LIMIT 2000"),
			expect.anything(),
		);
		// Whole-word candidates are ranked before the row cap; a
		// single-term query orders straight by the tier estimate (the
		// phrase flag would repeat the exact flag's pattern).
		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("ORDER BY (10*REGEXP_LIKE"),
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
		// Each term contributes one bare gate eval in WHERE (2 total);
		// ORDER BY adds one phrase-rank flag plus three rank patterns
		// per term inside the LEAST estimate — one LEAST call per
		// ranked fragment, over both terms.
		expect(sql.match(/REGEXP_LIKE\(n\.note_content/g)).toHaveLength(2);
		expect(sql.match(/REGEXP_LIKE\(LEFT\(n2\.note_content/g)).toHaveLength(7);
		expect(sql.match(/LEAST\(/g)).toHaveLength(1);
		expect(params).toEqual([
			termGateRegexp("אחד"),
			termGateRegexp("שני"),
			phraseRegexp(["אחד", "שני"]),
			...termRankPatterns("אחד"),
			...termRankPatterns("שני"),
		]);
	});

	it("ranks each term once per fragment so split chunk words cannot inflate the order", async () => {
		mockQuery.mockResolvedValue([]);
		await searchPerushNotes("ירושלימ", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		// A single word-level estimate per fragment — a row whose words
		// hit different chunks of the term separately (`ירוש לימ`) rates
		// the same as one fuzzy-eligible word instead of stacking anchor
		// flags above it (#2140 review). The estimate is emitted bare:
		// MySQL LEAST requires two arguments, so a single term has none.
		// The third flag is the length-windowed termRegexp — WHERE's
		// bare chunk gate can't distinguish a real fuzzy word from an
		// over-long chunk word, so the window check lives here where
		// only bounded inner rows pay it, on a `LEFT`-bounded slice of
		// the field so no eval can hit `regexp_time_limit` (#2140
		// follow-up).
		expect(sql.match(/LEAST\(/g)).toBeNull();
		expect(sql).toContain(
			"(10*REGEXP_LIKE(LEFT(n2.note_content, 2048), ?, 'i') + 20*REGEXP_LIKE(LEFT(n2.note_content, 2048), ?, 'i') + 60*REGEXP_LIKE(LEFT(n2.note_content, 2048), ?, 'i')) DESC",
		);
		expect(params?.slice(1)).toEqual(termRankPatterns("ירושלימ"));
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
		// generated gate (the WHERE param) encodes a candidate
		// contract that would select the misspelled-relative text.
		expect(params?.[0]).toBe(termGateRegexp("ירושלימ"));
		expect(gateSemantics("ירושלימ", "על ירושלים נאמר")).toBe(true);
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

	it("ORs name and details per term and ranks phrase then tiered term estimates", async () => {
		mockQuery.mockResolvedValue([]);
		await searchAuthors("לוי", 10);
		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain(
			"REGEXP_LIKE(name, ?, 'i') OR REGEXP_LIKE(details, ?, 'i')",
		);
		// Single-term: no separate phrase flag — the estimate's exact
		// flag is the same word-bounded pattern and its 90 tier sorts
		// first anyway. Each flag reads a LEFT-bounded field slice so a
		// giant field can't exhaust regexp_time_limit (#2140 follow-up).
		expect(sql).toContain(
			"ORDER BY (10*REGEXP_LIKE(LEFT(a.name, 2048), ?, 'i') + 20*REGEXP_LIKE(LEFT(a.name, 2048), ?, 'i') + 60*REGEXP_LIKE(LEFT(a.name, 2048), ?, 'i')) DESC, (10*REGEXP_LIKE(LEFT(a.details, 2048), ?, 'i') + 20*REGEXP_LIKE(LEFT(a.details, 2048), ?, 'i') + 60*REGEXP_LIKE(LEFT(a.details, 2048), ?, 'i')) DESC",
		);
		expect(params).toEqual([
			termGateRegexp("לוי"),
			termGateRegexp("לוי"),
			...termRankPatterns("לוי"),
			...termRankPatterns("לוי"),
		]);
	});

	it("selects an author name that is a misspelling of the query", async () => {
		mockQuery.mockResolvedValue([{ id: 7, name: "ירושלים", details: null }]);
		const hits = await searchAuthors("ירושלימ", 10);
		const [, params] = mockQuery.mock.calls[0];
		expect(params?.[0]).toBe(termGateRegexp("ירושלימ"));
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
		expect(params?.[0]).toBe(termGateRegexp("ירושלימ"));
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
		// One bare gate REGEXP_LIKE per searchable field per term in
		// WHERE (title, unique_name, content) plus one inside the
		// synonym EXISTS — four total — then a three-pattern estimate
		// per fragment in ORDER BY rank (single-term: no separate
		// phrase flag — the estimate's exact flag is the same
		// pattern): 4 + 4×3 = 16.
		expect(sql.match(/REGEXP_LIKE\(/g)).toHaveLength(16);
		expect(sql.match(/tanahpedia_entry_synonym/g)?.length).toBeGreaterThan(0);
		expect(params).toEqual([
			termGateRegexp("משה"),
			termGateRegexp("משה"),
			termGateRegexp("משה"),
			termGateRegexp("משה"),
			...termRankPatterns("משה"),
			...termRankPatterns("משה"),
			...termRankPatterns("משה"),
			...termRankPatterns("משה"),
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
		// generated gate's contract would select the misspelled title.
		expect(params?.[0]).toBe(termGateRegexp("ירושלימ"));
		expect(candidateSemantics("ירושלימ", "ירושלים")).toBe(true);
		expect(gateSemantics("ירושלימ", "ירושלים")).toBe(true);
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
