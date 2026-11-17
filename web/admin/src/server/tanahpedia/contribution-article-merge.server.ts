import type { PoolConnection } from "mysql2/promise";
import {
	type ArticleLinkState,
	projectArticleLinks,
	validateArticleLinkChange,
	validateArticleLinkState,
} from "~/lib/tanahpedia/contribution-article-links";
import { type Contribution, sameState } from "~/lib/tanahpedia/contributions";
import { updateArticleRelationships } from "../article-relationships-api";
import { syncDedicationExpiry } from "../dedication-expiry";
import {
	lockReviewedArticleDedicationOwners,
	setReviewedArticleDedicationTarget,
} from "../dedication-targets.server";
import {
	articleChange,
	dedicationChange,
	revalidateWebsite,
} from "../website-revalidate";
import { refreshArticleLinkEvidence } from "./contribution-article-evidence.server";
import { readArticleLinkState } from "./contribution-article-links.server";

export function isArticleLinkPr(item: Contribution): boolean {
	return item.changes.length === 1 && item.changes[0].kind === "article_links";
}

export function assertNoArticleLinkMerge(item: Contribution): void {
	if (item.articleLinkMerge && item.state === "open")
		throw new Error(
			"An article-link merge is pending. Retry its merge before editing or reviewing this PR.",
		);
}

function relationships(state: ArticleLinkState) {
	return {
		sourceHash: state.sourceHash,
		authorId: state.authorId,
		perekId: state.perekId,
		coverageVerified: state.coverageVerified,
		coveringSources: state.coveringSources,
		moedIds: state.moedIds,
	};
}

export async function assertArticleLinkMergeBase(
	conn: PoolConnection,
	item: Contribution,
) {
	const change = item.changes[0];
	const current = await readArticleLinkState(conn, change.targetId, {
		current: true,
	});
	if (!sameState(current, change.before))
		throw new Error(
			"Conflict: article links or source text changed. Refresh the PR and review the new diff.",
		);
	if (!sameState(await refreshArticleLinkEvidence(conn, item), item.evidence))
		throw new Error(
			"Conflict: structured article evidence changed. Refresh the PR before reviewing its new source spans.",
		);
}

/** The caller commits its durable intent BEFORE entering this transaction.
 * No canonical article locks are held during HTTP. The PR lock serializes
 * retries; an interrupted response is recovered only from the exact reviewed
 * link state and unchanged raw source/author, never from the content hash alone.
 * Dedication writes then commit atomically with the PR's merged marker. */
export async function applyReviewedArticleLinks(
	conn: PoolConnection,
	item: Contribution,
): Promise<void> {
	if (
		!isArticleLinkPr(item) ||
		item.articleLinkMerge?.revision !== item.revision
	)
		throw new Error("Article-link merge requires its durable reviewed intent");
	const change = item.changes[0];
	const input = validateArticleLinkChange({
		kind: change.kind,
		targetId: change.targetId,
		after: change.after,
	});
	const before = validateArticleLinkState(change.before);
	const after = projectArticleLinks(before, input.after);
	const current = await readArticleLinkState(conn, change.targetId);
	const unchanged = sameState(current, before);
	const apiSatisfied = sameState(relationships(current), relationships(after));
	if (
		!unchanged &&
		(!apiSatisfied ||
			!sameState(current.dedicationAssignments, before.dedicationAssignments))
	)
		throw new Error(
			"Conflict: the pending API merge cannot be recovered from the current article state. Restore the reviewed state before retrying.",
		);
	if (!apiSatisfied) {
		await updateArticleRelationships(Number(change.targetId), {
			source: `contribution-pr:${item.number}:${item.articleLinkMerge.id}`,
			expectedContentHash: before.contentHash,
			expectedCoveringSources: before.coveringSources,
			expectedMoedIds: before.moedIds,
			expectedCoverageVerified: before.coverageVerified,
			perekId: after.perekId,
			coveringSources: after.coveringSources,
			coverageVerified: after.coverageVerified,
			moedIds: after.moedIds,
		});
	}
	const dedicationIds = [
		...new Set(
			[...before.dedicationAssignments, ...after.dedicationAssignments].map(
				(a) => a.dedicationId,
			),
		),
	].sort((a, b) => a - b);
	await lockReviewedArticleDedicationOwners(conn, dedicationIds);
	// A current locking read AFTER HTTP observes its commit under REPEATABLE READ
	// and fences further canonical changes until our local marker commits.
	const applied = await readArticleLinkState(conn, change.targetId, {
		current: true,
	});
	if (
		!sameState(relationships(applied), relationships(after)) ||
		!sameState(applied.dedicationAssignments, before.dedicationAssignments)
	)
		throw new Error(
			"Conflict: article changed during its API merge; the durable intent was retained for recovery",
		);
	for (const dedicationId of dedicationIds) {
		const oldAssignment =
			before.dedicationAssignments.find(
				(a) => a.dedicationId === dedicationId,
			) ?? null;
		const newAssignment =
			after.dedicationAssignments.find(
				(a) => a.dedicationId === dedicationId,
			) ?? null;
		if (sameState(oldAssignment, newAssignment)) continue;
		await setReviewedArticleDedicationTarget(conn, {
			articleId: Number(change.targetId),
			dedicationId,
			before: oldAssignment,
			after: newAssignment,
		});
	}
}

/** Called after the local marker commits, including dedication-only changes and
 * recovery of an API response that did not reach the original caller. */
export async function invalidateMergedArticleLinks(
	item: Contribution,
): Promise<void> {
	const change = item.changes[0];
	const input = validateArticleLinkChange({
		kind: change.kind,
		targetId: change.targetId,
		after: change.after,
	});
	const before = validateArticleLinkState(change.before);
	const after = projectArticleLinks(before, input.after);
	const dedicationIds = [
		...new Set(
			[...before.dedicationAssignments, ...after.dedicationAssignments].map(
				(a) => a.dedicationId,
			),
		),
	];
	await revalidateWebsite([
		articleChange({
			id: Number(change.targetId),
			perekIds: [...new Set([before.perekId, after.perekId])],
			authorIds: [before.authorId],
			coveringSpans: before.coveringSources.map((c) => ({
				perekId: c.perekId,
				pasukFrom: c.pasuk,
				pasukTo: c.pasuk,
			})),
		}),
		...dedicationIds.map((id) =>
			dedicationChange({ id, articleIds: [Number(change.targetId)] }),
		),
	]);
	await Promise.all(dedicationIds.map(syncDedicationExpiry));
}
