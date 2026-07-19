/**
 * Hebrew labels for person union / parent-child lookup codes (DB stores English names).
 */

import type { PersonFamilyRelatedPerson } from "./types";

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

/**
 * סימון שמרני בפינה: ז = זכר, נ = נקבה (מקוצר, ללא אייקונים).
 */
export function personSexCornerMark(sex: string | null | undefined): string | null {
	if (sex === "MALE") return "ז";
	if (sex === "FEMALE") return "נ";
	return null;
}

/**
 * שורת מטא בכרטיס ילד כשהמוקד הוא ההורה המדויק (לא מציגים "אב"/"אם" — זה תפקיד ההורה, לא הילד).
 * לביולוגי: בן/בת לפי מין; לשאר סוגי קשר — תפקיד + סוג.
 */
export function focalChildCardMetaLine(edge: {
	parentRole: string;
	relationshipType: string;
	related: { sex: string | null };
}): string | null {
	if (edge.relationshipType !== "BIOLOGICAL") {
		const role = parentRoleLabel(edge.parentRole);
		const rel = relationshipTypeLabel(edge.relationshipType);
		return `${role} · ${rel}`;
	}
	/* ביולוגי: סימון ז/נ על הכרטיס מספיק; אין צורך בבן/בת */
	return null;
}

/** כותרת בין המוקד לבין אחים (כשאין חלוקה לפי גיל במסד) */
export const siblingSectionLabelGeneric = "אחים";

/** אח שנולד לפני המוקד (תאריך לידה ידוע בשניהם) */
export const siblingSectionLabelOlder = "אחים מבוגרים";

/** אח שנולד אחרי המוקד (תאריך לידה ידוע בשניהם) */
export const siblingSectionLabelYounger = "אחים צעירים";

function sortRelatedByHebrewName(list: PersonFamilyRelatedPerson[]) {
	return [...list].sort((a, b) =>
		a.displayName.localeCompare(b.displayName, "he"),
	);
}

/**
 * חלוקת אחים לפי תאריך לידה מול המוקד; אחרת א׳–ב׳ לשתי עמודות עם אותו לייבל «אחים».
 */
export function partitionSiblingsForFamilyTree(
	siblings: PersonFamilyRelatedPerson[],
	focalBirthYyyymmdd: number | null,
): {
	preCluster: PersonFamilyRelatedPerson[];
	postCluster: PersonFamilyRelatedPerson[];
	preLabel: string | null;
	postLabel: string | null;
} {
	const older: PersonFamilyRelatedPerson[] = [];
	const younger: PersonFamilyRelatedPerson[] = [];
	const unknown: PersonFamilyRelatedPerson[] = [];

	if (
		focalBirthYyyymmdd == null ||
		!Number.isFinite(focalBirthYyyymmdd)
	) {
		return splitSiblingsAlphabeticTwoColumns(siblings);
	}

	for (const s of siblings) {
		const b = s.birthDateYyyymmdd;
		if (b == null || !Number.isFinite(b)) {
			unknown.push(s);
		} else if (b < focalBirthYyyymmdd) {
			older.push(s);
		} else if (b > focalBirthYyyymmdd) {
			younger.push(s);
		} else {
			unknown.push(s);
		}
	}

	const differentiated = older.length > 0 && younger.length > 0;
	if (differentiated) {
		return {
			preCluster: sortRelatedByHebrewName(older),
			postCluster: sortRelatedByHebrewName([...younger, ...unknown]),
			preLabel: siblingSectionLabelOlder,
			postLabel: siblingSectionLabelYounger,
		};
	}

	const all = sortRelatedByHebrewName([...older, ...younger, ...unknown]);
	return splitSiblingsAlphabeticTwoColumns(all);
}

function splitSiblingsAlphabeticTwoColumns(
	allIn: PersonFamilyRelatedPerson[],
): {
	preCluster: PersonFamilyRelatedPerson[];
	postCluster: PersonFamilyRelatedPerson[];
	preLabel: string | null;
	postLabel: string | null;
} {
	const all = sortRelatedByHebrewName(allIn);
	if (all.length === 0) {
		return {
			preCluster: [],
			postCluster: [],
			preLabel: null,
			postLabel: null,
		};
	}
	if (all.length === 1) {
		return {
			preCluster: all,
			postCluster: [],
			preLabel: siblingSectionLabelGeneric,
			postLabel: null,
		};
	}
	const mid = Math.ceil(all.length / 2);
	const pre = all.slice(0, mid);
	const post = all.slice(mid);
	return {
		preCluster: pre,
		postCluster: post,
		preLabel: siblingSectionLabelGeneric,
		postLabel: siblingSectionLabelGeneric,
	};
}

/** כותרת משנה מעל קבוצת ילדים לפי בת זוג / הורה נוסף */
export function childGroupByCoParentLabel(
	coParentDisplayName: string | null,
	hasNamedCoParent: boolean,
): string {
	if (hasNamedCoParent && coParentDisplayName) {
		return `ילדים מ־${coParentDisplayName}`;
	}
	return "ילדים (בת זוג לא מזוהה בנתונים)";
}
