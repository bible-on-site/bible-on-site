import { query } from "../api-client";
import { isMissingMysqlSchema } from "../mysql-errors";
import { toPlainTextPreview } from "../tanahpedia/preview-format";
import { entryHref, resolveSynonymSlug } from "../tanahpedia/synonym-resolution";

/**
 * The moed introduction's Tanahpedia preview (#3381).
 *
 * The moed's stored `name` IS the association — no hardcoded map and no
 * fuzzy matching. Resolution applies the exact contract the
 * `/pedia/[slug]` route uses: a canonical `unique_name` wins over alias
 * rows of the same name, a single-target alias resolves to its
 * canonical entry, and an absent or ambiguous (disambiguation) name
 * yields no preview. The old independent `summary` prose never renders
 * — not as a preview, not as a fallback.
 */

/** Whole-word cap on the rendered preview — the issue's fixed length. */
export const MOED_ENTRY_PREVIEW_WORDS = 20;

export interface MoedEntryPreview {
	/** Canonical `/pedia/{unique_name}` path of the resolved entry. */
	href: string;
	/** First ≤20 readable words of the body; `…` only when truncated. */
	text: string;
}

interface EntryBodyRow {
	unique_name: string;
	content: string | null;
}

async function entryBodyByUniqueName(
	uniqueName: string,
): Promise<EntryBodyRow | null> {
	const rows = await query<EntryBodyRow>(
		`SELECT unique_name, content FROM tanahpedia_entry
		 WHERE unique_name = ?`,
		[uniqueName],
	);
	return rows[0] ?? null;
}

/**
 * The moed's entry preview, or `null` when no exact, unambiguous,
 * non-empty published entry resolves from the moed's name — the page
 * renders no introduction block at all then. A real database failure
 * rejects rather than caching a wrong "no entry" state (the same rule
 * `resolveSynonymSlug` documents); only an undeployed pedia schema
 * degrades, matching the moed service's covering-source convention.
 */
export async function getMoedEntryPreview(
	moedName: string,
): Promise<MoedEntryPreview | null> {
	try {
		// Stored names are never percent-encoded, so only the trim + NFC
		// half of the route param normalization applies here.
		const name = moedName.trim().normalize("NFC");
		if (!name) return null;
		let row = await entryBodyByUniqueName(name);
		if (!row) {
			const resolution = await resolveSynonymSlug(name);
			if (resolution.kind === "alias") {
				row = await entryBodyByUniqueName(resolution.target.uniqueName);
			}
		}
		if (!row) return null;
		const text = toPlainTextPreview(
			row.content ?? "",
			MOED_ENTRY_PREVIEW_WORDS,
		);
		if (!text) return null;
		return { href: entryHref(row.unique_name), text };
	} catch (error) {
		if (isMissingMysqlSchema(error)) {
			console.warn(
				"Tanahpedia schema is not deployed yet; serving moed pages without an entry preview until the migration runs.",
			);
			return null;
		}
		throw error;
	}
}
