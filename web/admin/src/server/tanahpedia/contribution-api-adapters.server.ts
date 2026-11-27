import type { PoolConnection } from "mysql2/promise";
import type { AsyncApiVersionAdapter } from "~/lib/tanahpedia/api-versions";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import { contributionRecordId } from "~/lib/tanahpedia/contribution-identifiers";
import { type ChangeState, record } from "~/lib/tanahpedia/contributions";
import {
	readChangeState,
	readMetadataNames,
} from "./contribution-changes.server";
import {
	captureContributionSourceTarget,
	sourceReferenceLabels,
} from "./contribution-specials.server";

/** Permanent API adapters. Their context is transactional; the generic
 * converter and the PR mechanism do not contain version-specific repair logic. */
export function currentContributionApiContract(conn: PoolConnection) {
	const adapters: AsyncApiVersionAdapter<unknown>[] = [
		{
			from: 6,
			to: 7,
			id: "place-word-occurrence-profiles",
			// Additive vocabulary. Existing operations and approvals are preserved.
			convert: (payload) => payload,
		},
		{
			from: 5,
			to: 6,
			id: "person-place-text-alternatives",
			// v5 person_birth_place states predate place_text: fill the field
			// with null so the stored sequence matches the v6 vocabulary. The
			// two new operation kinds carry their own complete states. The same
			// normalization applies to a source_reference's saved sourceTarget
			// snapshot so an unchanged cited birthplace does not diff as changed.
			convert: (payload) => {
				if (!Array.isArray(payload) || payload.length > 40)
					throw new Error("Unsupported API v5 sequence");
				const changes = payload.map((raw) => record(raw, "operation"));
				const fillPlaceText = (state: unknown) => {
					if (
						state &&
						typeof state === "object" &&
						!Array.isArray(state) &&
						!("placeText" in state)
					)
						(state as Record<string, unknown>).placeText = null;
				};
				for (const change of changes) {
					if (change.kind === "person_birth_place") {
						fillPlaceText(change.before);
						fillPlaceText(change.after);
					}
					const sourceTarget = change.sourceTarget;
					if (
						sourceTarget &&
						typeof sourceTarget === "object" &&
						!Array.isArray(sourceTarget) &&
						(sourceTarget as Record<string, unknown>).kind ===
							"person_birth_place"
					)
						fillPlaceText((sourceTarget as Record<string, unknown>).state);
				}
				return changes;
			},
		},
		{
			from: 4,
			to: 5,
			id: "article-link-operations",
			// This adds executable vocabulary only. Existing reviewed operations
			// and approvals stay unchanged; content rebases remain separate.
			convert: (payload) => payload,
		},
		{
			from: 3,
			to: 4,
			id: "existing-entry-title-operations",
			// New executable vocabulary only. Content resolution belongs to the
			// separate post-merge rebase and must require renewed review.
			convert: (payload) => payload,
		},
		{
			from: 1,
			to: 2,
			id: "metadata-main-name-preconditions",
			convert: async (payload) => {
				if (!Array.isArray(payload) || payload.length > 40)
					throw new Error("Unsupported legacy API sequence");
				const changes = payload.map((raw) => record(raw, "operation"));
				const metadata = changes
					.filter(
						(change) =>
							change.kind === "metadata" && change.personNames === undefined,
					)
					.sort((a, b) => String(a.targetId).localeCompare(String(b.targetId)));
				for (const change of metadata) {
					const id = contributionRecordId(change.targetId, "targetId");
					if (!(await readChangeState(conn, "metadata", id)))
						throw new Error("Metadata target no longer exists");
					change.personNames = await readMetadataNames(conn, id);
				}
				return changes;
			},
		},
		{
			from: 2,
			to: 3,
			id: "source-target-freshness",
			convert: async (payload) => {
				if (!Array.isArray(payload) || payload.length > 40)
					throw new Error("Unsupported API v2 sequence");
				const changes = payload.map((raw) => record(raw, "operation"));
				for (const change of changes)
					if (
						change.kind === "source_reference" &&
						change.sourceTarget === undefined
					) {
						const target = await captureContributionSourceTarget(
							conn,
							change.after as ChangeState | null,
						);
						if (target) {
							change.sourceTarget = target;
							change.labels = {
								...record(change.labels, "labels"),
								...(await sourceReferenceLabels(
									conn,
									change.after as ChangeState,
								)),
							};
						}
					}
				return changes;
			},
		},
	];
	return { version: CONTRIBUTION_API_VERSION, adapters };
}
