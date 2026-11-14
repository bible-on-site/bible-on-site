/** Uniform month IDs: Tishrei=1..Elul=12, Adar I=13, Adar II=14.
 * Cheshvan/Kislev can reach 30; these maxima allow partial/unknown years. */
export const MAX_DAY_FOR_HEBREW_MONTH: Readonly<Record<number, number>> = {
	1: 30,
	2: 30,
	3: 30,
	4: 29,
	5: 30,
	6: 29,
	7: 30,
	8: 29,
	9: 30,
	10: 29,
	11: 30,
	12: 29,
	13: 30,
	14: 29,
};
