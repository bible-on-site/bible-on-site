/**
 * Divine-name display masking (הסתר שם השם) — pure matching + transform.
 *
 * This is a presentation-layer transform only: it never mutates canonical
 * segment values, so navigation, search, highlighting and recitation — all
 * keyed on segment identity — are unaffected.
 *
 * Matching policy (mirrored by the app's Helpers/DivineNameMasking.cs —
 * keep both in sync):
 *
 * - A candidate is a single whitespace-delimited word. Trailing
 *   punctuation (paseq ׀, maqaf ־, sof pasuk ׃, spaces) is stripped for
 *   matching and re-appended untouched. Words containing any non-Hebrew,
 *   non-combining-mark character in their body (e.g. an internal maqaf in
 *   a multi-word string) are never matched.
 * - Matching compares base Hebrew letters only (NFD); niqqud, taamim and
 *   other combining marks are ignored for letter comparison and are
 *   dropped from the output so no orphaned marks are left behind.
 * - Attached clitic prefixes are allowed and preserved (as bare letters,
 *   without their vowels) ahead of the replacement:
 *     יהוה / אלהים-family / שדי: one or two letters from ו ב כ ל מ ה ש
 *       (covers ובאלהים, מהאלהים, ולה', שה' …)
 *     אל: one letter from ו ב כ ל מ ה, or ו followed by one of ב כ ל מ ה
 *       (deliberately excludes ש — שאל/שמואל must not match — and excludes
 *       non-ו double prefixes so הואל "the tent" cannot match).
 * - יהוה matches when the remaining letters are exactly יהוה.
 * - אלהים-family matches three stems with closed, corpus-verified
 *   suffix inventories (inflected and Aramaic forms):
 *     אלהי + {∅, ם, ו, ך, יך, כם, כן, נו, ה, הו, הם, הן, מו}
 *     אלוה + {∅, י, יך, יו, יכם, יכן, ינו, ה, הו, הם, הן}
 *     אלה  + {א, יא, ה, הם, הון, ין, ך, כם, כון, ו, הו, נא}   (never bare —
 *       אֵלֶּה "these" must not match)
 * - אל matches only the exact letters אל after the prefix, and only when
 *   the aleph carries tzeire (אֵל) or is unpointed. Pointed אֶל/אַל/אֲל
 *   ("to"/"don't") never match. Known homograph limitation, documented:
 *   unpointed אל and אֵל demonstratives ("these") are masked too — the
 *   pointing is the only signal available and it is absent/ambiguous.
 * - שדי matches the exact letters שדי only when ש has no sin dot
 *   (excludes שְׂדֵי "my fields") and either ד bears dagesh or the word is
 *   fully unpointed (unpointed שדי is masked — שָׂדַי unpointed is an
 *   accepted false positive, same documented ambiguity).
 * - Replacement styles, applied to the matched stem letters (suffixes are
 *   kept as bare letters, prefixes likewise; all marks are dropped):
 *     אלהים-family "אלקים": first ה of the stem becomes ק; when the stem
 *       ends in ה (אלוה/אלה), an ה is appended so אלוה→אלוקה. Suffixes are
 *       kept: אלוהינו→אלוקינו.
 *     "א-להים" style: an ASCII hyphen is inserted after the first stem
 *       letter (א-להים, א-ל, שד-י).
 *     יהוה: ה' or ד' replace the whole stem.
 *     custom (אחר): the user text replaces the whole stem; prefix/suffix
 *       letters are kept. Empty/blank custom text falls back to leaving
 *       the word untouched for that name.
 */
export type DivineNameKey = "elohim" | "yhwh" | "el" | "shaddai";

export type ElohimMaskOption = "asis" | "elokim" | "hyphen" | "custom";
export type YhwhMaskOption = "heh" | "dalet" | "custom";
export type ElMaskOption = "asis" | "hyphen";
export type ShaddaiMaskOption = "asis" | "hyphen" | "custom";

export type DivineNameMaskingSettings = {
	enabled: boolean;
	elohim: ElohimMaskOption;
	/** User text for elohim "אחר". */
	elohimCustom: string;
	yhwh: YhwhMaskOption;
	yhwhCustom: string;
	el: ElMaskOption;
	shaddai: ShaddaiMaskOption;
	shaddaiCustom: string;
};

export const DEFAULT_DIVINE_NAME_MASKING: DivineNameMaskingSettings = {
	enabled: false,
	elohim: "hyphen",
	elohimCustom: "",
	yhwh: "heh",
	yhwhCustom: "",
	el: "asis",
	shaddai: "asis",
	shaddaiCustom: "",
};

