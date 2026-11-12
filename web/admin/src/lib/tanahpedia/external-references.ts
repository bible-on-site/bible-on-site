/**
 * External-identifier domain model for Tanahpedia entities (#3330).
 *
 * Mirrors `data/mysql/external_reference_structure.sql`: one mapping per
 * (subject, source), stored as a canonical URL and emitted as JSON-LD
 * `sameAs` on the public entry pages. The values below are the only
 * subject_kind the admin edits (`TANAHPEDIA_ENTITY`) — PARSHAN rows are
 * seed-owned and TANAH_AUTHOR stays empty by the privacy rule.
 */

export const EXTERNAL_REFERENCE_SUBJECT_KIND = "TANAHPEDIA_ENTITY";

export const EXTERNAL_REFERENCE_SOURCES = [
	"WIKIDATA",
	"WIKIPEDIA_HE",
	"WIKIPEDIA_EN",
	"SEFARIA",
	"OFFICIAL",
] as const;

export type ExternalReferenceSource =
	(typeof EXTERNAL_REFERENCE_SOURCES)[number];

export interface EntityExternalReference {
	source: ExternalReferenceSource;
	url: string;
}

/** Editor-facing labels; Wikidata/Sefaria keep their Latin brand names. */
export const EXTERNAL_REFERENCE_SOURCE_LABELS: Record<
	ExternalReferenceSource,
	string
> = {
	WIKIDATA: "Wikidata",
	WIKIPEDIA_HE: "ויקיפדיה (עברית)",
	WIKIPEDIA_EN: "ויקיפדיה (אנגלית)",
	SEFARIA: "Sefaria",
	OFFICIAL: "אתר רשמי",
};

export function isExternalReferenceSource(
	value: unknown,
): value is ExternalReferenceSource {
	return (
		typeof value === "string" &&
		(EXTERNAL_REFERENCE_SOURCES as readonly string[]).includes(value)
	);
}

const MAX_URL_LENGTH = 1024;

const WIKIDATA_PATTERN =
	/^(?:https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/)?(Q[1-9]\d*)$/i;

const WIKIPEDIA_HOSTS: Partial<Record<ExternalReferenceSource, string>> = {
	WIKIPEDIA_HE: "he.wikipedia.org",
	WIKIPEDIA_EN: "en.wikipedia.org",
};

function checkedLength(url: string): string {
	if (url.length > MAX_URL_LENGTH) {
		throw new Error("הקישור ארוך מדי");
	}
	return url;
}

function parseProviderUrl(input: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch {
		throw new Error("קישור לא תקין - יש להזין כתובת מלאה");
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("קישור לא תקין - נתמך רק http/https");
	}
	return parsed;
}

/**
 * Normalizes an editor-typed identifier/URL to the canonical form stored in
 * `external_reference.url` — the same form the website emits as `sameAs`.
 * Throws an `Error` with a Hebrew message on any input that cannot name a
 * verified page for the given source.
 */
export function normalizeExternalReferenceUrl(
	source: ExternalReferenceSource,
	input: string,
): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("קישור ריק");
	}

	if (source === "WIKIDATA") {
		// A QID or any wikidata.org item URL canonicalizes to the /wiki/Qn URL.
		const match = WIKIDATA_PATTERN.exec(trimmed);
		if (!match) {
			throw new Error(
				"מזהה Wikidata לא תקין - יש להזין QID (למשל Q9181) או קישור לפריט",
			);
		}
		return `https://www.wikidata.org/wiki/${match[1].toUpperCase()}`;
	}

	const wikipediaHost = WIKIPEDIA_HOSTS[source];
	if (wikipediaHost) {
		const parsed = parseProviderUrl(trimmed);
		if (
			parsed.hostname !== wikipediaHost ||
			!parsed.pathname.startsWith("/wiki/") ||
			parsed.pathname.length <= "/wiki/".length
		) {
			throw new Error(
				`קישור ויקיפדיה לא תקין - צפוי קישור ${wikipediaHost}/wiki/<ערך>`,
			);
		}
		// Article paths are the canonical form; query/fragment never matter.
		return checkedLength(`https://${wikipediaHost}${parsed.pathname}`);
	}

	if (source === "SEFARIA") {
		const parsed = parseProviderUrl(trimmed);
		if (
			(parsed.hostname !== "www.sefaria.org" &&
				parsed.hostname !== "sefaria.org") ||
			parsed.pathname === "/"
		) {
			throw new Error("קישור Sefaria לא תקין - צפוי קישור www.sefaria.org");
		}
		return checkedLength(`https://www.sefaria.org${parsed.pathname}`);
	}

	// OFFICIAL: any http(s) page; `href` supplies the canonical spelling.
	return checkedLength(parseProviderUrl(trimmed).href);
}

/**
 * The human-readable identifier of a stored mapping, shown next to the
 * check-the-match link so an editor can eyeball it without opening the URL.
 */
export function externalReferenceDisplayId(
	source: ExternalReferenceSource,
	url: string,
): string {
	const lastSegment = url.split("/").filter(Boolean).pop() ?? url;
	if (source === "WIKIDATA") return lastSegment;
	if (source === "OFFICIAL") {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	}
	if (source.startsWith("WIKIPEDIA")) {
		try {
			return decodeURIComponent(lastSegment).replace(/_/g, " ");
		} catch {
			return lastSegment;
		}
	}
	// SEFARIA: the topic/page slug.
	return lastSegment;
}
