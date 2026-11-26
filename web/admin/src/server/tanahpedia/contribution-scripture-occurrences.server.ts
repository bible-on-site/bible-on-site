import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toHebrewLetters } from "../../utils/hebrew";

export interface ScriptureOccurrence {
	perekId: number;
	pasukNumber: number;
	/** Zero-based inclusive indexes into the canonical segment array. */
	segmentStart: number;
	segmentEnd: number;
	text: string;
}

type CitedOccurrence = ScriptureOccurrence & { citation: string };
type SearchInput = {
	spellings: readonly string[];
	book?: string;
	cursor?: number;
	limit?: number;
};

type CorpusVerse = {
	segments: readonly { type: string; value?: string }[];
};
type CorpusVolume = {
	name: string;
	perekFrom: number;
	perakim: readonly { pesukim: readonly CorpusVerse[] }[];
};
type CorpusBook = CorpusVolume & { additionals?: readonly CorpusVolume[] };

// Keep the positions of structural segments and the distinction between qri
// and ktiv. Only the spoken text, written alternatives and coordinates are
// needed by admin; audio timing and other source metadata stay in the corpus.
type Segment = string | [written: string] | null;
type Chapter = {
	perekId: number;
	book: string;
	chapter: number;
	verses: Segment[][];
};

export function packScriptureCorpus(books: readonly CorpusBook[]): Chapter[] {
	return books.flatMap((book) =>
		(book.additionals ?? [book]).flatMap((volume) =>
			volume.perakim.map((perek, i) => ({
				perekId: volume.perekFrom + i,
				book: volume.name,
				chapter: i + 1,
				verses: perek.pesukim.map(({ segments }) =>
					segments.map(({ type, value }) => {
						if (!value) return null;
						if (type === "qri") return value;
						if (type === "ktiv") return [value];
						return null;
					}),
				),
			})),
		),
	);
}

const consonants = (word: string) =>
	word.normalize("NFKD").replace(/[^א-ת]/gu, "");
const surface = (segment: Segment) =>
	typeof segment === "string" ? segment : (segment?.[0] ?? "");
const keyOf = (value: ScriptureOccurrence) =>
	`${value.perekId}:${value.pasukNumber}:${value.segmentStart}:${value.segmentEnd}`;

function joinSegments(words: readonly string[]): string {
	return words.reduce(
		(text, word) =>
			text && !text.endsWith("־") ? `${text} ${word}` : text + word,
		"",
	);
}

function spokenText(verse: readonly Segment[]) {
	return joinSegments(
		verse.filter((value): value is string => typeof value === "string"),
	);
}

function assertPage(cursor: number, limit: number, maximum: number) {
	if (
		!Number.isSafeInteger(cursor) ||
		cursor < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > maximum
	)
		throw new Error("Invalid Scripture page");
}

function parseSpellings(spellings: readonly string[]): string[][] {
	if (
		!Array.isArray(spellings) ||
		spellings.length < 1 ||
		spellings.length > 16
	)
		throw new Error("Supply 1-16 Hebrew place spellings");
	return spellings.map((spelling) => {
		if (
			typeof spelling !== "string" ||
			spelling.length > 160 ||
			!/^[\u0591-\u05c7א-ת\s-]+$/u.test(spelling)
		)
			throw new Error("A place spelling must contain only Hebrew words");
		const words = spelling
			.trim()
			.split(/[\s־-]+/u)
			.map(consonants);
		if (words.length > 8 || words.some((word) => !word))
			throw new Error("A place spelling must contain 1-8 Hebrew words");
		return words;
	});
}

type Posting = { chapter: Chapter; verse: number; segment: number };
type IndexedOccurrence = CitedOccurrence & { verseText: string };

function cite(chapter: Chapter, pasuk: number) {
	return `${chapter.book} ${toHebrewLetters(chapter.chapter)} ${toHebrewLetters(pasuk)}`;
}

function selectedText(verse: readonly Segment[], start: number, end: number) {
	const segments = verse.slice(start, end + 1);
	if (segments.some((segment) => !surface(segment))) return null;
	for (let i = 0; i < segments.length - 1; i++) {
		// Ktiv and qri alternatives are consecutive in the source but do not
		// form two successive words. Keep each available as its own anchor.
		if (Array.isArray(segments[i])) return null;
	}
	return joinSegments(segments.map(surface));
}

