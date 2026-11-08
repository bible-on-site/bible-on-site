/**
 * The LLM/heuristic article-linking draft contract (#3103).
 *
 * Proposals are evidence-backed DRAFTS only — generation never publishes
 * relationships, verifies coverage, rewrites content, approves its own
 * output or executes relationship SQL. Every proposal flows through the
 * shared relationship registry (#3102) for validation, and an authorized
 * human applies the approved patch through the production write path.
 */

/** Lifecycle — `held` means unresolved (missing/ambiguous target, pending
 * schema); `stale` means the article or base links changed since generation. */
export const LINK_PROPOSAL_STATUSES = [
	"pending",
	"held",
	"approved",
	"rejected",
	"applied",
	"stale",
] as const;
export type LinkProposalStatus = (typeof LINK_PROPOSAL_STATUSES)[number];

/** Registry operation names a proposal may carry. */
export const LINK_PROPOSAL_ACTIONS = [
	"add",
	"remove",
	"replace",
	"clear",
] as const;
export type LinkProposalAction = (typeof LINK_PROPOSAL_ACTIONS)[number];

/** One canonical pasuk coordinate (same shape as the write contract). */
export interface PasukCoordinate {
	perekId: number;
	pasuk: number;
}

/** Normalized target payloads — keyed by the registry relationship key.
 * Stored verbatim in `target_json`; `review_patch_json` carries a human edit
 * of the same shape. */
export interface PerekTarget {
	perekId: number;
}
export interface AuthorTarget {
	authorId: number;
}
export interface CoveringTarget {
	pasukCoordinates: PasukCoordinate[];
	/** Only meaningful on replace; the write contract decides verification. */
	coverageVerified?: boolean;
}
export interface DedicationLinkTarget {
	dedicationId: number;
	/** "YYYY-MM-DD HH:mm:ss" UTC, or null/omitted for ongoing. */
	expiresAt?: string | null;
}
/** Pending-schema (#3098): a recurring Hebrew month/day — never fabricated. */
export interface HebrewDateTarget {
	/** Hebrew month name as proposed (e.g. "ניסן") — unresolved text, not an id. */
	month: string;
	day: number;
}
/** Pending-schema (#3101): a moed by name — the model may not invent an id. */
export interface MoedTarget {
	moedName: string;
}
export type ProposalTarget =
	| PerekTarget
	| AuthorTarget
	| CoveringTarget
	| DedicationLinkTarget
	| HebrewDateTarget
	| MoedTarget;

/** Exact article evidence anchoring a proposal to the source snapshot. */
export interface ProposalEvidence {
	/** The exact quote as it appears in the article's plain-text view. */
	quote: string;
	/**
	 * UTF-16 offsets in the plain-text view extracted from the article
	 * content snapshot the proposal was generated on (NOT HTML offsets).
	 */
	spanStart: number | null;
	spanEnd: number | null;
}

/** The relationship state a proposal was generated against — both the
 * base record and (post-apply) the exact after-record. */
export interface ArticleLinkSnapshot {
	perekId: number;
	authorId: number;
	coverageVerified: boolean;
	coveringSources: PasukCoordinate[];
	/** tanah_article_dedication ids currently assigned to the article. */
	dedicationIds: number[];
}

/** One stored proposal row (camelCase mirror of tanah_article_link_proposal). */
export interface LinkProposal {
	id: string;
	runId: string;
	articleId: number;
	relationshipKey: string;
	action: LinkProposalAction;
	target: ProposalTarget;
	targetLabel: string;
	evidence: ProposalEvidence[] | null;
	rationale: string | null;
	/** Advisory score — never an approval threshold. */
	confidence: number | null;
	conflict: string | null;
	status: LinkProposalStatus;
	dedupeKey: string;
	decisionKey: string;
	generator: string;
	model: string | null;
	promptVersion: string;
	baseContentHash: string;
	baseSnapshot: ArticleLinkSnapshot | null;
	promptTokens: number | null;
	completionTokens: number | null;
	/** Human-edited final patch — separate from the model output. */
	reviewPatch: ProposalTarget | null;
	reviewNotes: string | null;
	reviewer: string | null;
	reviewedAt: string | null;
	appliedAt: string | null;
	appliedSnapshot: ArticleLinkSnapshot | null;
	createdAt: string;
	updatedAt: string;
	/**
	 * Computed at read/apply time: the article's current content hash no
	 * longer equals `baseContentHash`. A stale proposal is never applied.
	 */
	staleNow: boolean;
}

/** A validated candidate before persistence — `status` is `pending` or
 * `held`; nothing else may leave generation. */
export interface DraftProposal {
	relationshipKey: string;
	action: LinkProposalAction;
	target: ProposalTarget;
	targetLabel: string;
	evidence: ProposalEvidence[];
	rationale: string | null;
	confidence: number | null;
	conflict: string | null;
	status: "pending" | "held";
}

/** The result of generating for one article. */
export interface ArticleGenerationOutcome {
	articleId: number;
	/** 'generated' | 'skipped-checkpoint' | 'skipped-unchanged' | 'error' */
	outcome: string;
	proposals: DraftProposal[];
	error?: string;
}
