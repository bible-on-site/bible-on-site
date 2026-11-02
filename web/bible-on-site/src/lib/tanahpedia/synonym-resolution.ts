import { getEntriesBySynonym } from "@/lib/tanahpedia/service";
import type { SynonymTarget } from "@/lib/tanahpedia/types";

export type SlugResolution =
	| { kind: "entry" }
	| { kind: "alias"; target: SynonymTarget }
	| { kind: "disambiguation"; targets: SynonymTarget[] }
	| { kind: "missing" };

/**
 * Where a slug that is not an entry's `unique_name` should lead.
 * A database failure rejects — never degrades to `missing`, which the
 * route would turn into a cached 404 for an entry that may exist.
 */
export async function resolveSynonymSlug(
	name: string,
): Promise<SlugResolution> {
	const targets = await getEntriesBySynonym(name);
	if (targets.length === 0) return { kind: "missing" };
	if (targets.length === 1) return { kind: "alias", target: targets[0] };
	return { kind: "disambiguation", targets };
}

export function entryHref(uniqueName: string): string {
	return `/pedia/${encodeURIComponent(uniqueName)}`;
}