export function createScriptureOccurrenceIndex(chapters: readonly Chapter[]) {
	const byPerek = new Map(
		chapters.map((chapter) => [chapter.perekId, chapter]),
	);
	const books = new Set(chapters.map((chapter) => chapter.book));
	const words = new Map<string, Posting[]>();
	for (const chapter of chapters) {
		for (const [verse, segments] of chapter.verses.entries()) {
			for (const [segment, value] of segments.entries()) {
				const word = consonants(surface(value));
				if (!word) continue;
				const entries = words.get(word) ?? [];
				entries.push({ chapter, verse, segment });
				words.set(word, entries);
			}
		}
	}

	function search({ spellings, book, cursor = 0, limit = 20 }: SearchInput): {
		items: IndexedOccurrence[];
		total: number;
		nextCursor: number | null;
	} {
		const forms = parseSpellings(spellings);
		if (book !== undefined && !books.has(book))
			throw new Error("Unknown Hebrew scripture book name");
		assertPage(cursor, limit, 100);
		const matches = new Map<
			string,
			{ match: CitedOccurrence; verse: Segment[] }
		>();
		for (const [word, postings] of words) {
			for (const form of forms) {
				// The historical Jerusalem importer searches these overt
				// prefixes. This yields candidates, not semantic identities.
				if (
					!word.endsWith(form[0]) ||
					!/^[ובכלמשה]*$/u.test(word.slice(0, -form[0].length))
				)
					continue;
				for (const posting of postings) {
					const { chapter, verse: verseIndex, segment } = posting;
					if (book !== undefined && chapter.book !== book) continue;
					const verse = chapter.verses[verseIndex];
					const end = segment + form.length - 1;
					if (end >= verse.length) continue;
					if (
						form
							.slice(1)
							.some(
								(token, i) =>
									consonants(surface(verse[segment + i + 1])) !== token,
							)
					)
						continue;
					const text = selectedText(verse, segment, end);
					if (!text) continue;
					const match = {
						perekId: chapter.perekId,
						pasukNumber: verseIndex + 1,
						segmentStart: segment,
						segmentEnd: end,
						text,
						citation: cite(chapter, verseIndex + 1),
					};
					matches.set(keyOf(match), { match, verse });
				}
			}
		}
		const ordered = [...matches.values()].sort(
			({ match: a }, { match: b }) =>
				a.perekId - b.perekId ||
				a.pasukNumber - b.pasukNumber ||
				a.segmentStart - b.segmentStart ||
				a.segmentEnd - b.segmentEnd,
		);
		return {
			items: ordered.slice(cursor, cursor + limit).map(({ match, verse }) => ({
				...match,
				verseText: spokenText(verse),
			})),
			total: ordered.length,
			nextCursor: cursor + limit < ordered.length ? cursor + limit : null,
		};
	}

	function readChapter(perekId: number, cursor = 0, limit = 10) {
		assertPage(cursor, limit, 25);
		const chapter = byPerek.get(perekId);
		if (!chapter) throw new Error("Unknown canonical Scripture chapter");
		const total = chapter.verses.length;
		return {
			perekId,
			book: chapter.book,
			chapter: chapter.chapter,
			citation: `${chapter.book} ${toHebrewLetters(chapter.chapter)}`,
			items: chapter.verses
				.slice(cursor, cursor + limit)
				.map((verse, offset) => {
					const pasukNumber = cursor + offset + 1;
					return {
						pasukNumber,
						citation: cite(chapter, pasukNumber),
						text: spokenText(verse),
					};
				}),
			total,
			nextCursor: cursor + limit < total ? cursor + limit : null,
		};
	}

	function validate(
		occurrences: readonly ScriptureOccurrence[],
	): CitedOccurrence[] {
		if (!Array.isArray(occurrences) || occurrences.length > 1600)
			throw new Error(
				"At most 1600 scripture occurrences can be reviewed together",
			);
		const seen = new Set<string>();
		return occurrences.map(
			({ perekId, pasukNumber, segmentStart, segmentEnd, text }) => {
				const chapter = byPerek.get(perekId);
				const verse = chapter?.verses[pasukNumber - 1];
				if (
					!chapter ||
					!Number.isSafeInteger(pasukNumber) ||
					!verse ||
					!Number.isSafeInteger(segmentStart) ||
					!Number.isSafeInteger(segmentEnd) ||
					segmentStart < 0 ||
					segmentEnd < segmentStart ||
					segmentEnd >= verse.length ||
					!text ||
					selectedText(verse, segmentStart, segmentEnd) !== text
				)
					throw new Error(
						"Scripture occurrence does not match the exact canonical word span",
					);
				const match = {
					perekId,
					pasukNumber,
					segmentStart,
					segmentEnd,
					text,
					citation: cite(chapter, pasukNumber),
				};
				const key = keyOf(match);
				if (seen.has(key)) throw new Error("Duplicate scripture occurrence");
				seen.add(key);
				return match;
			},
		);
	}

	return { search, validate, readChapter };
}

const corpusName = "sefaria-dump-5784-sivan-4.tanah_view.json";

async function loadIndex() {
	const packedPath = resolve("scripture-occurrences.json");
	try {
		const content = await readFile(packedPath, "utf8");
		return createScriptureOccurrenceIndex(JSON.parse(content) as Chapter[]);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	// Dev, local tests and local builds can read the same tracked corpus
	// directly. Container builds install the compact corpus above.
	const corpusPath = resolve("../bible-on-site/src/data/db", corpusName);
	const books = JSON.parse(await readFile(corpusPath, "utf8")) as CorpusBook[];
	return createScriptureOccurrenceIndex(packScriptureCorpus(books));
}

let index: ReturnType<typeof loadIndex> | undefined;
function scriptureIndex() {
	index ??= loadIndex().catch((error) => {
		index = undefined;
		throw error;
	});
	return index;
}

export async function searchScriptureOccurrences(input: SearchInput) {
	return (await scriptureIndex()).search(input);
}

export async function readScriptureChapter(
	perekId: number,
	cursor?: number,
	limit?: number,
) {
	return (await scriptureIndex()).readChapter(perekId, cursor, limit);
}

export async function validateScriptureOccurrences(
	occurrences: readonly ScriptureOccurrence[],
): Promise<CitedOccurrence[]> {
	return (await scriptureIndex()).validate(occurrences);
}
