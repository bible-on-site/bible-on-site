/**
 * Deterministic scripture-citation extraction (#3103 heuristic draft path).
 *
 * Articles cite pesukim in bounded forms — "בראשית יח, ב", "שמואל ב ה, ז-ח",
 * "בראשית פרק יח פסוק ב" — that resolve to canonical {perekId, pasuk}
 * coordinates through the shared catalogue. Each extraction keeps the exact
 * matched surface as its evidence quote; ambiguous citations are surfaced
 * (never resolved by guessing).
 */
import {
	cataloguePasukLabel,
	cataloguePerekLabel,
	normalizeHebrewName,
	resolvePerekRef,
	SEFER_ALIASES,
	type TargetCatalogue,
} from "./catalogue";
import { parseHebrewNumber } from "./hebrew-numerals";
import type { ProposalEvidence } from "./types";

/** A citation resolved to concrete canonical coordinates. */
export interface ResolvedCitation {
	perekId: number;
	/** First pasuk of the cited (possibly ranged) reference. */
	pasuk: number;
	/** Last pasuk; equals `pasuk` for single-verse citations. */
	pasukTo: number;
	label: string;
	quote: string;
	spanStart: number;
	spanEnd: number;
}

/** A citation-looking span the extractor refused to resolve. */
export interface AmbiguousCitation {
	quote: string;
	spanStart: number;
	spanEnd: number;
	reason: string;
}

export interface CitationExtraction {
	resolved: ResolvedCitation[];
	ambiguous: AmbiguousCitation[];
}

/** Cap on a single citation's pasuk range — wider claims need human review. */
export const MAX_CITATION_RANGE = 30;

/** Canonical + alias names, normalized — the same set catalogue resolution
 * uses, so both paths agree on what counts as a sefer name. */
function seferNameSet(catalogue: TargetCatalogue): Set<string> {
	const names = new Set<string>();
	for (const perek of catalogue.perakim) {
		names.add(normalizeHebrewName(perek.seferName));
	}
	for (const alias of Object.keys(SEFER_ALIASES)) {
		names.add(normalizeHebrewName(alias));
	}
	return names;
}

/**
 * Resolves a captured sefer slot to the surface form of a known sefer name.
 * Every letter-granular start position is tried left-to-right, so prefixed
 * surfaces ("בבראשית") resolve exactly like an alternation's leftmost match
 * and noise words before the name ("ראה שמואל") are skipped.
 */
function seferSuffix(
	slot: string,
	names: Set<string>,
): { sefer: string; offset: number } | null {
	for (let i = 0; i < slot.length; i++) {
		const ch = slot[i];
		// A name starts on a letter — never on whitespace or a quote mark.
		if (/\s/.test(ch) || ch === '"' || ch === "'" || ch === "׳" || ch === "״")
			continue;
		const candidate = slot.slice(i);
		if (names.has(normalizeHebrewName(candidate))) {
			return { sefer: candidate, offset: i };
		}
	}
	return null;
}

interface RawSpan {
	sefer: string;
	/** The raw token right after the sefer (Pattern A) or before פרק (Pattern B),
	 * or the first token of a bare citation (Pattern C). */
	leadToken: string | null;
	/** Numeric tokens after any additional slot: perek, pasuk[, pasukTo]. */
	numbers: number[];
	/**
	 * Pattern C (bare space-separated form, e.g. "יהושע כג א"): no comma, so
	 * for non-additional sefarim the leadToken IS the perek token and must be
	 * prepended back to numbers.
	 */
	bareForm: boolean;
	quote: string;
	spanStart: number;
	spanEnd: number;
}

