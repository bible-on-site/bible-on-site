import type { PoolConnection } from "mysql2/promise";
import {
	type Contribution,
	type Evidence,
	sameState,
} from "~/lib/tanahpedia/contributions";
import { readArticleLinkContext } from "./contribution-article-links.server";

/** Structured spans refer to the exact plain-text name/abstract/content join.
 * Free text remains untouched. Only an exact surviving quote can be relocated;
 * ambiguous or removed evidence requires a human to repair the same PR. */
export async function refreshArticleLinkEvidence(
	conn: PoolConnection,
	item: Pick<Contribution, "changes" | "evidence">,
): Promise<Evidence[]> {
	const articleIds = [
		...new Set(
			item.evidence.flatMap((e) =>
				e.articleSource ? [e.articleSource.articleId] : [],
			),
		),
	].sort((a, b) => Number(a) - Number(b));
	const result = structuredClone(item.evidence);
	for (const id of articleIds) {
		if (
			!item.changes.some((c) => c.kind === "article_links" && c.targetId === id)
		)
			throw new Error(
				"Structured article evidence must cite the proposed article",
			);
		const context = await readArticleLinkContext(conn, id, { current: true });
		for (const evidence of result) {
			const source = evidence.articleSource;
			if (!source || source.articleId !== id) continue;
			let start = source.spanStart;
			if (
				context.plainText.slice(source.spanStart, source.spanEnd) !==
				evidence.quote
			) {
				start = context.plainText.indexOf(evidence.quote);
				if (
					start < 0 ||
					start !== context.plainText.lastIndexOf(evidence.quote)
				)
					throw new Error(
						"Structured article evidence no longer identifies one exact quote. Repair its source in this PR.",
					);
			}
			evidence.articleSource = {
				articleId: id,
				spanStart: start,
				spanEnd: start + evidence.quote.length,
				contentHash: context.state.contentHash,
				sourceHash: context.state.sourceHash,
			};
		}
	}
	return sameState(result, item.evidence) ? item.evidence : result;
}
