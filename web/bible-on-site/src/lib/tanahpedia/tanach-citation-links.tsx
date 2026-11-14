import { toNumber } from "gematry";
import { Fragment, type ReactNode } from "react";
import { PasukPreviewLink } from "@/app/pedia/components/PasukPreviewLink";
import catalog from "@/data/db/client-catalog.generated.json";
import { perushNames } from "@/data/db/perush-names";

type SeferVolume = (typeof catalog.volumes)[number];

interface TanachRefMatch {
	index: number;
	full: string;
	seferCitation: string;
	perekRaw: string;
	pasukRaw?: string;
}

const HEBREW_REF_TOKEN = /^[א-ת][א-ת"״׳']{0,4}$/u;
const HEBREW_PASUK_TOKEN =
	/^[א-ת][א-ת"״׳']{0,4}(?:[-־–—][א-ת][א-ת"״׳']{0,4})?$/u;
const PERUSH_REF_SEPARATOR = /^[\s\p{P}]*(?:על[\s\p{P}]*)?$/u;

function stripParentheticalAnnotations(text: string): string {
	const characters: string[] = [];
	const openings: number[] = [];
	for (const character of text) {
		if (character === "(") {
			openings.push(characters.length);
			characters.push(character);
		} else if (character === ")") {
			const opening = openings.pop();
			if (opening === undefined) {
				characters.push(character);
			} else {
				characters.length = opening;
			}
		} else {
			characters.push(character);
		}
	}
	return characters.join("");
}

function plainNumeral(raw: string): string {
	return raw.replace(/["״׳']/gu, "").replace(/[־–—]/gu, "-");
}

function displayTanachRef(match: TanachRefMatch): string {
	return `${match.seferCitation} ${plainNumeral(match.perekRaw)}${match.pasukRaw ? ` ${plainNumeral(match.pasukRaw)}` : ""}`;
}

/** ספר או כרך (למשל שמואל א) כפי שמופיע במקורות בטקסט */
function resolveSeferVolume(seferCitation: string): SeferVolume | null {
	return (
		catalog.volumes.find((volume) => volume.name === seferCitation) ?? null
	);
}

function perekIdsForVolume(vol: SeferVolume): number[] {
	return Array.from(
		{ length: vol.perekTo - vol.perekFrom + 1 },
		(_, i) => vol.perekFrom + i,
	);
}

function normalizePerekLetters(raw: string): string {
	const first = raw.split(/[\s־–—-]+/u)[0]?.trim() ?? raw;
	return plainNumeral(first);
}

let cachedNames: string[] | null = null;
function seferNamesForCitations(): string[] {
	if (cachedNames) return cachedNames;
	const keys = new Set(catalog.volumes.map(({ name }) => name));
	cachedNames = [...keys].sort((a, b) => b.length - a.length);
	return cachedNames;
}

function isWhitespace(ch: string | undefined): boolean {
	return ch != null && /\s/u.test(ch);
}

function readToken(
	text: string,
	start: number,
): { token: string; end: number } {
	let end = start;
	while (
		end < text.length &&
		!isWhitespace(text[end]) &&
		!",;:.()[]{}".includes(text[end])
	) {
		end++;
	}
	return { token: text.slice(start, end), end };
}

function findTanachRefAt(text: string, start: number): TanachRefMatch | null {
	for (const seferName of seferNamesForCitations()) {
		if (!text.startsWith(seferName, start)) continue;

		let cursor = start + seferName.length;
		// Older citations may quote the book's volume letter, e.g. שמואל א'.
		const volumeQuote = text[cursor];
		if (volumeQuote && "\"״׳'".includes(volumeQuote)) cursor++;
		if (!isWhitespace(text[cursor])) continue;
		while (isWhitespace(text[cursor])) cursor++;

		const perek = readToken(text, cursor);
		if (!HEBREW_REF_TOKEN.test(perek.token)) continue;
		cursor = perek.end;

		let pasukRaw: string | undefined;
		let end = cursor;
		if (isWhitespace(text[cursor]) || text[cursor] === ",") {
			let pasukStart = cursor;
			if (text[pasukStart] === ",") pasukStart++;
			while (isWhitespace(text[pasukStart])) pasukStart++;
			const pasuk = readToken(text, pasukStart);
			if (HEBREW_PASUK_TOKEN.test(pasuk.token)) {
				pasukRaw = pasuk.token;
				end = pasuk.end;
			}
		}

		return {
			index: start,
			full: text.slice(start, end),
			seferCitation: seferName,
			perekRaw: perek.token,
			pasukRaw,
		};
	}
	return null;
}

function findTanachRefMatches(text: string, startIndex = 0): TanachRefMatch[] {
	const matches: TanachRefMatch[] = [];
	let cursor = startIndex;
	while (cursor < text.length) {
		const match = findTanachRefAt(text, cursor);
		if (!match) {
			cursor++;
			continue;
		}
		matches.push(match);
		cursor = match.index + match.full.length;
	}
	return matches;
}

function getPerekIdForTanachRef(
	seferCitation: string,
	perekRaw: string,
): number | null {
	const vol = resolveSeferVolume(seferCitation);
	if (!vol) return null;
	const perekLetters = normalizePerekLetters(perekRaw);
	const perekNum = toNumber(perekLetters);
	if (!perekNum || perekNum < 1) return null;
	const ids = perekIdsForVolume(vol);
	if (perekNum > ids.length) return null;
	return ids[perekNum - 1];
}

function pasukLettersToPositiveInt(pasukRaw: string): number | null {
	const first =
		pasukRaw
			.trim()
			.split(/[\s־–—-]+/u)[0]
			?.trim() ?? "";
	if (!first) return null;
	const n = toNumber(plainNumeral(first));
	return n != null && n > 0 ? n : null;
}

/**
 * קישור לפרק בתנ"ך לפי מקור (ספר+פרק[+פסוק]). `/929/{number}#pasuk-{number}`
 * עוגן הפסוק נתמך גם בטעינה ישירה וגם בניווט באמצעות Next.js.
 */
function tryTanachHref(
	seferCitation: string,
	perekRaw: string,
	pasukRaw?: string,
): string | null {
	const perekId = getPerekIdForTanachRef(seferCitation, perekRaw);
	if (perekId == null) return null;
	const pasukTrim = pasukRaw?.trim();
	if (!pasukTrim) {
		return `/929/${perekId}`;
	}
	const pasukNum = pasukLettersToPositiveInt(pasukTrim);
	if (pasukNum == null) {
		return `/929/${perekId}`;
	}
	return `/929/${perekId}#pasuk-${pasukNum}`;
}

/** מציאת ההתרחשות המוקדמת ביותר של שם פירוש ידוע כלשהו בטקסט — גנרי, לא תלוי בשם פירוש ספציפי. */
function findKnownPerushNameMatch(
	line: string,
): { name: string; index: number } | null {
	let best: { name: string; index: number } | null = null;
	for (const name of perushNames) {
		const idx = line.indexOf(name);
		if (idx === -1) continue;
		if (
			!best ||
			idx < best.index ||
			(idx === best.index && name.length > best.name.length)
		) {
			best = { name, index: idx };
		}
	}
	return best;
}

/**
 * דף על הפרק + פירוש נתון (כל פירוש שקיים באתר, לפי שמו); `?pasuk=` גולל
 * לבלוק ההערה לפסוק בפירוש.
 */
export function build929PerushHref(
	seferCitation: string,
	perekRaw: string,
	pasukRaw: string,
	perushName: string,
): string | null {
	const perekId = getPerekIdForTanachRef(seferCitation, perekRaw);
	if (perekId == null) return null;
	const pasukNum = pasukLettersToPositiveInt(pasukRaw);
	const slug = encodeURIComponent(perushName);
	if (pasukNum != null) {
		return `/929/${perekId}/${slug}?pasuk=${pasukNum}`;
	}
	return `/929/${perekId}/${slug}`;
}

function firstTanachRefMatchFromIndex(
	line: string,
	minIndex: number,
): TanachRefMatch | null {
	return findTanachRefMatches(line, minIndex)[0] ?? null;
}

/**
 * שורת מקור בעץ משפחה: כאשר הטקסט מזכיר שם פירוש קיים באתר (כל פירוש, לא
 * תלוי בשם ספציפי) ולאחריו מקור בתנ"ך עם פסוק — קישור אחד משם הפירוש עד
 * הפסוק, ל־929 באותו פירוש. אחרת (או כשאין פסוק) — קישורי תנ"ך רגילים.
 */
export function renderFamilyTreeCitationLine(
	line: string,
	linkClassName: string,
): ReactNode[] {
	const perushMatch = findKnownPerushNameMatch(line);
	if (!perushMatch) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	// A work title may contain a Bible book name without using its coordinates.
	const perushEnd = perushMatch.index + perushMatch.name.length;
	const refMatch = firstTanachRefMatchFromIndex(line, perushEnd);
	const separator = refMatch
		? stripParentheticalAnnotations(line.slice(perushEnd, refMatch.index))
		: "";
	const followsSeparator = PERUSH_REF_SEPARATOR.test(separator);
	const isMidrash = /^(?:מדרש|מכילתא)(?:\s|$)/u.test(perushMatch.name);
	const nextSemicolon = line.indexOf(";", perushEnd);
	const clauseEnd = nextSemicolon === -1 ? line.length : nextSemicolon;
	const hasExplicitBibleReference =
		refMatch != null &&
		refMatch.index < clauseEnd &&
		followsSeparator &&
		separator.includes("על");
	// Midrash source coordinates can resemble a Bible reference. Require על
	// before treating them as Bible coordinates; otherwise protect the clause.
	const literalEnd =
		isMidrash && !hasExplicitBibleReference ? clauseEnd : perushEnd;
	const renderRemainingCitations = (start: number): ReactNode[] =>
		start < line.length
			? [
					<Fragment key={`citation-tail-${start}`}>
						{renderFamilyTreeCitationLine(line.slice(start), linkClassName)}
					</Fragment>,
				]
			: [];
	const renderWithLiteralPerushCitation = (): ReactNode[] => [
		...renderCitationWithTanachLinks(
			line.slice(0, perushMatch.index),
			linkClassName,
		),
		line.slice(perushMatch.index, literalEnd),
		...renderRemainingCitations(literalEnd),
	];
	if (
		!refMatch?.pasukRaw?.trim() ||
		!followsSeparator ||
		(isMidrash && !hasExplicitBibleReference)
	) {
		return renderWithLiteralPerushCitation();
	}
	const seferC = refMatch.seferCitation;
	const perekRaw = refMatch.perekRaw;
	const pasukRaw = refMatch.pasukRaw;
	const href = build929PerushHref(seferC, perekRaw, pasukRaw, perushMatch.name);
	if (!href) {
		return renderWithLiteralPerushCitation();
	}
	const perushIdx = perushMatch.index;
	const linkEnd = refMatch.index + refMatch.full.length;
	const nodes: ReactNode[] = [];
	if (perushIdx > 0) {
		nodes.push(
			...renderCitationWithTanachLinks(line.slice(0, perushIdx), linkClassName),
		);
	}
	nodes.push(
		<PasukPreviewLink
			key={`perush929-${perushIdx}-${linkEnd}`}
			href={href}
			className={linkClassName}
		>
			{line.slice(perushIdx, refMatch.index) + displayTanachRef(refMatch)}
		</PasukPreviewLink>,
	);
	nodes.push(...renderRemainingCitations(linkEnd));
	return nodes.length > 0 ? nodes : [line];
}

export function renderCitationWithTanachLinks(
	text: string,
	linkClassName: string,
): ReactNode[] {
	const nodes: ReactNode[] = [];
	let last = 0;
	for (const match of findTanachRefMatches(text)) {
		const { full, index, seferCitation, perekRaw, pasukRaw } = match;
		if (index > last) {
			nodes.push(text.slice(last, index));
		}
		const href = tryTanachHref(seferCitation, perekRaw, pasukRaw);
		if (href) {
			nodes.push(
				<PasukPreviewLink
					key={`tanach-${index}-${full}`}
					href={href}
					className={linkClassName}
				>
					{displayTanachRef(match)}
				</PasukPreviewLink>,
			);
		} else {
			nodes.push(full);
		}
		last = index + full.length;
	}
	if (last < text.length) {
		nodes.push(text.slice(last));
	}
	return nodes.length > 0 ? nodes : [text];
}
