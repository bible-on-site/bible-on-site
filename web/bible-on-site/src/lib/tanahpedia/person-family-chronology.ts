import type { PersonFamilyChildEdge } from "@/lib/tanahpedia/types";

/**
 * סדר לידות לפי סיפור בראשית לט–לה (דיאגרמת רצף), לשמות תצוגה כפי שמגיעים מהמסד.
 * מספרים נמוכים = מוקדם יותר.
 */
const JACOB_CHILD_BIRTH_SEQUENCE: Readonly<Record<string, number>> = {
	ראובן: 1,
	שמעון: 2,
	לוי: 3,
	יהודה: 4,
	דן: 5,
	נפתלי: 6,
	גד: 7,
	אשר: 8,
	יששכר: 9,
	זבולון: 10,
	דינה: 11,
	יוסף: 12,
	בנימין: 13,
};

function isJacobFocalName(displayName: string): boolean {
	return displayName.trim() === "יעקב";
}

/** מפתח מיון לילד: ידוע ליעקב, אחרת אלפביתי */
export function childEdgeChronologyKey(
	edge: PersonFamilyChildEdge,
	focalDisplayName: string,
): number {
	if (!isJacobFocalName(focalDisplayName)) {
		return 500;
	}
	const n = edge.related.displayName.trim();
	const seq = JACOB_CHILD_BIRTH_SEQUENCE[n];
	if (seq != null) return seq;
	return 450 + (n.codePointAt(0) ?? 0);
}

export function compareChildEdgesChronology(
	a: PersonFamilyChildEdge,
	b: PersonFamilyChildEdge,
	focalDisplayName: string,
): number {
	const ka = childEdgeChronologyKey(a, focalDisplayName);
	const kb = childEdgeChronologyKey(b, focalDisplayName);
	if (ka !== kb) return ka - kb;
	return a.related.displayName.localeCompare(b.related.displayName, "he");
}

export function shouldApplyJacobChildChronology(
	focalDisplayName: string,
	children: PersonFamilyChildEdge[],
): boolean {
	if (!isJacobFocalName(focalDisplayName) || children.length === 0) return false;
	let hits = 0;
	for (const c of children) {
		if (JACOB_CHILD_BIRTH_SEQUENCE[c.related.displayName.trim()] != null) {
			hits++;
		}
	}
	/* רק כשיש התאמה משמעותית לרשימת יעקב — לא לשבור דמויות אחרות בשם יעקב */
	return hits >= 4;
}

