import { getEntriesBySynonym } from "@/lib/tanahpedia/service";
import type { SynonymTarget } from "@/lib/tanahpedia/types";

export type SlugResolution =
	| { kind: "entry" }
	| { kind: "alias"; target: SynonymTarget }
	| { kind: "disambiguation"; targets: SynonymTarget[] }
	| { kind: "missing" };

/** Where a slug that is not an entry's `unique_name` should lead. */
export async function resolveSynonymSlug(
	name: string,
): Promise<SlugResolution> {
	let targets: SynonymTarget[];
	try {
		targets = await getEntriesBySynonym(name);
	} catch {
		return { kind: "missing" };
	}
	if (targets.length === 0) return { kind: "missing" };
	if (targets.length === 1) return { kind: "alias", target: targets[0] };
	return { kind: "disambiguation", targets };
}

export function entryHref(uniqueName: string): string {
	return `/pedia/${encodeURIComponent(uniqueName)}`;
}