const MAQAF = "־";

const isHebrewLetter = (ch: string): boolean =>
	ch >= "\u05d0" && ch <= "\u05ea";

/**
 * Combining mark check. Corpus-verified: every mark in the tanach text lives
 * in the Hebrew marks block 0591-05c7 (niqqud, taamim, dagesh, sin/shin dots,
 * rafe). Four punctuation codepoints sit inside that block and are NOT marks —
 * maqaf 05be, paseq 05c0, sof pasuk 05c3, nun hafukha 05c6 — so they are
 * excluded explicitly (mirroring the app's UnicodeCategory check). A range
 * test keeps this file regex-free (Codacy S5852).
 */
const isCombiningMark = (ch: string): boolean =>
	ch >= "\u0591" &&
	ch <= "\u05c7" &&
	ch !== "\u05be" &&
	ch !== "\u05c0" &&
	ch !== "\u05c3" &&
	ch !== "\u05c6";

/** Hebrew niqqud vowel points (sheva..hataf qamats, qamats qatan). */
const isNiqqud = (ch: string): boolean =>
	(ch >= "\u05b0" && ch <= "\u05bd") || ch === "\u05c7";
const hasNiqqud = (marks: string): boolean => [...marks].some(isNiqqud);
const TZEIRE = "\u05b5";
const DAGESH = "\u05bc";
const SIN_DOT = "\u05c2";

const CLITICS = "ובכלמהש";
const EL_CLITICS = "ובכלמה";

const ELOHIM_STEM_SUFFIXES: Readonly<Record<string, readonly string[]>> = {
	אלהי: [
		"",
		"ם",
		"ו",
		"ך",
		"יך",
		"כם",
		"כן",
		"נו",
		"ה",
		"הו",
		"הם",
		"הן",
		"מו",
	],
	אלוה: ["", "י", "יך", "יו", "יכם", "יכן", "ינו", "ה", "הו", "הם", "הן"],
	אלה: ["א", "יא", "ה", "הם", "הון", "ין", "ך", "כם", "כון", "ו", "הו", "נא"],
};

type LetterMarks = { letter: string; marks: string };

type DivineNameMatch = {
	key: DivineNameKey;
	/** Bare clitic prefix letters (marks dropped). */
	prefix: string;
	/** Matched stem letters (marks dropped). */
	stem: string;
	/** Stem suffix letters for the אלהים family (marks dropped). */
	suffix: string;
	/** Trailing punctuation re-appended after the replacement. */
	tail: string;
};

/**
 * Parses "pointed" text into base letters with their combining marks.
 * Returns null when the body holds anything else (spaces, punctuation,
 * digits) — such words can never be a divine name.
 */
function parseLetters(text: string): LetterMarks[] | null {
	const letters: LetterMarks[] = [];
	for (const ch of text.normalize("NFD")) {
		if (isHebrewLetter(ch)) letters.push({ letter: ch, marks: "" });
		else if (isCombiningMark(ch)) {
			const last = letters.at(-1);
			if (!last) return null;
			last.marks += ch;
		} else return null;
	}
	return letters.length ? letters : null;
}

/** Splits trailing non-Hebrew punctuation (paseq/maqaf/sof pasuk/space). */
function splitTail(value: string): [string, string] {
	let cut = value.length;
	while (
		cut > 0 &&
		!isHebrewLetter(value[cut - 1]) &&
		!isCombiningMark(value[cut - 1])
	) {
		cut--;
	}
	return [value.slice(0, cut), value.slice(cut)];
}

function cliticPrefixes(forEl: boolean): string[] {
	const singles = forEl ? EL_CLITICS : CLITICS;
	const prefixes = ["", ...singles];
	if (forEl) {
		for (const second of "בכלמה") prefixes.push(`ו${second}`);
	} else {
		for (const first of CLITICS)
			for (const second of CLITICS) prefixes.push(first + second);
	}
	// Longest first so a double clitic wins over a single one.
	return prefixes.sort((a, b) => b.length - a.length);
}

function matchEl(lm: LetterMarks[], restStart: number): boolean {
	const aleph = lm[restStart];
	if (aleph.marks.includes(TZEIRE)) return true;
	// Unpointed אל is treated as the name; any other vowel point
	// (אֶל/אַל/אֲל) is a different word.
	return !hasNiqqud(aleph.marks);
}

