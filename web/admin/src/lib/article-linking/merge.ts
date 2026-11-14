/**
 * The apply planner (#3103): turns an approved proposal + the live
 * relationship snapshot into ONE write through the shared contract (#3102)
 * — either the article-scoped `updateArticleRelationships` mutation input
 * (article-owned keys) or a dedication-aggregate edit (dedication-owned).
 * Pure and deterministic so the planner is unit-testable; the server wraps
 * it in freshness checks, the row lock and the proposal transition.
 */
import type {
	ArticleLinkSnapshot,
	LinkProposal,
	PasukCoordinate,
	ProposalTarget,
} from "./types";
import { AUTHOR_ATTRIBUTION_POLICY_REASON } from "./validate";

/** Mirrors the API's UpdateArticleRelationshipsInput (camelCase wire). */
export interface CoveringSourceInput {
	perekId: number;
	pasuk: number;
}
export interface ArticleRelationshipsMutationInput {
	source: string;
	perekId?: number;
	authorId?: number;
	coveringSources?: CoveringSourceInput[];
	coverageVerified?: boolean;
	expectedContentHash?: string;
	expectedCoveringSources?: CoveringSourceInput[];
}

export type ApplyPlan =
	| {
			kind: "article-mutation";
			input: ArticleRelationshipsMutationInput;
			/** Pasuk coords the write is expected to leave stored. */
			resultingSet: PasukCoordinate[];
	  }
	| {
			kind: "dedication";
			op: "add" | "remove";
			dedicationId: number;
			expiresAt: string | null;
	  }
	| { kind: "cannot-apply"; reason: string };

const coordKey = (c: PasukCoordinate) => `${c.perekId}:${c.pasuk}`;

function sortedUnique(coords: PasukCoordinate[]): PasukCoordinate[] {
	const map = new Map<string, PasukCoordinate>();
	for (const c of coords) map.set(coordKey(c), c);
	return [...map.values()].sort(
		(a, b) => a.perekId - b.perekId || a.pasuk - b.pasuk,
	);
}

function freshness(
	source: string,
	snapshot: ArticleLinkSnapshot,
	contentHash: string,
): Pick<
	ArticleRelationshipsMutationInput,
	"source" | "expectedContentHash" | "expectedCoveringSources"
> {
	return {
		source,
		expectedContentHash: contentHash || undefined,
		expectedCoveringSources: snapshot.coveringSources.map((c) => ({
			perekId: c.perekId,
			pasuk: c.pasuk,
		})),
	};
}

function planCovering(
	action: LinkProposal["action"],
	target: ProposalTarget,
	source: string,
	snapshot: ArticleLinkSnapshot,
	contentHash: string,
): ApplyPlan {
	const covering = target as {
		pasukCoordinates?: PasukCoordinate[];
		coverageVerified?: boolean;
	};
	const proposed = (covering.pasukCoordinates ?? []).filter(
		(c): c is PasukCoordinate =>
			Number.isInteger(c?.perekId) && Number.isInteger(c?.pasuk),
	);
	const current = snapshot.coveringSources;

	switch (action) {
		case "add": {
			if (proposed.length === 0) {
				return {
					kind: "cannot-apply",
					reason: "add proposal carries no coordinates",
				};
			}
			const existing = new Set(current.map(coordKey));
			const novel = proposed.filter((c) => !existing.has(coordKey(c)));
			if (novel.length === 0) {
				return {
					kind: "cannot-apply",
					reason: "every proposed coordinate is already in the covering set",
				};
			}
			const merged = sortedUnique([...current, ...proposed]);
			return {
				kind: "article-mutation",
				resultingSet: merged,
				input: {
					...freshness(source, snapshot, contentHash),
					coveringSources: merged,
					coverageVerified:
						covering.coverageVerified ?? snapshot.coverageVerified,
				},
			};
		}
		case "remove": {
			const removing = new Set(proposed.map(coordKey));
			const remaining = current.filter((c) => !removing.has(coordKey(c)));
			if (remaining.length === current.length) {
				return {
					kind: "cannot-apply",
					reason: "no proposed coordinate is in the covering set",
				};
			}
			return {
				kind: "article-mutation",
				resultingSet: remaining,
				input: {
					...freshness(source, snapshot, contentHash),
					coveringSources: remaining,
					// An emptied set means coverage is unknown — never keep the flag.
					coverageVerified: remaining.length
						? (covering.coverageVerified ?? snapshot.coverageVerified)
						: false,
				},
			};
		}
		case "replace": {
			const set = sortedUnique(proposed);
			return {
				kind: "article-mutation",
				resultingSet: set,
				input: {
					...freshness(source, snapshot, contentHash),
					coveringSources: set,
					coverageVerified: set.length
						? (covering.coverageVerified ?? snapshot.coverageVerified)
						: false,
				},
			};
		}
		case "clear":
			return {
				kind: "article-mutation",
				resultingSet: [],
				input: {
					...freshness(source, snapshot, contentHash),
					coveringSources: [],
					coverageVerified: false,
				},
			};
	}
}

