/** Hebrew letters for footnote markers (א ב ג …) — matches common tanahpedia HTML. */
const HEBREW = [
	"א",
	"ב",
	"ג",
	"ד",
	"ה",
	"ו",
	"ז",
	"ח",
	"ט",
	"י",
	"כ",
	"ל",
	"מ",
	"נ",
	"ס",
	"ע",
	"פ",
	"צ",
	"ק",
	"ר",
	"ש",
	"ת",
] as const;

export function hebrewOrdinalLetter(index1Based: number): string {
	if (index1Based < 1) return HEBREW[0];
	if (index1Based <= 22) return HEBREW[index1Based - 1];
	/* Long lists: repeat pattern (rare in footnotes) */
	return HEBREW[(index1Based - 1) % 22];
}

const HUNDREDS = ["ק", "ר", "ש", "ת"] as const;
const TENS = ["י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"] as const;
const ONES = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"] as const;

/**
 * Hebrew numeral (א, ב … י, יא … מט, נ), the numbering the tanahpedia content
 * already uses and the one CSS `list-style-type: hebrew` renders, so a footnote
 * reference and its list item always show the same marker.
 */
export function hebrewNumeral(value: number): string {
	if (!Number.isFinite(value) || value < 1) return ONES[0];
	let remaining = Math.floor(value);
	let out = "";

	while (remaining >= 400) {
		out += HUNDREDS[3];
		remaining -= 400;
	}
	if (remaining >= 100) {
		out += HUNDREDS[Math.floor(remaining / 100) - 1];
		remaining %= 100;
	}
	/* 15 and 16 are written טו/טז so they never spell a divine name. */
	if (remaining === 15 || remaining === 16) {
		return `${out}ט${remaining === 15 ? "ו" : "ז"}`;
	}
	if (remaining >= 10) {
		out += TENS[Math.floor(remaining / 10) - 1];
		remaining %= 10;
	}
	if (remaining >= 1) out += ONES[remaining - 1];
	return out;
}
