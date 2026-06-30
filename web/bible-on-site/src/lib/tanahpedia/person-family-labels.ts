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
	FORBIDDEN_WITH_GENTILE: "קשר פסול עם גויה",
	// איסור ערוה / קשר אסור בין ישראלים (דמו מעבדה)
	BANNED_INCEST: "קשר אסור (ערוה)",
	// אירוסין בלבד — לא נישואין גמורים
	BETROTHAL: "אירוסין",
};

const UNION_END_REASON: Record<string, string> = {
	DEATH: "פטירה",
	DIVORCE: "גירושין",
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

export function unionEndReasonLabel(code: string): string {
	return UNION_END_REASON[code] ?? code;
}

/** YYYYMMDD from DB → קריא כ־YYYY-MM-DD (לדמו מעבדה) */
export function formatUnionYyyymmdd(
	value: number | string | null | undefined,
): string | null {
	if (value == null || value === "") return null;
	const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
	if (Number.isNaN(n)) return null;
	const s = String(Math.trunc(n));
	if (s.length !== 8) return s;
	return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Section title above spouse cards: male focal → בנות זוג; female → בני זוג. */
export function spousesSectionLabel(focalSex: string | null): string {
	if (focalSex === "MALE") return "בנות זוג";
	if (focalSex === "FEMALE") return "בני זוג";
	return "זיווגים";
}

/**
 * כותרת מפורשת לבלוק דעה — כשיש שתי קורות לטיב הקשר (בת זוג אחת).
 * הרמב"ם מול רש"י, רד"ק ותוספות (דוגמה לשיטה שאינה כרמב"ם בשמשון).
 */
export function spouseHalachicOpinionTitle(unionTypeCode: string): string {
	if (unionTypeCode === "MARRIAGE") {
		return 'הרמב"ם: נישואין תקפים';
	}
	if (unionTypeCode === "FORBIDDEN_WITH_GENTILE") {
		return 'רש"י, רד"ק ותוספות: קשר פסול עם גויה (אינו נישואין כהלכת התורה)';
	}
	if (unionTypeCode === "BANNED_INCEST") {
		return "דעה לדוגמה: קשר אסור מחמת ערוה (אינו כרת קידושין)";
	}
	if (unionTypeCode === "BETROTHAL") {
		return "דעה לדוגמה: אירוסין בלבד — עדיין לא חופה וקידושין";
	}
	return unionTypeLabel(unionTypeCode);
}

/** Sort key: father before mother for consistent RTL row order (father first in DOM → right in RTL). */
export function parentRoleSortKey(code: string): number {
	if (code === "FATHER") return 0;
	if (code === "MOTHER") return 1;
	return 2;
}
