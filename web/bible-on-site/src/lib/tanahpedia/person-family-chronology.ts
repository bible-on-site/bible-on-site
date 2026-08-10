import type { PersonFamilyChildEdge } from "@/lib/tanahpedia/types";

/**
 * סדרי לידה ידועים לפי סיפור המקרא, לפי שם המוקד ואז שם הילד כפי שהוא במסד.
 * מספרים נמוכים = מוקדם יותר. משמש לפריסת ציר-זמן משותף לכל בנות הזוג.
 */
const CHILD_BIRTH_SEQUENCES: Readonly<
	Record<string, Readonly<Record<string, number>>>
> = {
	אברהם: {
		ישמעאל: 1,
		יצחק: 2,
		זמרן: 3,
		יקשן: 4,
		מדן: 5,
		מדין: 6,
		ישבק: 7,
		שוח: 8,
	},
	יעקב: {
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
	},
};

function birthSequenceFor(
	focalDisplayName: string,
): Readonly<Record<string, number>> | null {
	return CHILD_BIRTH_SEQUENCES[focalDisplayName.trim()] ?? null;
}

/** מפתח מיון לילד: לפי סדר לידה ידוע, אחרת אלפביתי */
export function childEdgeChronologyKey(
	edge: PersonFamilyChildEdge,
	focalDisplayName: string,
): number {
	const sequence = birthSequenceFor(focalDisplayName);
	if (!sequence) {
		return 500;
	}
	const n = edge.related.displayName.trim();
	const seq = sequence[n];
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

export function shouldApplyChildBirthChronology(
	focalDisplayName: string,
	children: PersonFamilyChildEdge[],
): boolean {
	const sequence = birthSequenceFor(focalDisplayName);
	if (!sequence || children.length === 0) return false;
	let hits = 0;
	for (const c of children) {
		if (sequence[c.related.displayName.trim()] != null) {
			hits++;
		}
	}
	/* רק כשרוב הילדים מוכרים — כדי לא לשבור דמות אחרת בעלת אותו שם */
	return hits >= 2 && hits * 2 >= children.length;
}