function matchShaddai(lm: LetterMarks[], restStart: number): boolean {
	const [shin, dalet, yod] = lm.slice(restStart, restStart + 3);
	if (shin.marks.includes(SIN_DOT)) return false;
	if (dalet.marks.includes(DAGESH)) return true;
	// Unpointed שדי is masked; a pointed שדי whose ד lacks dagesh
	// (שָׂדַי/שָׁדַי "my field") is not.
	return !hasNiqqud(shin.marks + dalet.marks + yod.marks);
}

function matchDivineName(value: string): DivineNameMatch | null {
	const [body, tail] = splitTail(value);
	const lm = parseLetters(body);
	if (!lm) return null;
	const letters = lm.map((l) => l.letter).join("");

	for (const prefix of cliticPrefixes(false)) {
		if (!letters.startsWith(prefix)) continue;
		const rest = letters.slice(prefix.length);
		if (rest === "יהוה") {
			return { key: "yhwh", prefix, stem: rest, suffix: "", tail };
		}
	}
	for (const prefix of cliticPrefixes(false)) {
		if (!letters.startsWith(prefix)) continue;
		const rest = letters.slice(prefix.length);
		// Longest stems first so אלהים parses as אלהי+ם, never אלה+ים.
		for (const stem of Object.keys(ELOHIM_STEM_SUFFIXES).sort(
			(a, b) => b.length - a.length,
		)) {
			if (
				rest.startsWith(stem) &&
				ELOHIM_STEM_SUFFIXES[stem].includes(rest.slice(stem.length))
			) {
				return {
					key: "elohim",
					prefix,
					stem,
					suffix: rest.slice(stem.length),
					tail,
				};
			}
		}
	}
	for (const prefix of cliticPrefixes(true)) {
		if (!letters.startsWith(prefix)) continue;
		const rest = letters.slice(prefix.length);
		if (rest === "אל" && matchEl(lm, prefix.length)) {
			return { key: "el", prefix, stem: rest, suffix: "", tail };
		}
	}
	for (const prefix of cliticPrefixes(false)) {
		if (!letters.startsWith(prefix)) continue;
		const rest = letters.slice(prefix.length);
		if (rest === "שדי" && matchShaddai(lm, prefix.length)) {
			return { key: "shaddai", prefix, stem: rest, suffix: "", tail };
		}
	}
	return null;
}

/** אלוהים→אלקים convention: first ה→ק; a stem-final ה is restored after it. */
function elokimStem(stem: string): string {
	const heh = stem.indexOf("ה");
	const replaced = `${stem.slice(0, heh)}ק${stem.slice(heh + 1)}`;
	return heh === stem.length - 1 ? `${replaced}ה` : replaced;
}

function maskStem(
	match: DivineNameMatch,
	settings: DivineNameMaskingSettings,
): string | null {
	switch (match.key) {
		case "yhwh":
			if (settings.yhwh === "heh") return "ה'";
			if (settings.yhwh === "dalet") return "ד'";
			return settings.yhwhCustom.trim() || null;
		case "elohim":
			if (settings.elohim === "asis") return null;
			if (settings.elohim === "elokim") return elokimStem(match.stem);
			if (settings.elohim === "hyphen")
				return `${match.stem[0]}-${match.stem.slice(1)}`;
			return settings.elohimCustom.trim() || null;
		case "el":
			return settings.el === "hyphen" ? "א-ל" : null;
		case "shaddai":
			if (settings.shaddai === "asis") return null;
			if (settings.shaddai === "hyphen") return "שד-י";
			return settings.shaddaiCustom.trim() || null;
	}
}

/**
 * Masks a single segment value when it is a divine name and masking is
 * enabled for it; otherwise returns the value unchanged. Safe for ptuha/
 * stuma markers too — they never match.
 */
export function maskDivineNameValue(
	value: string,
	settings: DivineNameMaskingSettings,
): string {
	if (!settings.enabled) return value;
	const match = matchDivineName(value);
	if (!match) return value;
	const stem = maskStem(match, settings);
	if (stem == null) return value;
	return match.prefix + stem + match.suffix + match.tail;
}

/**
 * Masks every divine-name word in a multi-word string (pasuk previews,
 * free-text quotes). Splits on spaces and maqaf so maqaf-joined compounds
 * are handled word-by-word; non-matching pieces pass through untouched.
 */
export function maskDivineNameText(
	text: string,
	settings: DivineNameMaskingSettings,
): string {
	if (!settings.enabled) return text;
	return text
		.split(" ")
		.map((word) =>
			word
				.split(MAQAF)
				.map((piece) => maskDivineNameValue(piece, settings))
				.join(MAQAF),
		)
		.join(" ");
}
