/**
 * The admin's caller for the typed article-relationship write path (#3102):
 * `updateArticleRelationships` over the API's GraphQL endpoint, authorized
 * with `ARTICLE_API_KEY`. The link-proposal pipeline's apply step (#3103)
 * goes through here — never a private SQL shortcut — so every approved
 * write gets the contract's row lock, freshness checks, audit source and
 * website invalidation in one transaction.
 *
 * Configured by `ARTICLE_API_URL` (default http://localhost:3003 — the
 * GraphQL endpoint is POST /) and `ARTICLE_API_KEY` (server-only secret;
 * never a VITE_* variable, which Vite inlines into the browser bundle).
 */
import type { ArticleRelationshipsMutationInput } from "~/lib/article-linking/merge";
import type { PasukCoordinate } from "~/lib/article-linking/types";
import { canonicalJson } from "~/lib/canonical-json";

export interface ApiArticleRelationships {
	perekId: number;
	authorId: number;
	coverageVerified: boolean;
	contentHash: string;
	coveringSources: PasukCoordinate[];
}

export interface UpdateRelationshipsResult {
	relationships: ApiArticleRelationships;
	previous: ApiArticleRelationships;
	/** APPLIED | FAILED | SKIPPED — from the API's invalidation outcome. */
	revalidation: string;
}

const MUTATION = `mutation UpdateArticleRelationships($articleId: Int!, $input: UpdateArticleRelationshipsInput!) {
	updateArticleRelationships(articleId: $articleId, input: $input) {
		revalidation
		relationships { perekId authorId coverageVerified contentHash coveringSources { perekId pasuk } }
		previous { perekId authorId coverageVerified contentHash coveringSources { perekId pasuk } }
	}
}`;

function apiBase(): string {
	return (process.env.ARTICLE_API_URL ?? "http://localhost:3003").replace(
		/\/+$/,
		"",
	);
}

export function articleApiConfigured(): boolean {
	return Boolean(process.env.ARTICLE_API_KEY?.trim());
}

async function graphql<T>(
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const key = process.env.ARTICLE_API_KEY?.trim();
	if (!key) {
		throw new Error(
			"ARTICLE_API_KEY אינו מוגדר - החלת שינויי קשרים דורשת את נתיב ה-API המאומת",
		);
	}
	const res = await fetch(apiBase(), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: canonicalJson({ query, variables }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(
			`relationship API HTTP ${res.status}: ${text.slice(0, 400)}`,
		);
	}
	const body = (await res.json()) as {
		data?: T;
		errors?: Array<{ message?: string }>;
	};
	if (body.errors?.length || body.data === undefined || body.data === null) {
		throw new Error(
			`relationship API error: ${body.errors?.map((e) => e.message).join("; ") ?? "no data"}`,
		);
	}
	return body.data;
}

/** Reads the article's live relationship state through the contract. */
export async function fetchArticleRelationships(
	articleId: number,
): Promise<ApiArticleRelationships | null> {
	const data = await graphql<{
		articleRelationships: ApiArticleRelationships | null;
	}>(
		`query Relationships($articleId: Int!) {
			articleRelationships(articleId: $articleId) {
				perekId authorId coverageVerified contentHash
				coveringSources { perekId pasuk }
			}
		}`,
		{ articleId },
	);
	return data.articleRelationships;
}

/** Applies one approved patch through the shared mutation. */
export async function updateArticleRelationships(
	articleId: number,
	input: ArticleRelationshipsMutationInput,
): Promise<UpdateRelationshipsResult> {
	const data = await graphql<{
		updateArticleRelationships: UpdateRelationshipsResult;
	}>(MUTATION, { articleId, input });
	return data.updateArticleRelationships;
}
