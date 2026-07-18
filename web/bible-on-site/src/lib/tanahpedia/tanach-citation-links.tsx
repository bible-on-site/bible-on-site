import { toNumber } from "gematry";
import Link from "next/link";
import type { ReactNode } from "react";
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
	return first.replace(/[""]/g, "'");
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

function readToken(text: string, start: number): { token: string; end: number } {
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

/** מנקה טקסט פסוק ל־slug בנתיב (ללא רווחים סביב מקף) */
function compactPasukSlugForUrl(pasukRaw: string): string {
	return normalizePasukSlugHyphens(pasukRaw).replace(/\s+/g, "");
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
	const first = pasukRaw.trim().split(/[\s–—-]+/u)[0]?.trim() ?? "";
	if (!first) return null;
	const n = toNumber(first);
	return n != null && n > 0 ? n : null;
}

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
	return `/929/${perekId}/${encodeURIComponent(slug)}`;
}

/** שם הפירוש ב־929 (כפי ב־perushim.json) */
export const PERUSH_NAME_HAKTAV_VEKABBALAH = "הכתב והקבלה";

const KETAV_VEKABBALAH_PHRASE = "הכתב והקבלה";

/**
 * דף על הפרק + פירוש הכתב והקבלה; `?pasuk=` גולל לבלוק ההערה לפסוק בפירוש.
 */
export function buildKetavVeKabbalah929PerushHref(
	seferCitation: string,
	perekRaw: string,
	pasukRaw: string,
): string | null {
	const perekId = getPerekIdForTanachRef(seferCitation, perekRaw);
	if (perekId == null) return null;
	const pasukNum = pasukLettersToPositiveInt(pasukRaw);
	const slug = encodeURIComponent(PERUSH_NAME_HAKTAV_VEKABBALAH);
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

/** שורת מקור בעץ משפחה: קישור אחד מ«הכתב והקבלה» עד הפסוק — ל־929 בפירוש הכתב והקבלה */
export function renderFamilyTreeCitationLine(
	line: string,
	linkClassName: string,
): ReactNode[] {
	const kvkIdx = line.indexOf(KETAV_VEKABBALAH_PHRASE);
	if (kvkIdx === -1) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	const refMatch = firstTanachRefMatchFromIndex(line, kvkIdx);
	if (!refMatch?.pasukRaw?.trim()) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	const seferC = refMatch.seferCitation;
	const perekRaw = refMatch.perekRaw;
	const pasukRaw = refMatch.pasukRaw;
	const href = buildKetavVeKabbalah929PerushHref(seferC, perekRaw, pasukRaw);
	if (!href) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	const linkEnd = refMatch.index + refMatch.full.length;
	const nodes: ReactNode[] = [];
	if (kvkIdx > 0) {
		nodes.push(
			...renderCitationWithTanachLinks(line.slice(0, kvkIdx), linkClassName),
		);
	}
	nodes.push(
		<Link
			key={`kvk929-${kvkIdx}-${linkEnd}`}
			href={href}
			className={linkClassName}
		>
			{line.slice(kvkIdx, linkEnd)}
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
