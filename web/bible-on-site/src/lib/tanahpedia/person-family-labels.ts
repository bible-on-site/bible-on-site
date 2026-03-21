/**
 * Hebrew labels for person union / parent-child lookup codes (DB stores English names).
 */

const PARENT_ROLE: Record<string, string> = {
	FATHER: "אב",
	MOTHER: "אם",
};

const RELATIONSHIP_TYPE: Record<string, string> = {
	BIOLOGICAL: "ביולוגי",
	ADOPTIVE: "אימוץ",
	STEP: "חורג",
};

const UNION_TYPE: Record<string, string> = {
	MARRIAGE: "נישואין",
	PILEGESH: "פילגש",
};

export function parentRoleLabel(code: string): string {
	return PARENT_ROLE[code] ?? code;
}

export function relationshipTypeLabel(code: string): string {
	return RELATIONSHIP_TYPE[code] ?? code;
}

export function unionTypeLabel(code: string): string {
	return UNION_TYPE[code] ?? code;
}

/** Sort key: father before mother for consistent RTL row order (father first in DOM → right in RTL). */
export function parentRoleSortKey(code: string): number {
	if (code === "FATHER") return 0;
	if (code === "MOTHER") return 1;
	return 2;
}
