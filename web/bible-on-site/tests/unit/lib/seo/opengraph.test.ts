/** @jest-environment node */

import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo/jsonld";
import {
	OG_FALLBACK_IMAGE_ALT,
	OG_FALLBACK_IMAGE_HEIGHT,
	OG_FALLBACK_IMAGE_PATH,
	OG_FALLBACK_IMAGE_WIDTH,
	ogImageMimeType,
	pageMetadata,
	siteOpenGraph,
} from "@/lib/seo/opengraph";

type OgBlock = NonNullable<ReturnType<typeof siteOpenGraph>>;

const baseOptions = {
	title: "כותרת לדוגמה",
	description: "תיאור לדוגמה",
	canonical: "/929/1",
};

describe("siteOpenGraph", () => {
	it("emits all four required OGP properties plus site identity", () => {
		const og = siteOpenGraph(baseOptions);
		expect(og.title).toBe(baseOptions.title);
		expect((og as { type?: string }).type).toBe("website");
		expect(og.url).toBe(`${SITE_ORIGIN}/929/1`);
		expect(og.siteName).toBe(SITE_NAME);
		expect(og.locale).toBe("he_IL");
	});

	it("resolves relative canonical paths to absolute https og:url", () => {
		expect(siteOpenGraph({ ...baseOptions, canonical: "929/7" }).url).toBe(
			`${SITE_ORIGIN}/929/7`,
		);
	});

	it("keeps already-absolute canonical URLs untouched", () => {
		const absolute = `${SITE_ORIGIN}/pedia/אישים`;
		expect(siteOpenGraph({ ...baseOptions, canonical: absolute }).url).toBe(
			absolute,
		);
	});

	it("uses the branded fallback image with full structured fields", () => {
		const og = siteOpenGraph(baseOptions);
		const images = og.images as OgBlock["images"] & object[];
		expect(images).toHaveLength(1);
		expect(images[0]).toEqual({
			url: `${SITE_ORIGIN}${OG_FALLBACK_IMAGE_PATH}`,
			alt: OG_FALLBACK_IMAGE_ALT,
			type: "image/jpeg",
			width: OG_FALLBACK_IMAGE_WIDTH,
			height: OG_FALLBACK_IMAGE_HEIGHT,
		});
		// Honest branding: the generic alt must not describe a biblical scene.
		expect(OG_FALLBACK_IMAGE_ALT).not.toContain("איור");
	});

	it("prefers a content image with absolute URL, mime type and alt", () => {
		const og = siteOpenGraph({
			...baseOptions,
			image: {
				url: "https://cdn.example.com/illustrations/perek-1-social.jpg",
				width: 1600,
				height: 900,
				alt: "איור הבריאה",
			},
		});
		expect(og.images).toEqual([
			{
				url: "https://cdn.example.com/illustrations/perek-1-social.jpg",
				width: 1600,
				height: 900,
				alt: "איור הבריאה",
				type: "image/jpeg",
			},
		]);
	});

	it("resolves site-relative image paths to absolute URLs", () => {
		const og = siteOpenGraph({
			...baseOptions,
			image: { url: "/images/x.png", alt: "x" },
		});
		expect((og.images as { url: string }[])[0].url).toBe(
			`${SITE_ORIGIN}/images/x.png`,
		);
	});

	it("omits unknown image dimensions instead of guessing", () => {
		const og = siteOpenGraph({
			...baseOptions,
			image: { url: "https://cdn.example.com/portrait.jpg", alt: "דיוקן" },
		});
		const image = (og.images as Record<string, unknown>[])[0];
		expect(image.width).toBeUndefined();
		expect(image.height).toBeUndefined();
		expect(image.type).toBe("image/jpeg");
	});

	it("strips markup and collapses whitespace in descriptions", () => {
		const og = siteOpenGraph({
			...baseOptions,
			description: "  <p>תיאור&nbsp;<b>עשיר</b></p>\n שורה שנייה  ",
		});
		expect(og.description).toBe("תיאור עשיר שורה שנייה");
	});

	it("falls back to the title when the description cleans to empty", () => {
		const og = siteOpenGraph({ ...baseOptions, description: "<p></p>" });
		expect(og.description).toBe(og.title);
	});

	it("emits article author profile URLs and section for article type", () => {
		const og = siteOpenGraph({
			...baseOptions,
			type: "article",
			authors: [`${SITE_ORIGIN}/929/authors/x`],
			section: "בראשית",
		});
		expect((og as { type?: string }).type).toBe("article");
		expect((og as { authors?: string[] }).authors).toEqual([
			`${SITE_ORIGIN}/929/authors/x`,
		]);
		expect((og as { section?: string }).section).toBe("בראשית");
	});

	it("omits authors/section on non-article types", () => {
		const og = siteOpenGraph({
			...baseOptions,
			authors: [`${SITE_ORIGIN}/929/authors/x`],
			section: "בראשית",
		});
		expect((og as { authors?: string[] }).authors).toBeUndefined();
		expect((og as { section?: string }).section).toBeUndefined();
	});

	it("emits the profile type for author pages", () => {
		const og = siteOpenGraph({ ...baseOptions, type: "profile" });
		expect((og as { type?: string }).type).toBe("profile");
	});

	it("omits an empty authors array", () => {
		const og = siteOpenGraph({
			...baseOptions,
			type: "article",
			authors: [],
		});
		expect((og as { authors?: string[] }).authors).toBeUndefined();
	});
});

describe("pageMetadata", () => {
	it("aligns canonical link, og:url and twitter card with the same identity", () => {
		const metadata = pageMetadata(baseOptions);
		expect(metadata.alternates?.canonical).toBe("/929/1");
		expect(metadata.openGraph?.url).toBe(`${SITE_ORIGIN}/929/1`);
		expect(metadata.twitter).toEqual(
			expect.objectContaining({
				card: "summary_large_image",
				title: baseOptions.title,
				images: [`${SITE_ORIGIN}${OG_FALLBACK_IMAGE_PATH}`],
			}),
		);
	});

	it("keeps title and cleaned description on the top level too", () => {
		const metadata = pageMetadata({
			...baseOptions,
			description: "<b>תיאור</b>",
		});
		expect(metadata.title).toBe(baseOptions.title);
		expect(metadata.description).toBe("תיאור");
	});

	it("uses the content image for the twitter card when provided", () => {
		const metadata = pageMetadata({
			...baseOptions,
			image: { url: "/img/social.webp", alt: "x", width: 10, height: 10 },
		});
		expect(metadata.twitter?.images).toEqual([
			`${SITE_ORIGIN}/img/social.webp`,
		]);
	});
});

describe("ogImageMimeType", () => {
	it.each([
		["a.jpg", "image/jpeg"],
		["a.jpeg", "image/jpeg"],
		["a.png", "image/png"],
		["a.webp", "image/webp"],
		["a.avif", "image/avif"],
		["a.gif", "image/gif"],
		["https://x.co.il/a.JPG?v=2", "image/jpeg"],
	])("maps %s to %s", (url, mime) => {
		expect(ogImageMimeType(url)).toBe(mime);
	});

	it("returns undefined for extensionless or unknown extensions", () => {
		expect(ogImageMimeType("https://x.co.il/image")).toBeUndefined();
		expect(ogImageMimeType("https://x.co.il/a.bmp")).toBeUndefined();
	});
});