/**
 * Finds raw citation-shaped spans by scanning atoms in code — deliberately
 * NOT a regex exec loop over user text. Linear-time scanning is immune to
 * the ReDoS shapes static analyzers flag (nested quantifiers, overlapping
 * character classes), and keeps every semantic rule visible:
 *
 * Form A (comma): `<sefer> [<num>] <num> , <num> (-<num>)?` — an explicit
 * comma between the perek slot and the pasuk slot keeps "בראשית ברא" from
 * matching.
 * Form B (keywords): `<sefer> [<num>] פרק <num> [,] פסוק(ים) <num> (-<num>)?`.
 * Form C (bare): `<sefer> <num> <num> [<num>] (-<num>)?` — the repo's
 * space-separated convention ("יהושע כג א"); the first numeral doubles as
 * the additional letter for split sefarim or the perek for plain ones.
 *
 * The sefer slot is up to 3 word atoms resolved by `seferSuffix` (the
 * longest canonical name, "דברי הימים", is two); numeral atoms keep the
 * exact HEBREW_NUMBER_PATTERN shape — ≤3 letters, optionally a quote mark
 * plus ≤3 more letters — enforced structurally in `isNumeralAtom`.
 */
interface Atom {
	text: string;
	start: number;
	end: number;
}

const ATOM_RUN = /[א-ת"'׳״]+|\S/g;
const WORD_ATOM = /^[א-ת"'׳״]+$/;
const MARK = /["'׳״]/g;

function tokenize(plainText: string): Atom[] {
	const atoms: Atom[] = [];
	ATOM_RUN.lastIndex = 0;
	for (let m = ATOM_RUN.exec(plainText); m; m = ATOM_RUN.exec(plainText)) {
		atoms.push({ text: m[0], start: m.index, end: m.index + m[0].length });
	}
	return atoms;
}

function isWord(atom: Atom | undefined): boolean {
	return atom !== undefined && WORD_ATOM.test(atom.text);
}

/** The inlined numeral shape + a successful Hebrew-number parse. */
function numeral(atom: Atom | undefined): number | null {
	if (atom === undefined || !WORD_ATOM.test(atom.text)) return null;
	const letters = atom.text.replace(MARK, "");
	if (letters.length === 0) return null;
	const hasMark = letters.length !== atom.text.length;
	if (!hasMark && letters.length > 3) return null;
	if (hasMark) {
		const first = atom.text.search(/["'׳״]/);
		const after = letters.length - first;
		if (first < 1 || first > 3 || after < 1 || after > 3) return null;
	}
	return parseHebrewNumber(atom.text);
}

const isDash = (atom: Atom | undefined) =>
	atom !== undefined && (atom.text === "-" || atom.text === "–");

/** Consumes `-<num>` after `atoms[i]`; returns the end atom index + value. */
function rangeTail(
	atoms: Atom[],
	i: number,
): { endIndex: number; pasukTo: number } | null {
	const value = isDash(atoms[i]) ? numeral(atoms[i + 1]) : null;
	return value === null ? null : { endIndex: i + 1, pasukTo: value };
}

/**
 * The ≤3 word atoms immediately before `numStart`, returned with the
 * resolved sefer. Mirrors the former lazy regex slot: noise words fall out
 * through `seferSuffix`, which tries every letter-granular start.
 */
function slotBefore(
	atoms: Atom[],
	numStart: number,
	names: Set<string>,
	plainText: string,
): { sefer: string; spanStart: number } | null {
	let first = numStart - 1;
	if (!isWord(atoms[first])) return null;
	while (numStart - first < 3 && isWord(atoms[first - 1])) {
		first -= 1;
	}
	const slotStart = atoms[first].start;
	const slotText = plainText.slice(slotStart, atoms[numStart - 1].end);
	const hit = seferSuffix(slotText, names);
	if (!hit) return null;
	return { sefer: hit.sefer, spanStart: slotStart + hit.offset };
}

function pushSpan(
	spans: RawSpan[],
	slot: { sefer: string; spanStart: number },
	fields: Pick<RawSpan, "leadToken" | "numbers" | "bareForm">,
	endAtom: Atom,
	plainText: string,
): void {
	const quote = plainText.slice(slot.spanStart, endAtom.end).trim();
	spans.push({
		sefer: slot.sefer,
		leadToken: fields.leadToken,
		numbers: fields.numbers,
		bareForm: fields.bareForm,
		quote,
		spanStart: slot.spanStart,
		spanEnd: slot.spanStart + quote.length,
	});
}

function findSpans(plainText: string, names: Set<string>): RawSpan[] {
	const atoms = tokenize(plainText);
	const spans: RawSpan[] = [];

	// Form A — `<sefer> [<num>] <num> , <num> (-<num>)?`, anchored on commas.
	for (let i = 0; i < atoms.length; i += 1) {
		if (atoms[i].text !== ",") continue;
		const perek = numeral(atoms[i - 1]);
		const pasuk = numeral(atoms[i + 1]);
		if (perek === null || pasuk === null) continue;
		const lead = numeral(atoms[i - 2]);
		const numStart = lead === null ? i - 1 : i - 2;
		const slot = slotBefore(atoms, numStart, names, plainText);
		if (!slot) continue;
		const tail = rangeTail(atoms, i + 2);
		pushSpan(
			spans,
			slot,
			{
				leadToken: lead === null ? null : atoms[i - 2].text,
				numbers: tail ? [perek, pasuk, tail.pasukTo] : [perek, pasuk],
				bareForm: false,
			},
			tail ? atoms[tail.endIndex] : atoms[i + 1],
			plainText,
		);
	}

	// Form B — `<sefer> [<num>] פרק <num> [,] פסוק(ים) <num> (-<num>)?`.
	for (let i = 0; i < atoms.length; i += 1) {
		const word = atoms[i].text;
		if (word !== "פסוק" && word !== "פסוקים") continue;
		const pasuk = numeral(atoms[i + 1]);
		if (pasuk === null) continue;
		let perekIndex = i - 1;
		if (atoms[perekIndex]?.text === ",") perekIndex -= 1;
		const perek = numeral(atoms[perekIndex]);
		if (perek === null || atoms[perekIndex - 1]?.text !== "פרק") continue;
		const lead = numeral(atoms[perekIndex - 2]);
		// The sefer slot ends just before the additional lead or before פרק.
		const numStart = lead === null ? perekIndex - 1 : perekIndex - 2;
		const slot = slotBefore(atoms, numStart, names, plainText);
		if (!slot) continue;
		const tail = rangeTail(atoms, i + 2);
		pushSpan(
			spans,
			slot,
			{
				leadToken: lead === null ? null : atoms[perekIndex - 2].text,
				numbers: tail ? [perek, pasuk, tail.pasukTo] : [perek, pasuk],
				bareForm: false,
			},
			tail ? atoms[tail.endIndex] : atoms[i + 1],
			plainText,
		);
	}

	// Form C — `<sefer> <num> <num> [<num>] (-<num>)?`, bare space-separated.
	for (let i = 0; i + 1 < atoms.length; i += 1) {
		const lead = numeral(atoms[i]);
		const second = numeral(atoms[i + 1]);
		if (lead === null || second === null) continue;
		const slot = slotBefore(atoms, i, names, plainText);
		if (!slot) continue;
		const third = numeral(atoms[i + 2]);
		const afterThird = third === null ? i + 2 : i + 3;
		const tail = rangeTail(atoms, afterThird);
		pushSpan(
			spans,
			slot,
			{
				leadToken: atoms[i].text,
				numbers: [
					second,
					...(third === null ? [] : [third]),
					...(tail ? [tail.pasukTo] : []),
				],
				bareForm: true,
			},
			tail
				? atoms[tail.endIndex]
				: third === null
					? atoms[i + 1]
					: atoms[i + 2],
			plainText,
		);
	}
	return spans;
}

/** The sefer's existing additional letters (שמואל→{א,ב}, עזרא→{ע,נ}). */
function additionalLettersOf(
	catalogue: TargetCatalogue,
	seferName: string,
): Set<string> {
	const normalized = normalizeHebrewName(seferName);
	const letters = new Set<string>();
	for (const perek of catalogue.perakim) {
		if (
			normalizeHebrewName(perek.seferName) === normalized &&
			perek.additionalLetter
		) {
			letters.add(perek.additionalLetter);
		}
	}
	return letters;
}

function ambiguous(span: RawSpan, reason: string): AmbiguousCitation {
	return {
		quote: span.quote,
		spanStart: span.spanStart,
		spanEnd: span.spanEnd,
		reason,
	};
}

/** Resolves one raw span into canonical coordinates — or a held ambiguity. */
function interpret(
	span: RawSpan,
	catalogue: TargetCatalogue,
): ResolvedCitation | AmbiguousCitation | null {
	const alias = SEFER_ALIASES[span.sefer];
	const canonicalSefer = alias?.sefer ?? span.sefer;
	const letters = additionalLettersOf(catalogue, canonicalSefer);

	let additional = alias?.additional ?? null;
	let numbers = span.numbers;
	if (letters.size > 0 && additional === null) {
		// The lead token sits before the numbers list in all three patterns.
		const lead = span.leadToken?.replace(/["'׳״]/g, "") ?? null;
		if (lead !== null && letters.has(lead)) {
			// "שמואל ב ה, ז" / "שמואל ב ה ז": the lead token is the additional letter.
			additional = lead;
		} else {
			// "שמואל ה, ז" (missing letter) and "שמואל א, ג" (א could be the
			// additional or the perek) are both unresolvable without guessing.
			return ambiguous(
				span,
				`"${span.quote}" — ${span.sefer} has additionals and the citation does not pin one unambiguously`,
			);
		}
	} else if (span.bareForm && span.leadToken !== null) {
		// Bare form on a plain (or alias-pinned) sefer: the first token is the
		// perek itself — prepend it back onto the numbers list.
		const leadNum = parseHebrewNumber(span.leadToken);
		/* istanbul ignore next -- bareForm spans are only emitted for a lead
		   token that already parsed as a numeral */
		if (leadNum !== null) numbers = [leadNum, ...numbers];
	}

	if (numbers.length < 2 || numbers.length > 3) return null;
	const [perek, pasuk, pasukTo = pasuk] = numbers;
	if (pasukTo < pasuk || pasukTo - pasuk >= MAX_CITATION_RANGE) {
		return ambiguous(span, `implausible pasuk range in "${span.quote}"`);
	}

	const resolution = resolvePerekRef(catalogue, {
		sefer: canonicalSefer,
		additional,
		perek,
		pasuk,
	});
	if (resolution.kind === "not-found") return null;
	if (resolution.kind === "ambiguous") {
		return ambiguous(
			span,
			`"${span.quote}" matches ${resolution.candidates.length} perakim`,
		);
	}
	const resolvedPerek = resolution.perek;
	if (resolvedPerek.pasukCount !== null && pasukTo > resolvedPerek.pasukCount) {
		return ambiguous(
			span,
			`pasuk ${pasukTo} out of range for ${cataloguePerekLabel(resolvedPerek)} (1-${resolvedPerek.pasukCount})`,
		);
	}
	return {
		perekId: resolvedPerek.id,
		pasuk,
		pasukTo,
		label:
			pasukTo === pasuk
				? cataloguePasukLabel(resolvedPerek, pasuk)
				: `${cataloguePasukLabel(resolvedPerek, pasuk)}-${pasukTo}`,
		quote: span.quote,
		spanStart: span.spanStart,
		spanEnd: span.spanEnd,
	};
}

/**
 * Extracts every pasuk-level citation from the article's plain-text view.
 * Deterministic: same input ⇒ same output — the offline draft path's
 * evidence anchor.
 */
export function extractCitations(
	plainText: string,
	catalogue: TargetCatalogue,
): CitationExtraction {
	const names = seferNameSet(catalogue);
	const resolved: ResolvedCitation[] = [];
	const ambiguous: AmbiguousCitation[] = [];
	for (const span of findSpans(plainText, names)) {
		const outcome = interpret(span, catalogue);
		if (!outcome) continue;
		if ("reason" in outcome) ambiguous.push(outcome);
		else resolved.push(outcome);
	}
	return { resolved, ambiguous };
}

/** Evidence record for a resolved citation. */
export function citationEvidence(citation: ResolvedCitation): ProposalEvidence {
	return {
		quote: citation.quote,
		spanStart: citation.spanStart,
		spanEnd: citation.spanEnd,
	};
}
