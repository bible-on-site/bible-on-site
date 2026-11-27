import {
	contributionArticleId,
	validateArticleLinkState,
} from "./contribution-article-links";
import {
	contributionIdentifierKey,
	contributionRecordId,
} from "./contribution-identifiers";
import { validatePlaceProfileBase } from "./contribution-place-profile";
import { isContributionSourceFact } from "./contribution-specials";
import {
	type Contribution,
	type ReviewedChange,
	record,
	sameState,
	validateChange,
} from "./contributions";

// Bump for a change to the typed operation contract, alongside an adapter from
// the preceding version. Package/release versions do not change this contract.
export const CONTRIBUTION_API_VERSION = 7;

export interface ContributionApiMigration {
	id: string;
	status: "succeeded" | "failed";
	from: number;
	to: number;
	at: string;
	steps: { from: number; to: number; id: string }[];
	error: string | null;
	/** Untouched input for audit and manual recovery, even when fields disappear. */
	sequence: string;
}

export function contributionApiVersion(item: Contribution): number {
	return item.apiVersion ?? 1;
}

export function migrationBlocked(item: Contribution): boolean {
	return (
		item.kind === "pr" &&
		(item.apiMigration?.status === "failed" ||
			contributionApiVersion(item) !== CONTRIBUTION_API_VERSION)
	);
}

/** Validate both sides; a converted sequence must be renderable and executable
 * under the current contract. Do not rebase against current content here. */
export function validateApiSequence(value: unknown): ReviewedChange[] {
	if (!Array.isArray(value) || value.length > 40)
		throw new Error("API sequence must contain at most 40 operations");
	if (
		value.some(
			(raw) => raw && typeof raw === "object" && raw.kind === "article_links",
		) &&
		value.length !== 1
	)
		throw new Error("An article-link PR contains one article aggregate");
	if (
		value.length !== 1 &&
		value.some(
			(raw) => raw && typeof raw === "object" && raw.kind === "place_profile",
		)
	)
		throw new Error("A place profile PR contains one place");
	const targets = new Set<string>();
	return value.map((raw) => {
		const change = record(raw, "operation");
		const targetId =
			change.kind === "article_links"
				? contributionArticleId(change.targetId)
				: contributionRecordId(change.targetId, "targetId");
		const input = validateChange({
			kind: change.kind,
			targetId,
			after: change.after,
		});
		if (input.kind === "article_links") {
			const base = validateArticleLinkState(change.before);
			if (!sameState(base, change.before))
				throw new Error("Article-link base contains noncanonical fields");
		} else if (input.kind === "place_profile") {
			if (input.after.entry) {
				if (change.before !== null)
					throw new Error("A new place entry must have a null base");
			} else {
				const base = validatePlaceProfileBase(change.before);
				if (!sameState(base, change.before))
					throw new Error("Noncanonical place profile base");
			}
		} else if (change.before !== null) {
			if (input.kind === "entry")
				throw new Error("A new-entry operation must have a null base");
			const base = validateChange({
				kind: input.kind,
				targetId,
				after: change.before,
			});
			if (!sameState(base.after, change.before))
				throw new Error("API base contains unsupported fields");
		}
		if (!sameState(input.after, change.after))
			throw new Error("API operation contains unsupported fields");
		const labels = record(change.labels, "labels");
		const attachment = input.kind === "source_reference" ? input.after : null;
		const needsSourceTarget =
			attachment && isContributionSourceFact(attachment.targetKind);
		let sourceTarget: ReviewedChange["sourceTarget"];
		if (needsSourceTarget && !change.sourceTarget)
			throw new Error(
				"API v3 source attachment requires target-fact preconditions",
			);
		if (change.sourceTarget !== undefined) {
			const target = record(change.sourceTarget, "source target"),
				state = record(target.state, "source fact");
			if (
				!needsSourceTarget ||
				target.kind !== attachment.targetKind ||
				typeof target.id !== "string" ||
				contributionIdentifierKey(target.id) !==
					contributionIdentifierKey(attachment.targetId) ||
				Object.keys(target).some((k) => !["kind", "id", "state"].includes(k)) ||
				Object.keys(state).length === 0 ||
				Object.keys(state).length > 40 ||
				Object.values(state).some(
					(v) =>
						v !== null &&
						typeof v !== "boolean" &&
						typeof v !== "string" &&
						!(typeof v === "number" && Number.isFinite(v)),
				)
			)
				throw new Error("Invalid source-target preconditions");
			sourceTarget = {
				kind: attachment.targetKind,
				id: attachment.targetId,
				state: state as NonNullable<ReviewedChange["sourceTarget"]>["state"],
			};
		}
		let personNames: ReviewedChange["personNames"];
		if (input.kind === "metadata" && change.personNames === undefined)
			throw new Error("API v2 metadata requires MAIN-name preconditions");
		if (change.personNames !== undefined) {
			if (
				input.kind !== "metadata" ||
				!Array.isArray(change.personNames) ||
				change.personNames.length > 100
			)
				throw new Error("Invalid main-name preconditions");
			const ids = new Set<string>();
			personNames = change.personNames.map((raw) => {
				const name = record(raw, "main name"),
					id = contributionRecordId(name.id, "name id");
				if (
					ids.has(contributionIdentifierKey(id)) ||
					typeof name.name !== "string" ||
					name.name.length > 255
				)
					throw new Error("Invalid main-name preconditions");
				ids.add(contributionIdentifierKey(id));
				return { id, name: name.name };
			});
		}
		if (Object.values(labels).some((label) => typeof label !== "string"))
			throw new Error("API labels must be text");
		const key = `${input.kind}:${contributionIdentifierKey(targetId)}`;
		if (targets.has(key)) throw new Error("API target appears more than once");
		targets.add(key);
		return {
			kind: input.kind,
			targetId,
			before: change.before as ReviewedChange["before"],
			after: input.after as unknown as ReviewedChange["after"],
			labels: labels as Record<string, string>,
			...(personNames ? { personNames } : {}),
			...(sourceTarget ? { sourceTarget } : {}),
		};
	});
}
