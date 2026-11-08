/**
 * Hebrew letter-number parsing for citation extraction (#3103).
 * Mirrors the conventions of `toHebrewLetters` in src/utils/hebrew.ts
 * (including טו/טז, which need no special case — plain letter sums produce
 * the same 15/16). Final forms carry their letter's value.
 */

const LETTER_VALUES: Record<string, number> = {
	א: 1,
	ב: 2,
	ג: 3,
	ד: 4,
	ה: 5,
	ו: 6,
	ז: 7,
	ח: 8,
	ט: 9,
	י: 10,
	כ: 20,
	ך: 20,
	ל: 30,
	מ: 40,
	ם: 40,
	נ: 50,
	ן: 50,
	ס: 60,
	ע: 70,
	פ: 80,
	ף: 80,
	צ: 90,
	ץ: 90,
	ק: 100,
	ר: 200,
	ש: 300,
	ת: 400,
};

/** Strips gershayim/geresh/quote marks so "כ״ג", 'כ"ג' and כג all parse. */
function stripMarks(value: string): string {
	return value.replace(/["'׳״]/g, "");
}

/**
 * Parses a Hebrew numeral token ("יח", 'כ"ג', "קנ") to its integer value.
 * Returns null for anything that is not a pure Hebrew letter sequence with a
 * positive sum, and for values above `max` (pasuk/perek bounds callers pass).
 */
export function parseHebrewNumber(raw: string, max = 1500): number | null {
	const cleaned = stripMarks(raw).trim();
	if (!cleaned || !/^[א-ת]+$/.test(cleaned)) return null;
	let sum = 0;
	for (const ch of cleaned) {
		const value = LETTER_VALUES[ch];
		/* istanbul ignore next -- the [א-ת] regex above guarantees a mapped letter */
		if (!value) return null;
		sum += value;
	}
	return sum >= 1 && sum <= max ? sum : null;
}

/**
 * The token pattern used by the citation extractor: a short run of Hebrew
 * letters optionally carrying gershayim/geresh/quote marks inside it
 * (e.g. י"ח, כ״ג). Capped at three letters per segment — the largest
 * legitimate citation numeral is three (קעו=176) — with a trailing boundary
 * guard so a longer Hebrew word is never partially swallowed as a numeral.
 */
export const HEBREW_NUMBER_PATTERN =
	"[א-ת]{1,3}(?:[\"'׳״][א-ת]{1,3})?(?![א-ת])";
