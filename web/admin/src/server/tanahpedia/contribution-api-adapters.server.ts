import type { PoolConnection } from "mysql2/promise";
import type { AsyncApiVersionAdapter } from "~/lib/tanahpedia/api-versions";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import { record, uuidField } from "~/lib/tanahpedia/contributions";
import {
	readChangeState,
	readMetadataNames,
} from "./contribution-changes.server";

/** Permanent API adapters. Their context is transactional; the generic
 * converter and the PR mechanism do not contain version-specific repair logic. */
export function currentContributionApiContract(conn: PoolConnection) {
	const adapters: AsyncApiVersionAdapter<unknown>[] = [
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
					const id = uuidField(change.targetId, "targetId");
					if (!(await readChangeState(conn, "metadata", id)))
						throw new Error("Metadata target no longer exists");
					change.personNames = await readMetadataNames(conn, id);
				}
				return changes;
			},
		},
	];
	return { version: CONTRIBUTION_API_VERSION, adapters };
}
