/**
 * In-memory search corpus built from the bundled Tanah text
 * (`src/data/db/sefaria-dump-*.tanah_view.json`), which the server already
 * keeps in memory for perek pages. Perakim and pesukim indexes are built
 * lazily on first search and cached on `globalThis` for the process lifetime
 * (same pattern as `sefarim.ts`), so hot reloads in dev don't rebuild it.
 */

import { toLetters } from "gematry";
import { getPerekByPerekId } from "@/data/perek-dto";
import { sefarim } from "@/data/db/sefarim";
import { pasukPlainText } from "@/lib/tanach/pasuk-plain-text";
import { normalizeSearchText } from "./normalize";
import { scoreNormalizedText } from "./score";

export const TOTAL_PERAKIM = 929;

export interface PerekIndexEntry {
	perekId: number;
	/** Canonical display source, e.g. "בראשית לב", "שמואל ב ה". */
	source: string;
	header: string;
	normalizedSource: string;
	normalizedHeader: string;
}

export interface PasukIndexEntry {
	perekId: number;
	pasukNum: number;
	/** Plain (vocalized) pasuk text for display/snippets. */
	text: string;
	normalized: string;
	/** Canonical reference, e.g. "בראשית לב כג". */
	reference: string;
}

const corpusKey = Symbol.for("bible-on-site.search-corpus");
const server = globalThis as typeof globalThis & {
	[corpusKey]?: {
		perakim?: PerekIndexEntry[];
		pesukim?: PasukIndexEntry[];
	};
};
const cache = server[corpusKey] ?? {};
server[corpusKey] = cache;

export function getPerekIndex(): PerekIndexEntry[] {
	if (!cache.perakim) {
		const entries: PerekIndexEntry[] = [];
		for (let perekId = 1; perekId <= TOTAL_PERAKIM; perekId++) {
			const perek = getPerekByPerekId(perekId);
			entries.push({
				perekId,
				source: perek.source,
				header: perek.header,
				normalizedSource: normalizeSearchText(perek.source),
				normalizedHeader: normalizeSearchText(perek.header),
			});
		}
		cache.perakim = entries;
	}
	return cache.perakim;
}

export function getPasukIndex(): PasukIndexEntry[] {
	if (!cache.pesukim) {
		const entries: PasukIndexEntry[] = [];
		for (const sefer of sefarim) {
			const books = "additionals" in sefer ? sefer.additionals : [sefer];
			for (const book of books) {
				book.perakim.forEach((perek, perekIdx) => {
					const perekId = book.perekFrom + perekIdx;
					const { source } = getPerekByPerekId(perekId);
					perek.pesukim.forEach((pasuk, pasukIdx) => {
						const pasukNum = pasukIdx + 1;
						const text = pasukPlainText(pasuk);
						entries.push({
							perekId,
							pasukNum,
							text,
							normalized: normalizeSearchText(text),
							reference: `${source} ${toLetters(pasukNum)}`,
						});
					});
				});
			}
		}
		cache.pesukim = entries;
	}
	return cache.pesukim;
}

/**
 * Rewrite numeric words in the query as Hebrew letters, so "בראשית 1"
 * matches the canonical source "בראשית א" (mirrors the app).
 */
export function referenceQuery(query: string): string {
	return normalizeSearchText(query)
		.split(" ")
		.map((word) => {
			const number = Number.parseInt(word, 10);
			return Number.isInteger(number) && number > 0 && number <= TOTAL_PERAKIM
				? toLetters(number)
				: word;
		})
		.join(" ");
}

export interface Scored<T> {
	entry: T;
	score: number;
}

/** Search perakim by canonical source ("בראשית לב") and header text. */
export function searchPerakim(query: string, limit: number): Scored<PerekIndexEntry>[] {
	const ref = referenceQuery(query);
	const phrase = normalizeSearchText(query);
	return getPerekIndex()
		.map((entry) => ({
			entry,
			score: Math.max(
				scoreNormalizedText(entry.normalizedSource, ref),
				scoreNormalizedText(entry.normalizedHeader, phrase),
			),
		}))
		.filter((hit) => hit.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score || left.entry.perekId - right.entry.perekId,
		)
		.slice(0, limit);
}

/** Search all pesukim by (normalized) text. */
export function searchPesukim(query: string, limit: number): Scored<PasukIndexEntry>[] {
	return getPasukIndex()
		.map((entry) => ({
			entry,
			score: scoreNormalizedText(entry.normalized, query),
		}))
		.filter((hit) => hit.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.entry.perekId - right.entry.perekId ||
				left.entry.pasukNum - right.entry.pasukNum,
		)
		.slice(0, limit);
}
