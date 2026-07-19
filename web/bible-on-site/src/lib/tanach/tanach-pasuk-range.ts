import { toNumber } from "gematry";

/** מנרמל מקף עברי (מקף) למקף ASCII לניתוח אחיד */
export function normalizePasukSlugHyphens(slug: string): string {
	return slug.trim().replace(/\u05be/g, "-");
}

function normalizeLettersToken(raw: string): string {
	return raw.replace(/["׳]/g, "'").trim();
}

/**
 * מפרש מזהה פסוק בנתיב: אות עברית אחת או טווח `א-י` (מקף ASCII או עברי).
 * `maxVerse` — מספר פסוקים בפרק (1-based).
 */
export function parsePasukSlugToRange(
	slug: string,
	maxVerse: number,
): { start: number; end: number } | null {
	if (maxVerse < 1) return null;
	const decoded = decodeURIComponent(slug);
	const normalized = normalizePasukSlugHyphens(decoded);
	const parts = normalized
		.split("-")
		.map((p) => normalizeLettersToken(p))
		.filter((p) => p.length > 0);
	if (parts.length === 0 || parts.length > 2) return null;
	const nums = parts.map((p) => toNumber(p));
	if (nums.some((n) => !n || n < 1 || !Number.isFinite(n))) return null;
	const startRaw = nums[0];
	const endRaw = parts.length === 2 ? nums[1] : nums[0];
	if (startRaw === undefined || endRaw === undefined) return null;
	let start = startRaw;
	let end = endRaw;
	if (end < start) {
		const t = start;
		start = end;
		end = t;
	}
	if (start > maxVerse || end > maxVerse) return null;
	return { start, end };
}

export function isPasukInHighlightRange(
	pasukIndex1Based: number,
	range: { start: number; end: number } | null | undefined,
): boolean {
	if (!range) return false;
	return pasukIndex1Based >= range.start && pasukIndex1Based <= range.end;
}
