/**
 * Search orchestrator: fans a query out to every requested provider and
 * normalizes the per-provider hits into the shared SearchResultItem
 * contract. A provider failure is degraded (that type is skipped and a
 * notice is recorded) rather than failing the whole search — perushim and
 * articles need MySQL, perakim/pesukim are always available.
 */

import {
	searchArticles,
	searchAuthors,
	searchPerushNotes,
	perushHitReference,
} from "./db-content";
import { normalizeSearchText } from "./normalize";
import { searchPerakim, searchPesukim } from "./corpus";
import { searchSnippet } from "./snippet";
import type {
	SearchResponse,
	SearchResultItem,
	SearchResultType,
} from "./types";
import {
	SEARCH_LIMIT_DEFAULT,
	SEARCH_LIMIT_MAX,
	SEARCH_QUERY_MAX_CHARS,
	SEARCH_QUERY_MAX_TERMS,
} from "./types";

const AVAILABILITY_MESSAGES: Record<SearchResultType, string> = {
	perek: "חיפוש הפרקים אינו זמין כרגע",
	pasuk: "חיפוש הפסוקים אינו זמין כרגע",
	perush: "חיפוש הפירושים אינו זמין כרגע",
	author: "חיפוש הרבנים אינו זמין כרגע",
	article: "חיפוש המאמרים אינו זמין כרגע",
};

export interface SearchOptions {
	limit?: number;
	signal?: AbortSignal;
}

export async function searchSite(
	query: string,
	types: SearchResultType[],
	options: SearchOptions = {},
): Promise<SearchResponse> {
	const phrase = normalizeSearchText(query).slice(0, SEARCH_QUERY_MAX_CHARS);
	const limit = Math.min(
		Math.max(Math.trunc(options.limit ?? SEARCH_LIMIT_DEFAULT), 1),
		SEARCH_LIMIT_MAX,
	);
	const termCount = phrase ? phrase.split(" ").length : 0;
	const response: SearchResponse = {
		query: phrase,
		types,
		results: [],
		counts: {},
		availability: [],
	};
	if (!phrase || termCount > SEARCH_QUERY_MAX_TERMS || types.length === 0) {
		return response;
	}

	const add = (type: SearchResultType, items: SearchResultItem[]) => {
		response.results.push(...items);
		response.counts[type] = items.length;
	};
	const fail = (type: SearchResultType, error: unknown) => {
		console.warn(
			`[search] ${type} provider failed:`,
			error instanceof Error ? error.message : error,
		);
		response.availability.push(AVAILABILITY_MESSAGES[type]);
	};

	// In-memory providers run synchronously; DB providers are async. Run
	// everything concurrently so total latency is the slowest provider.
	const tasks: Promise<void>[] = [];
	if (types.includes("perek")) {
		try {
			add(
				"perek",
				searchPerakim(phrase, limit).map(({ entry, score }) => ({
					type: "perek" as const,
					title: entry.source,
					snippetHtml: searchSnippet(entry.header, phrase),
					href: `/929/${entry.perekId}`,
					score,
				})),
			);
		} catch (error) {
			fail("perek", error);
		}
	}
	if (types.includes("pasuk")) {
		try {
			add(
				"pasuk",
				searchPesukim(phrase, limit).map(({ entry, score }) => ({
					type: "pasuk" as const,
					title: entry.reference,
					snippetHtml: searchSnippet(entry.text, phrase),
					href: `/929/${entry.perekId}#pasuk-${entry.pasukNum}`,
					score,
				})),
			);
		} catch (error) {
			fail("pasuk", error);
		}
	}
	if (types.includes("perush")) {
		tasks.push(
			searchPerushNotes(phrase, limit)
				.then((hits) =>
					add(
						"perush",
						hits.map(({ entry, score }) => ({
							type: "perush" as const,
							title: perushHitReference(entry),
							snippetHtml: searchSnippet(entry.plain, phrase),
							href: `/929/${entry.perekId}/${encodeURIComponent(entry.perushName)}?pasuk=${entry.pasukNum}`,
							score,
						})),
					),
				)
				.catch((error) => fail("perush", error)),
		);
	}
	if (types.includes("author")) {
		tasks.push(
			searchAuthors(phrase, limit)
				.then((hits) =>
					add(
						"author",
						hits.map(({ entry, score }) => ({
							type: "author" as const,
							title: entry.name,
							snippetHtml: searchSnippet(entry.details, phrase),
							// authorNameToSlug already percent-encodes the slug.
							href: `/929/authors/${entry.slug}`,
							score,
						})),
					),
				)
				.catch((error) => fail("author", error)),
		);
	}
	if (types.includes("article")) {
		tasks.push(
			searchArticles(phrase, limit)
				.then((hits) =>
					add(
						"article",
						hits.map(({ entry, score }) => ({
							type: "article" as const,
							title: `${entry.name} - ${entry.authorName}`,
							snippetHtml: searchSnippet(entry.plain, phrase),
							href: `/929/${entry.perekId}/${entry.id}`,
							score,
						})),
					),
				)
				.catch((error) => fail("article", error)),
		);
	}
	await Promise.all(tasks);
	return response;
}
