import { createServerFn } from "@tanstack/react-start";
import { isCoveringSourceSchemaMissing } from "./covering-sources";
import { query, queryOne } from "./db";

/**
 * Article-relationship management reads (#3102) — the admin projection of
 * `web/shared/article-relationships/registry.json`. The article form already
 * owns the single-valued fields (primaryPerek, author) and the covering
 * set; this function supplies the remaining managed links plus the
 * freshness token, so the panel can render every registry entry from one
 * call. Shapes mirror the API's `articleRelationships` field — same SQL,
 * same semantics — so admin and API consumers see one contract.
 */

/** One article-scoped dedication assignment (management view — all states). */
export interface ArticleDedicationLink {
	dedicationId: number;
	/** The dedication row's subject; null when the row is gone. */
	subject: string | null;
	/** Assignment-level expiry ("YYYY-MM-DD HH:mm:ss" UTC); null = ongoing. */
	expiresAt: string | null;
	/** Whole-dedication expiry; distinct from the assignment-level one. */
	dedicationExpiresAt: string | null;
}

/**
 * One stored mention annotation over the article body — pipeline-owned,
 * read-only here by contract (writes live in the import tooling).
 */
export interface ArticleMentionAnnotation {
	id: string;
	intendedName: string;
	entityType: string;
	disambiguation: string | null;
	confidence: string | null;
	acceptance: string;
	modelRevision: string;
	spanStart: number | null;
	spanEnd: number | null;
	surface: string;
	contentHash: string | null;
	/**
	 * Whether the annotation's content hash still matches the live article
	 * body — the same staleness check the public website applies.
	 */
	currentContent: boolean;
}

export interface ArticleRelationshipDetails {
	articleId: number;
	/**
	 * Lowercase hex of the article's generated content_hash — the freshness
	 * token the API's updateArticleRelationships expects back as
	 * expectedContentHash. Empty when the column is not deployed.
	 */
	contentHash: string;
	dedications: ArticleDedicationLink[];
	/**
	 * The moadim explicitly linked to the article (#3101); `undefined`
	 * when the moed schema is not deployed — never "linked to nothing".
	 */
	moadim?: { id: number; slug: string; name: string }[];
	/**
	 * Stored mention annotations; `undefined` when the annotation schema is
	 * not deployed — never "the article has no annotations".
	 */
	mentionAnnotations?: ArticleMentionAnnotation[];
}

interface MentionRow {
	id: string;
	intended_name: string;
	entity_type: string;
	disambiguation: string | null;
	confidence: string | null;
	acceptance: string;
	model_revision: string;
	span_start: number | null;
	span_end: number | null;
	surface: string;
	content_hash: string | null;
	current_content: number;
}

/** Aggregates the non-form relationship state for one article. */
export const getArticleRelationshipDetails = createServerFn({ method: "GET" })
	.validator((data: number) => data)
	.handler(async ({ data: articleId }): Promise<ArticleRelationshipDetails> => {
		const exists = await queryOne<{ id: number }>(
			"SELECT id FROM tanah_article WHERE id = ?",
			[articleId],
		);
		if (!exists) {
			throw new Error("Article not found");
		}

		let contentHash = "";
		try {
			const row = await queryOne<{ h: string | null }>(
				"SELECT HEX(content_hash) AS h FROM tanah_article WHERE id = ?",
				[articleId],
			);
			contentHash = (row?.h ?? "").toLowerCase();
		} catch (error) {
			// Pre-upgrade database without the generated column.
			if (!isCoveringSourceSchemaMissing(error)) throw error;
		}

		const dedications = (
			await query<{
				dedication_id: number;
				subject: string | null;
				expires_at: string | null;
				dedication_expires_at: string | null;
			}>(
				`SELECT ad.dedication_id, d.subject,
				        CAST(ad.expires_at AS CHAR) AS expires_at,
				        CAST(d.expires_at AS CHAR) AS dedication_expires_at
				 FROM tanah_article_dedication ad
				 LEFT JOIN tanah_dedication d ON d.id = ad.dedication_id
				 WHERE ad.article_id = ?
				 ORDER BY ad.dedication_id`,
				[articleId],
			)
		).map((row) => ({
			dedicationId: row.dedication_id,
			subject: row.subject,
			expiresAt: row.expires_at,
			dedicationExpiresAt: row.dedication_expires_at,
		}));

		let mentionAnnotations: ArticleMentionAnnotation[] | undefined;
		try {
			mentionAnnotations = (
				await query<MentionRow>(
					`SELECT d.id, d.intended_name, d.entity_type, d.disambiguation,
					        CAST(d.confidence AS CHAR) AS confidence,
					        d.acceptance, d.model_revision, d.span_start, d.span_end,
					        d.surface, d.content_hash,
					        (d.content_hash IS NOT NULL AND d.content_hash = LOWER(SHA2(IFNULL(a.content, ''), 256))) AS current_content
					 FROM tanahpedia_mention_decoration d
					 JOIN tanah_article a ON a.id = d.article_id
					 WHERE d.source_kind = 'article' AND d.article_id = ?
					 ORDER BY d.span_start`,
					[articleId],
				)
			).map((row) => ({
				id: row.id,
				intendedName: row.intended_name,
				entityType: row.entity_type,
				disambiguation: row.disambiguation,
				confidence: row.confidence,
				acceptance: row.acceptance,
				modelRevision: row.model_revision,
				spanStart: row.span_start,
				spanEnd: row.span_end,
				surface: row.surface,
				contentHash: row.content_hash,
				currentContent: row.current_content !== 0,
			}));
		} catch (error) {
			// Annotation pipeline schema not deployed — the panel shows the
			// relationship as unavailable rather than empty.
			if (!isCoveringSourceSchemaMissing(error)) throw error;
		}

		let moadim: { id: number; slug: string; name: string }[] | undefined;
		try {
			moadim = await query<{ id: number; slug: string; name: string }>(
				`SELECT m.id, m.slug, m.name
				 FROM tanah_article_moed am
				 JOIN tanah_moed m ON m.id = am.moed_id
				 WHERE am.article_id = ? ORDER BY m.annual_order`,
				[articleId],
			);
		} catch (error) {
			// Moed schema not deployed — unavailable, not empty.
			if (!isCoveringSourceSchemaMissing(error)) throw error;
		}

		return {
			articleId,
			contentHash,
			dedications,
			moadim,
			mentionAnnotations,
		};
	});
