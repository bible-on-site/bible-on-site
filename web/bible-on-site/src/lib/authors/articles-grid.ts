import type { AuthorArticle } from "./types";

/**
 * An author article enriched with display fields resolved from the perek DTO.
 * `source` is the full citation (e.g. "בראשית א"), `sefer` the sefer name.
 */
export interface AuthorArticleRow extends AuthorArticle {
	sefer: string;
	source: string;
}

export type ArticleSortKey = "name" | "sefer" | "perek";
export type SortDirection = "asc" | "desc";

export interface ArticleSort {
	key: ArticleSortKey;
	direction: SortDirection;
}

export const DEFAULT_ARTICLE_SORT: ArticleSort = {
	key: "perek",
	direction: "asc",
};

const hebrewCollator = new Intl.Collator("he");

/**
 * Distinct sefarim present in the rows, in canonical Tanah order
 * (ordered by each sefer's lowest perekId).
 */
export function distinctSefarim(rows: AuthorArticleRow[]): string[] {
	const firstPerek = new Map<string, number>();
	for (const row of rows) {
		const current = firstPerek.get(row.sefer);
		if (current === undefined || row.perekId < current) {
			firstPerek.set(row.sefer, row.perekId);
		}
	}
	return [...firstPerek.entries()]
		.sort((a, b) => a[1] - b[1])
		.map(([sefer]) => sefer);
}

const HTML_TAG_PATTERN = /<[^>]*>/g;

/**
 * Case-insensitive substring search over name, abstract and source,
 * combined with an optional sefer filter. The abstract is HTML, so its
 * tags are stripped to match only visible text.
 */
export function filterAuthorArticles(
	rows: AuthorArticleRow[],
	search: string,
	sefer: string,
): AuthorArticleRow[] {
	const needle = search.trim().toLowerCase();
	return rows.filter((row) => {
		if (sefer !== "" && row.sefer !== sefer) return false;
		if (needle === "") return true;
		return [
			row.name,
			(row.abstract ?? "").replace(HTML_TAG_PATTERN, " "),
			row.source,
		].some((field) => field.toLowerCase().includes(needle));
	});
}

/**
 * Sort by the given key. "sefer" sorts by canonical sefer order
 * (the sefer's lowest perekId) then by perek within the sefer.
 */
export function sortAuthorArticles(
	rows: AuthorArticleRow[],
	sort: ArticleSort,
): AuthorArticleRow[] {
	const direction = sort.direction === "asc" ? 1 : -1;
	const seferRank = new Map<string, number>();
	if (sort.key === "sefer") {
		for (const sefer of distinctSefarim(rows)) {
			seferRank.set(sefer, seferRank.size);
		}
	}
	return [...rows].sort((a, b) => {
		let cmp: number;
		switch (sort.key) {
			case "name":
				cmp = hebrewCollator.compare(a.name, b.name);
				break;
			case "sefer":
				cmp =
					(seferRank.get(a.sefer) ?? 0) - (seferRank.get(b.sefer) ?? 0) ||
					a.perekId - b.perekId;
				break;
			case "perek":
				cmp = a.perekId - b.perekId;
				break;
		}
		// Stable tiebreaker so equal keys keep deterministic order
		return cmp * direction || a.id - b.id;
	});
}
