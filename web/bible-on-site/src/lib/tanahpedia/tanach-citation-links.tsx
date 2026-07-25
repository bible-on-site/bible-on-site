import { toNumber } from "gematry";
import Link from "next/link";
import type { ReactNode } from "react";
import { perushim } from "@/data/db/perushim";
import { sefarim } from "@/data/db/sefarim";
import type {
	AdditionalsItem,
	SefarimItemWithPerakim,
} from "@/data/db/tanah-view-types";
import { normalizePasukSlugHyphens } from "@/lib/tanach/tanach-pasuk-range";

interface TanachRefMatch {
	index: number;
	full: string;
	seferCitation: string;
	perekRaw: string;
	pasukRaw?: string;
}

const HEBREW_REF_TOKEN = /^[א-ת][א-ת"׳']{0,4}$/u;
const HEBREW_PASUK_TOKEN = /^[א-ת][א-ת"׳']{0,4}(?:[-־][א-ת][א-ת"׳']{0,4})?$/u;

/** ספר או כרך (למשל שמואל א) כפי שמופיע במקורות בטקסט */
function resolveSeferVolume(
	seferCitation: string,
): SefarimItemWithPerakim | AdditionalsItem | null {
	for (const s of sefarim) {
		if ("perakim" in s && s.name === seferCitation) {
			return s;
		}
		if ("additionals" in s) {
			const add = s.additionals.find((a) => a.name === seferCitation);
			if (add) return add;
		}
	}
	return null;
}

function perekIdsForVolume(
	vol: SefarimItemWithPerakim | AdditionalsItem,
): number[] {
	return Array.from(
		{ length: vol.perakim.length },
		(_, i) => vol.perekFrom + i,
	);
}

function normalizePerekLetters(raw: string): string {
	const first = raw.split(/[\s–—-]+/u)[0]?.trim() ?? raw;
	return first.replace(/"/g, "'");
}

let cachedNames: string[] | null = null;
function seferNamesForCitations(): string[] {
	if (cachedNames) return cachedNames;
	const keys = new Set<string>();
	for (const s of sefarim) {
		if ("perakim" in s) {
			keys.add(s.name);
		}
		if ("additionals" in s) {
			for (const a of s.additionals) {
				keys.add(a.name);
			}
		}
	}
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
	while (end < text.length && !isWhitespace(text[end])) end++;
	return { token: text.slice(start, end), end };
}

function findTanachRefAt(text: string, start: number): TanachRefMatch | null {
	for (const seferName of seferNamesForCitations()) {
		if (!text.startsWith(seferName, start)) continue;

		let cursor = start + seferName.length;
		if (!isWhitespace(text[cursor])) continue;
		while (isWhitespace(text[cursor])) cursor++;

		const perek = readToken(text, cursor);
		if (!HEBREW_REF_TOKEN.test(perek.token)) continue;
		cursor = perek.end;

		let pasukRaw: string | undefined;
		let end = cursor;
		if (isWhitespace(text[cursor])) {
			let pasukStart = cursor;
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

function findTanachRefMatches(text: string): TanachRefMatch[] {
	const matches: TanachRefMatch[] = [];
	let cursor = 0;
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
			.split(/[\s–—-]+/u)[0]
			?.trim() ?? "";
	if (!first) return null;
	const n = toNumber(first);
	return n != null && n > 0 ? n : null;
}

/** מנקה טקסט פסוק ל־ערך query (ללא רווחים סביב מקף) */
function compactPasukSlugForUrl(pasukRaw: string): string {
	return normalizePasukSlugHyphens(pasukRaw).replace(/\s+/g, "");
}

/**
 * קישור לפרק בתנ"ך לפי מקור (ספר+פרק[+פסוק]). `/929/{number}/[slug]`
 * תומך רק במאמר (מספרי) או שם פירוש — אין נתיב לעגינה על פסוק ספציפי
 * ללא פירוש — לכן פסוק מצוין כ־`?pasuk=` (נקרא ומסומן ב-`ScrollToPasuk`
 * בדף הפרק עצמו), ולא כ־slug בנתיב (זה היה גורם ל-404).
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
	const slug = compactPasukSlugForUrl(pasukTrim);
	if (!slug) {
		return `/929/${perekId}`;
	}
	return `/929/${perekId}?pasuk=${encodeURIComponent(slug)}`;
}

let cachedPerushNames: string[] | null = null;
/** כל שמות הפירושים הידועים באתר (מ־perushim.json), מהארוך לקצר להתאמה חמדנית. */
function perushNamesForCitations(): string[] {
	if (cachedPerushNames) return cachedPerushNames;
	cachedPerushNames = [...new Set(perushim.map((p) => p.name))].sort(
		(a, b) => b.length - a.length,
	);
	return cachedPerushNames;
}

/** מציאת ההתרחשות המוקדמת ביותר של שם פירוש ידוע כלשהו בטקסט — גנרי, לא תלוי בשם פירוש ספציפי. */
function findKnownPerushNameMatch(
	line: string,
): { name: string; index: number } | null {
	let best: { name: string; index: number } | null = null;
	for (const name of perushNamesForCitations()) {
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
	return findTanachRefMatches(line).find((m) => m.index >= minIndex) ?? null;
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
	const refMatch = firstTanachRefMatchFromIndex(line, perushMatch.index);
	if (!refMatch?.pasukRaw?.trim()) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	const seferC = refMatch.seferCitation;
	const perekRaw = refMatch.perekRaw;
	const pasukRaw = refMatch.pasukRaw;
	const href = build929PerushHref(seferC, perekRaw, pasukRaw, perushMatch.name);
	if (!href) {
		return renderCitationWithTanachLinks(line, linkClassName);
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
		<Link
			key={`perush929-${perushIdx}-${linkEnd}`}
			href={href}
			className={linkClassName}
		>
			{line.slice(perushIdx, linkEnd)}
		</Link>,
	);
	if (linkEnd < line.length) {
		nodes.push(
			...renderCitationWithTanachLinks(line.slice(linkEnd), linkClassName),
		);
	}
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
				<Link
					key={`tanach-${index}-${full}`}
					href={href}
					className={linkClassName}
				>
					{full}
				</Link>,
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
