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
