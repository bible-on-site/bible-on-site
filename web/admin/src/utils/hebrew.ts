const HUNDREDS: ReadonlyArray<readonly [number, string]> = [
	[300, "ש"],
	[200, "ר"],
	[100, "ק"],
];

const TENS_AND_ONES: ReadonlyArray<readonly [number, string]> = [
	[90, "צ"],
	[80, "פ"],
	[70, "ע"],
	[60, "ס"],
	[50, "נ"],
	[40, "מ"],
	[30, "ל"],
	[20, "כ"],
	[10, "י"],
	[9, "ט"],
	[8, "ח"],
	[7, "ז"],
	[6, "ו"],
	[5, "ה"],
	[4, "ד"],
	[3, "ג"],
	[2, "ב"],
	[1, "א"],
];

function toHebrewLetters(num: number): string {
	if (num <= 0) return "";

	let remaining = Math.floor(num);
	let letters = "";

	while (remaining >= 400) {
		letters += "ת";
		remaining -= 400;
	}

	for (const [value, letter] of HUNDREDS) {
		if (remaining >= value) {
			letters += letter;
			remaining -= value;
		}
	}

	if (remaining === 15) return `${letters}טו`;
	if (remaining === 16) return `${letters}טז`;

	for (const [value, letter] of TENS_AND_ONES) {
		if (remaining >= value) {
			letters += letter;
			remaining -= value;
		}
	}

	return letters;
}

export function toHebrewWithPunctuation(num: number): string {
	const letters = toHebrewLetters(num);
	if (letters.length <= 1) return letters ? `${letters}'` : "";
	return `${letters.slice(0, -1)}"${letters.at(-1)}`;
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
