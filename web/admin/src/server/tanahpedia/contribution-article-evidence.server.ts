import { createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { canonicalJson } from "~/lib/canonical-json";
import { expandLiteralCitationCoordinates } from "~/lib/tanahpedia/contribution-article-grounding";
import { validateArticleLinkChange } from "~/lib/tanahpedia/contribution-article-links";
import {
	type ChangeInput,
	type Contribution,
	type Evidence,
	type ReviewedChange,
	sameState,
	validateEvidence,
} from "~/lib/tanahpedia/contributions";
import { readArticleLinkContext } from "./contribution-article-links.server";
import type { ModelCatalogue } from "./contribution-llm.server";
import { readAgentPerek } from "./contribution-perek-reads.server";

/** Attach only exact, source-backed citation spans returned by this job's reads.
 * The model selects operations; it never authors these quotations or hashes. */
export async function appendAgentArticleEvidence(
	conn: PoolConnection,
	changes: readonly (ChangeInput | ReviewedChange)[],
	catalogue: ModelCatalogue,
	evidence: Evidence[],
): Promise<Evidence[]> {
	const currentEvidence = await refreshArticleLinkEvidence(conn, {
		changes,
		evidence,
	});
	const result = [...currentEvidence];
	const key = (source: Evidence) =>
		source.articleSource &&
		canonicalJson([
			source.articleSource.articleId,
			source.articleSource.spanStart,
			source.articleSource.spanEnd,
			source.quote,
		]);
	const seen = new Set(currentEvidence.map(key).filter(Boolean));
	const chapters = new Map<number, string>();
	const articles = changes
		.filter((change) => change.kind === "article_links")
		.sort((a, b) => Number(a.targetId) - Number(b.targetId));
	for (const raw of articles) {
		const change = validateArticleLinkChange({
			kind: raw.kind,
			targetId: raw.targetId,
			after: raw.after,
		});
		const points = change.after.commands.flatMap((command) =>
			command.relationshipKey === "coveringSources" &&
			(command.action === "add" || command.action === "replace")
				? command.target.pasukCoordinates
				: [],
		);
		if (!points.length) continue;
		const wanted = new Set(
			points.map((point) => `${point.perekId}:${point.pasuk}`),
		);
		const groundings = (catalogue.articleGroundings ?? []).flatMap(
			(grounding) =>
				grounding.articleId === change.targetId && grounding.citations?.length
					? [{ ...grounding, citations: grounding.citations }]
					: [],
		);
		if (!groundings.length) continue;
		const article = await readArticleLinkContext(conn, change.targetId, {
			current: true,
		});
		for (const grounding of groundings) {
			if (grounding.sourceHash !== article.state.sourceHash)
				throw new Error(
					"The article source changed before attaching its evidence",
				);
			for (const citation of grounding.citations) {
				if (
					!expandLiteralCitationCoordinates([citation]).some((point) =>
						wanted.has(`${point.perekId}:${point.pasuk}`),
					)
				)
					continue;
				if (
					article.plainText.slice(citation.spanStart, citation.spanEnd) !==
					citation.quote
				)
					throw new Error(
						"The article citation no longer matches its exact source span",
					);
				let fingerprint = chapters.get(citation.perekId);
				if (!fingerprint) {
					const chapter = await readAgentPerek(conn, citation.perekId, true);
					if (!chapter)
						throw new Error(
							"The article citation chapter changed before attaching its evidence",
						);
					fingerprint = createHash("sha256")
						.update(canonicalJson(chapter.coordinates))
						.digest("hex");
					chapters.set(citation.perekId, fingerprint);
				}
				if (
					!grounding.chapters.some(
						(chapter) =>
							chapter.id === citation.perekId &&
							chapter.fingerprint === fingerprint,
					)
				)
					throw new Error(
						"The article citation chapter changed before attaching its evidence",
					);
				const source: Evidence = {
					citation: citation.label,
					quote: citation.quote,
					url: null,
					note: "אזכור מפורש שנמצא בטקסט המאמר.",
					articleSource: {
						articleId: change.targetId,
						contentHash: article.state.contentHash,
						sourceHash: article.state.sourceHash,
						spanStart: citation.spanStart,
						spanEnd: citation.spanEnd,
					},
				};
				const sourceKey = key(source);
				if (seen.has(sourceKey)) continue;
				seen.add(sourceKey);
				result.push(source);
			}
		}
	}
	validateEvidence(result);
	return result.length === currentEvidence.length ? currentEvidence : result;
}

/** Structured spans refer to the exact plain-text name/abstract/content join.
 * Free text remains untouched. Only an exact surviving quote can be relocated;
 * ambiguous or removed evidence requires a human to repair the same PR. */
export async function refreshArticleLinkEvidence(
	conn: PoolConnection,
	item: Pick<Contribution, "evidence"> & {
		changes: readonly { kind: ChangeInput["kind"]; targetId?: string | null }[];
	},
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
