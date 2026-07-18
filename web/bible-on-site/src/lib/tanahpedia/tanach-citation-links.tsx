import { toNumber } from "gematry";
import Link from "next/link";
import type { ReactNode } from "react";
import { sefarim } from "@/data/db/sefarim";
import type {
	AdditionalsItem,
	SefarimItemWithPerakim,
} from "@/data/db/tanah-view-types";
import { normalizePasukSlugHyphens } from "@/lib/tanach/tanach-pasuk-range";

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function escapeRe(s: string): string {
	return s.replace(RE_ESCAPE, "\\$&");
}

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
let cachedRegex: RegExp | null = null;

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

function tanachRefRegex(): RegExp {
	if (cachedRegex) return cachedRegex;
	const alt = seferNamesForCitations().map(escapeRe).join("|");
	/* מילה עברית לפרק; פסוק אופציונלי — מילה אחת או טווח מילים עם מקף */
	const hebWord = `[א-ת](?:[א-ת"׳'"]{0,4})?`;
	cachedRegex = new RegExp(
		`(${alt})\\s+(${hebWord})(?:\\s+(${hebWord}(?:[-־]${hebWord})?))?`,
		"gu",
	);
	return cachedRegex;
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
): RegExpMatchArray | null {
	const re = tanachRefRegex();
	for (const m of line.matchAll(re)) {
		if ((m.index ?? 0) >= minIndex) {
			return m as RegExpMatchArray;
		}
	}
	return null;
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
	if (!refMatch?.[3]?.trim()) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	const seferC = refMatch[1];
	const perekRaw = refMatch[2];
	const pasukRaw = refMatch[3];
	const href = buildKetavVeKabbalah929PerushHref(seferC, perekRaw, pasukRaw);
	if (!href) {
		return renderCitationWithTanachLinks(line, linkClassName);
	}
	const linkEnd = (refMatch.index ?? 0) + refMatch[0].length;
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
	const re = tanachRefRegex();
	const nodes: ReactNode[] = [];
	let last = 0;
	re.lastIndex = 0;
	for (const m of text.matchAll(re)) {
		const full = m[0];
		const index = m.index ?? 0;
		if (index > last) {
			nodes.push(text.slice(last, index));
		}
		const seferC = m[1];
		const perekRaw = m[2];
		const pasukRaw = m[3];
		const href = tryTanachHref(seferC, perekRaw, pasukRaw);
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
