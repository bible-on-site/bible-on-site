/**
 * Public-corpus path → Markdown target resolution (issue #3257).
 *
 * A single allowlist maps each canonical public learning route family
 * to its document kind. Anything outside the allowlist — management,
 * development, API internals, private data, arbitrary files — resolves
 * to `null`, so the Markdown surface can never be used to reach
 * off-corpus paths. Resolution is pure: it never touches the DB, never
 * fetches, and only inspects the pathname (already stripped of a
 * trailing `.md` by the caller).
 */
import { LAST_PEREK_ID } from "@/data/perek-dto";
import {
	parashaCanonicalPath,
	resolveParashaSegment,
} from "@/data/parasha/parasha-slugs";
import {
	getMasoraUnitCount,
} from "@/data/masora/masora-units";
import { MOADIM_ROOT } from "@/lib/moadim";
import { resolveCategoryRoute } from "@/lib/tanahpedia/category-slug";

/** Explicit-URL suffix: `/929/1.md` serves the same document as
 * `Accept: text/markdown` on `/929/1`. */
export const MARKDOWN_SUFFIX = ".md";

/** Internal route-handler root the proxy rewrites Markdown requests to. */
export const MARKDOWN_ROUTE_ROOT = "/md";

export type MarkdownTarget =
	| { kind: "home" }
	| { kind: "tanah-index" }
	| { kind: "perek"; perekId: number }
	| { kind: "article"; perekId: number; articleId: number }
	| { kind: "perush"; perekId: number; name: string }
	| { kind: "authors-index" }
	| { kind: "author"; slug: string }
	| { kind: "parasha-index" }
	| { kind: "parasha"; unitId: number }
	| { kind: "masora-index" }
	| { kind: "masora"; unitId: number }
	| { kind: "moadim-index" }
	| { kind: "moed"; slug: string }
	| { kind: "pedia-index" }
	| { kind: "pedia"; slug: string };

/** `{contentPath, isMarkdown}` for a request pathname. */
export function splitMarkdownSuffix(pathname: string): {
	contentPath: string;
	isMarkdown: boolean;
} {
	const isMarkdown = pathname.toLowerCase().endsWith(MARKDOWN_SUFFIX);
	return {
		contentPath: isMarkdown ? pathname.slice(0, -MARKDOWN_SUFFIX.length) : pathname,
		isMarkdown,
	};
}

const DECIMAL = /^\d+$/;

/**
 * Resolve a canonical public pathname (already `.md`-stripped, may be
 * percent-encoded or decoded) to a Markdown target. Returns `null` for
 * anything outside the corpus — including unresolvable parasha/pedia
 * segments, numeric perek ids outside 1–929, and masora unit ids
 * outside the division — so off-corpus requests are never rewritten.
 */
export function markdownTargetForPath(pathname: string): MarkdownTarget | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const segments = decoded.split("/").filter(Boolean);
	const [root, second, third] = segments;

	if (segments.length === 0) return { kind: "home" };

	if (root === "929") {
		if (segments.length === 1) return { kind: "tanah-index" };
		if (second === "authors") {
			if (segments.length === 2) return { kind: "authors-index" };
			if (segments.length === 3) return { kind: "author", slug: third };
			return null;
		}
		if (!DECIMAL.test(second)) return null;
		const perekId = Number.parseInt(second, 10);
		if (perekId < 1 || perekId > LAST_PEREK_ID) return null;
		if (segments.length === 2) return { kind: "perek", perekId };
		if (segments.length === 3) {
			if (DECIMAL.test(third)) {
				return {
					kind: "article",
					perekId,
					articleId: Number.parseInt(third, 10),
				};
			}
			return { kind: "perush", perekId, name: third };
		}
		return null;
	}

	if (root === "פרשה") {
		if (segments.length === 1) return { kind: "parasha-index" };
		if (segments.length === 2) {
			const resolved = resolveParashaSegment(second);
			return resolved ? { kind: "parasha", unitId: resolved.unitId } : null;
		}
		return null;
	}

	// The ASCII route dir serves the same units at /masora/* (the Hebrew
	// root rewrites into it) — .md parity for both spellings.
	if (root === "מסורה" || root === "masora") {
		if (segments.length === 1) return { kind: "masora-index" };
		if (segments.length === 2 && DECIMAL.test(second)) {
			const unitId = Number.parseInt(second, 10);
			return unitId >= 1 && unitId <= getMasoraUnitCount()
				? { kind: "masora", unitId }
				: null;
		}
		return null;
	}

	if (root === MOADIM_ROOT.slice(1)) {
		if (segments.length === 1) return { kind: "moadim-index" };
		if (segments.length === 2) return { kind: "moed", slug: second };
		return null;
	}

	if (root === "pedia") {
		if (segments.length === 1) return { kind: "pedia-index" };
		if (segments.length === 2) return { kind: "pedia", slug: second };
		return null;
	}

	return null;
}

/**
 * The canonical path for a target — what the Markdown document's
 * `rel="canonical"` (and the HTML page's own canonical) points at.
 * Only used where the target already resolved; kept separate so
 * renderers share the canonical spelling.
 */
export function canonicalPathForTarget(target: MarkdownTarget): string {
	switch (target.kind) {
		case "home":
			return "/";
		case "tanah-index":
			return "/929";
		case "perek":
			return `/929/${target.perekId}`;
		case "article":
			return `/929/${target.perekId}/${target.articleId}`;
		case "perush":
			return `/929/${target.perekId}/${encodeURIComponent(target.name)}`;
		case "authors-index":
			return "/929/authors";
		case "author":
			return `/929/authors/${encodeURIComponent(target.slug)}`;
		case "parasha-index":
			return "/פרשה";
		case "parasha":
			return parashaCanonicalPath(target.unitId);
		case "masora-index":
			return "/מסורה";
		case "masora":
			return `/מסורה/${target.unitId}`;
		case "moadim-index":
			return MOADIM_ROOT;
		case "moed":
			return `${MOADIM_ROOT}/${target.slug}`;
		case "pedia-index":
			return "/pedia";
		case "pedia": {
			const resolved = resolveCategoryRoute(target.slug);
			// Category canonicalPaths arrive decoded; the sitemap spells every
			// pedia URL percent-encoded, so the canonical Markdown form does too.
			return resolved
				? encodeURI(resolved.canonicalPath)
				: `/pedia/${encodeURIComponent(target.slug)}`;
		}
	}
}

/**
 * Every canonical route family that carries a Markdown representation —
 * the shape sitemap/discovery asserts against, so tests compare the
 * same list the proxy rewrites.
 */
export const MARKDOWN_ROUTE_FAMILIES = [
	"/",
	"/929",
	"/929/{perekId}",
	"/929/{perekId}/{articleId}",
	"/929/{perekId}/{perushName}",
	"/929/authors",
	"/929/authors/{slug}",
	"/פרשה",
	"/פרשה/{parasha}",
	"/מסורה",
	"/מסורה/{unitId}",
	"/מועדים",
	"/מועדים/{slug}",
	"/pedia",
	"/pedia/{slug}",
] as const;
