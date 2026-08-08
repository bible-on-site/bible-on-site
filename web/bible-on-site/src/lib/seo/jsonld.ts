import type {
	BreadcrumbList,
	Graph,
	Organization,
	Thing,
	WebSite,
	WithContext,
} from "schema-dts";

/**
 * Canonical origin used for all absolute URLs and `@id` anchors in structured
 * data. Fixed (env-overridable) because statically-generated pages have no Host
 * header at build time.
 */
export const SITE_ORIGIN = (
	process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://xn--febl3a.co.il"
).replace(/\/+$/, "");

export const SITE_NAME = 'תנ"ך על הפרק';

/** Official, verified external presences for the Organization `sameAs`. */
const ORG_SAME_AS = [
	"https://t.me/BibleOnSite",
	"https://github.com/bible-on-site/bible-on-site",
];

/** Turn a site-relative path into an absolute canonical URL. */
export function absUrl(path: string): string {
	if (/^https?:\/\//.test(path)) {
		return path;
	}
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `${SITE_ORIGIN}${suffix}`;
}

/** Build a stable `@id` anchor for a node owned by a given page path. */
export function nodeId(path: string, fragment: string): string {
	return `${absUrl(path)}#${fragment}`;
}

export const ORG_ID = nodeId("/", "organization");
export const WEBSITE_ID = nodeId("/", "website");

export function organizationNode(): Organization {
	return {
		"@type": "Organization",
		"@id": ORG_ID,
		name: SITE_NAME,
		url: absUrl("/"),
		logo: absUrl("/images/logos/logo-white-letters-69.webp"),
		sameAs: ORG_SAME_AS,
	};
}

export function websiteNode(): WebSite {
	return {
		"@type": "WebSite",
		"@id": WEBSITE_ID,
		name: SITE_NAME,
		url: absUrl("/"),
		inLanguage: "he",
		publisher: { "@id": ORG_ID },
	};
}

export interface BreadcrumbItem {
	name: string;
	path: string;
}

/** A BreadcrumbList node owned by `ownerPath` (its `@id` anchor lives there). */
export function breadcrumbNode(
	items: BreadcrumbItem[],
	ownerPath: string,
): BreadcrumbList {
	return {
		"@type": "BreadcrumbList",
		"@id": nodeId(ownerPath, "breadcrumb"),
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: absUrl(item.path),
		})),
	};
}

/** Wrap nodes in a `@graph` with the schema.org context. */
export function buildGraph(nodes: Thing[]): Graph {
	return {
		"@context": "https://schema.org",
		"@graph": nodes,
	};
}

const JSONLD_ESCAPES: Record<string, string> = {
	"<": "\\u003c",
	">": "\\u003e",
	"&": "\\u0026",
	"'": "\\u0027",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

/**
 * Serialize a node to a string safe to embed inside a `<script>` element:
 * escapes characters that could terminate the element or break a JS string.
 */
export function renderJsonLd(node: Graph | WithContext<Thing>): string {
	return JSON.stringify(node).replace(
		/[<>&'\u2028\u2029]/g,
		(char) => JSONLD_ESCAPES[char],
	);
}

/**
 * True when HTML has visible text once tags, entities, and whitespace are
 * stripped. Used to gate content-derived fields so placeholder entries
 * (e.g. `<p></p>`) do not emit fabricated descriptions.
 */
export function hasContent(html: string | null | undefined): boolean {
	if (!html) {
		return false;
	}
	const text = html
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;|&#160;|&#xa0;|\u00a0/gi, "")
		.replace(/\s+/g, "");
	return text.length > 0;
}
