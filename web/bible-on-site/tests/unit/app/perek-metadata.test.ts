/** @jest-environment node */
jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock("@/lib/seo/perek-images-data", () => ({
	getPerekImagesByChapter: jest.fn(),
}));

import { generateMetadata } from "@/app/929/[number]/page";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";
import { OG_FALLBACK_IMAGE_PATH, ogImageMimeType } from "@/lib/seo/opengraph";
import { getPerekImagesByChapter } from "@/lib/seo/perek-images-data";
import { sampleImage } from "../components/perek-image-fixture";

test("chapter metadata describes and shares the selected illustration", async () => {
	jest.mocked(getPerekImagesByChapter).mockResolvedValue({ 1: [sampleImage] });
	const metadata = await generateMetadata({
		params: Promise.resolve({ number: "1" }),
	});
	expect(metadata.description).toBe(sampleImage.description);
	expect(metadata.alternates?.canonical).toBe("/929/1");
	expect(metadata.openGraph).toEqual(
		expect.objectContaining({
			url: `${SITE_ORIGIN}/929/1`,
			type: "website",
			locale: "he_IL",
			images: [
				expect.objectContaining({
					url: sampleImage.socialSrc,
					width: sampleImage.socialWidth,
					height: sampleImage.socialHeight,
					alt: sampleImage.alt,
					type: ogImageMimeType(sampleImage.socialSrc),
				}),
			],
		}),
	);
	expect(metadata.robots).toEqual(
		expect.objectContaining({
			googleBot: expect.objectContaining({ "max-image-preview": "large" }),
		}),
	);
});

test("chapter metadata falls back to the branded image without an illustration", async () => {
	jest.mocked(getPerekImagesByChapter).mockResolvedValue({});
	const metadata = await generateMetadata({
		params: Promise.resolve({ number: "1" }),
	});
	expect(metadata.description).toContain("עם פירושים ומאמרים על הפרק");
	expect(metadata.openGraph).toEqual(
		expect.objectContaining({
			url: `${SITE_ORIGIN}/929/1`,
			type: "website",
			images: [
				expect.objectContaining({
					url: `${SITE_ORIGIN}${OG_FALLBACK_IMAGE_PATH}`,
					width: 1200,
					height: 630,
					type: "image/jpeg",
				}),
			],
		}),
	);
});
