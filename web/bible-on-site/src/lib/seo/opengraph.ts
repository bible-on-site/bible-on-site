import type { Metadata } from "next";
import { absUrl, plainText, SITE_NAME } from "./jsonld";

/**
 * Shared Open Graph + Twitter card builder, parallel to the JSON-LD helpers
 * in this directory. Next.js merges `openGraph` shallowly between segments —
 * a page that sets it replaces the layout's whole block — so every call site
 * must emit a COMPLETE object. These helpers guarantee the required OGP
 * properties (`og:title`, `og:type`, `og:image`, `og:url`) plus site name,
 * locale, and a branded fallback image are always present.
 */

export const OG_LOCALE = "he_IL";

/**
 * Branded landscape raster used whenever a page has no content-specific
 * social image. Static asset — crawlable without auth, committed under
 * `public/`; 1200x630 is a practical preview size, not an OGP requirement.
 */
export const OG_FALLBACK_IMAGE_PATH = "/images/og/default.jpg";
export const OG_FALLBACK_IMAGE_WIDTH = 1200;
export const OG_FALLBACK_IMAGE_HEIGHT = 630;
export const OG_FALLBACK_IMAGE_ALT = 'לוגו תנ"ך על הפרק - לימוד תנ"ך יומי';

const OG_IMAGE_MIME_BY_EXT: Record<string, string> = {
	avif: "image/avif",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

/** Infer `og:image:type` from the file extension, when one is present. */
export function ogImageMimeType(url: string): string | undefined {
	const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
	return ext ? OG_IMAGE_MIME_BY_EXT[ext] : undefined;
}

export interface OgImageSpec {
	/** Site-relative path or absolute URL — resolved to absolute HTTPS. */
	url: string;
	alt: string;
	/** Accurate intrinsic dimensions; omit rather than guess. */
	width?: number;
	height?: number;
	/** MIME type; inferred from the extension when omitted. */
	type?: string;
}

export interface PageOgOptions {
	title: string;
	/** Plain-text (or HTML) summary — cleaned and collapsed before emission. */
	description: string;
	/**
	 * Canonical path or absolute URL. Feeds `alternates.canonical`, `og:url`
	 * and the Twitter card so the three identities can never diverge.
	 */
	canonical: string;
	/**
	 * OGP object type; `website` is the honest default for navigation/content
	 * pages. `article` adds `article:author`/`article:section`; `profile` marks
	 * author pages (optional `profile:*` fields are omitted — a Hebrew
	 * honorific name does not split reliably into first/last).
	 */
	type?: "website" | "article" | "profile";
	/** Content-specific social image; the branded fallback is used when absent. */
	image?: OgImageSpec | null;
	/**
	 * `article:author` — OGP requires profile URLs, not display names. Pass
	 * absolute public profile URLs only; omit when no profile page exists
	 * (e.g. classical commentators have no author page).
	 */
	authors?: string[];
	/** `article:section` — reliable high-level grouping (e.g. the sefer name). */
	section?: string;
}

type ResolvedOgImage = {
	url: string;
	alt: string;
	type?: string;
	width?: number;
	height?: number;
};

function resolveImage(image?: OgImageSpec | null): ResolvedOgImage {
	if (!image) {
		return {
			url: absUrl(OG_FALLBACK_IMAGE_PATH),
			alt: OG_FALLBACK_IMAGE_ALT,
			type: ogImageMimeType(OG_FALLBACK_IMAGE_PATH),
			width: OG_FALLBACK_IMAGE_WIDTH,
			height: OG_FALLBACK_IMAGE_HEIGHT,
		};
	}
	return {
		url: absUrl(image.url),
		alt: image.alt,
		type: image.type ?? ogImageMimeType(image.url),
		...(image.width ? { width: image.width } : {}),
		...(image.height ? { height: image.height } : {}),
	};
}

/** Collapse markup/entities/whitespace; an empty result falls back to title. */
function cleanDescription(description: string, title: string): string {
	return plainText(description, 300) || title;
}

/**
 * Complete `openGraph` object with every required property — safe to assign
 * verbatim since Next.js replaces (not merges) the whole key.
 */
export function siteOpenGraph({
	title,
	description,
	canonical,
	type = "website",
	image,
	authors,
	section,
}: PageOgOptions): NonNullable<Metadata["openGraph"]> {
	const resolved = resolveImage(image);
	const cleanedDescription = cleanDescription(description, title);
	const base = {
		title,
		description: cleanedDescription,
		url: absUrl(canonical),
		siteName: SITE_NAME,
		locale: OG_LOCALE,
		images: [resolved],
	};
	if (type === "article") {
		return {
			...base,
			type,
			// OGP requires article:author values to be profile URLs.
			...(authors?.length ? { authors } : {}),
			...(section ? { section } : {}),
		};
	}
	return { ...base, type };
}

/**
 * Full `Metadata` fragment for a public page: canonical link, complete Open
 * Graph block, and a matching `summary_large_image` Twitter card.
 */
export function pageMetadata(options: PageOgOptions): Metadata {
	const description = cleanDescription(options.description, options.title);
	const image = resolveImage(options.image);
	return {
		title: options.title,
		description,
		alternates: { canonical: options.canonical },
		openGraph: siteOpenGraph(options),
		twitter: {
			card: "summary_large_image",
			title: options.title,
			description,
			images: [image.url],
		},
	};
}
