import { query } from "../api-client";
import { isMissingMysqlSchema } from "../mysql-errors";

export type ExternalReferenceKind =
	| "TANAHPEDIA_ENTITY"
	| "PARSHAN"
	| "TANAH_AUTHOR";

/**
 * Verified authority URLs (Wikidata, Wikipedia, Sefaria, official) for a
 * JSON-LD `sameAs`, in source order. Empty until `external_reference` is
 * deployed, so the reader may ship ahead of the schema.
 */
export async function sameAsFor(
	kind: ExternalReferenceKind,
	subjectId: string | number,
): Promise<string[]> {
	try {
		const rows = await query<{ url: string }>(
			"SELECT url FROM external_reference WHERE subject_kind = ? AND subject_id = ? ORDER BY source",
			[kind, String(subjectId)],
		);
		return rows.map((row) => row.url);
	} catch (error) {
		if (isMissingMysqlSchema(error)) return [];
		throw error;
	}
}
