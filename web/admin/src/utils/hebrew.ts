import { toLetters } from "gematry";

export function toHebrewWithPunctuation(num: number): string {
	const letters = toLetters(num, { addQuotes: true });
	if (!letters.includes('"') && letters.length === 1) {
		return `${letters}'`;
	}
	return letters;
}

/**
 * Format perek display label.
 * Non-additionals: "א'" / "כ'"
 * With additionals: "א א'" / "א כ'"
 */
export function formatPerekLabel(
	perekInContext: number,
	additionalLetter: string | null,
): string {
	const perekHeb = toHebrewWithPunctuation(perekInContext);
	if (additionalLetter) {
		return `${additionalLetter} ${perekHeb}`;
	}
	return perekHeb;
}
