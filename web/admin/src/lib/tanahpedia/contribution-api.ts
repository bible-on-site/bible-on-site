import type { ApiVersionAdapter } from "./api-versions";
import {
	type Contribution,
	type ReviewedChange,
	record,
	sameState,
	uuidField,
	validateChange,
} from "./contributions";

// Bump for a change to the typed operation contract, alongside an adapter from
// the preceding version. Package/release versions do not change this contract.
export const CONTRIBUTION_API_VERSION = 1;

// Legacy sequences stay opaque until the transitive conversion has completed.
// Retain adapters permanently so long-lived proposals can skip releases.
export const CONTRIBUTION_API_ADAPTERS: readonly ApiVersionAdapter<unknown>[] =
	[];

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
	const targets = new Set<string>();
	return value.map((raw) => {
		const change = record(raw, "operation");
		const targetId = uuidField(change.targetId, "targetId");
		const input = validateChange({
			kind: change.kind,
			targetId,
			after: change.after,
		});
		if (change.before !== null) {
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
		if (Object.values(labels).some((label) => typeof label !== "string"))
			throw new Error("API labels must be text");
		const key = `${input.kind}:${targetId}`;
		if (targets.has(key)) throw new Error("API target appears more than once");
		targets.add(key);
		return {
			kind: input.kind,
			targetId,
			before: change.before as ReviewedChange["before"],
			after: input.after as unknown as ReviewedChange["after"],
			labels: labels as Record<string, string>,
		};
	});
}
