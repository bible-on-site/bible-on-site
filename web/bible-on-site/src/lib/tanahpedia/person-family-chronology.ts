import type { PersonFamilyChildEdge } from "@/lib/tanahpedia/types";

/** Known birth orders come from each parent-child relationship in Tanahpedia. */
export function childEdgeChronologyKey(edge: PersonFamilyChildEdge): number {
	return edge.birthOrder ?? Number.POSITIVE_INFINITY;
}

export function compareChildEdgesChronology(
	a: PersonFamilyChildEdge,
	b: PersonFamilyChildEdge,
): number {
	const order = childEdgeChronologyKey(a) - childEdgeChronologyKey(b);
	if (!Number.isNaN(order) && order !== 0) return order;
	return a.related.displayName.localeCompare(b.related.displayName, "he");
}

export function shouldApplyChildBirthChronology(
	children: PersonFamilyChildEdge[],
): boolean {
	return children.some((child) => child.birthOrder != null);
}