/**
 * Plans the write for one approved proposal. `contentHash` is the article's
 * CURRENT hash (re-read at apply time); the mutation rejects the write when
 * it no longer matches what the server saw under the row lock.
 */
export function planProposalApply(
	proposal: Pick<
		LinkProposal,
		"relationshipKey" | "action" | "target" | "reviewPatch" | "id"
	>,
	snapshot: ArticleLinkSnapshot,
	contentHash: string,
	reviewer: string,
): ApplyPlan {
	const target = (proposal.reviewPatch ?? proposal.target) as ProposalTarget;
	const source = `link-proposal-${proposal.id}:${reviewer}`;

	switch (proposal.relationshipKey) {
		case "primaryPerek": {
			if (proposal.action !== "replace") {
				return {
					kind: "cannot-apply",
					reason: `primaryPerek supports replace only, not ${proposal.action}`,
				};
			}
			const perekId = (target as { perekId?: number }).perekId;
			if (!Number.isInteger(perekId)) {
				return { kind: "cannot-apply", reason: "no perekId target" };
			}
			if (perekId === snapshot.perekId) {
				return { kind: "cannot-apply", reason: "already the current perek" };
			}
			return {
				kind: "article-mutation",
				resultingSet: snapshot.coveringSources,
				input: { ...freshness(source, snapshot, contentHash), perekId },
			};
		}
		case "author":
			return { kind: "cannot-apply", reason: AUTHOR_ATTRIBUTION_POLICY_REASON };
		case "coveringSources":
			return planCovering(
				proposal.action,
				target,
				source,
				snapshot,
				contentHash,
			);
		case "dedicationAssignments": {
			const rawDedicationId = (target as { dedicationId?: unknown })
				.dedicationId;
			if (typeof rawDedicationId !== "number") {
				return { kind: "cannot-apply", reason: "no dedicationId target" };
			}
			const dedicationId = rawDedicationId;
			const expiresAt =
				(target as { expiresAt?: string | null }).expiresAt ?? null;
			if (proposal.action === "add") {
				if (snapshot.dedicationIds.includes(dedicationId)) {
					return {
						kind: "cannot-apply",
						reason: "dedication already assigned to the article",
					};
				}
				return { kind: "dedication", op: "add", dedicationId, expiresAt };
			}
			if (proposal.action === "remove") {
				if (!snapshot.dedicationIds.includes(dedicationId)) {
					return {
						kind: "cannot-apply",
						reason: "dedication is not assigned to the article",
					};
				}
				return { kind: "dedication", op: "remove", dedicationId, expiresAt };
			}
			return {
				kind: "cannot-apply",
				reason: `dedicationAssignments proposals support add/remove, not ${proposal.action}`,
			};
		}
		default:
			return {
				kind: "cannot-apply",
				reason: `${proposal.relationshipKey} has no applicable write path (read-only or pending-schema)`,
			};
	}
}
