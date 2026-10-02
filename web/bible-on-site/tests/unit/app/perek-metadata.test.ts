/** @jest-environment node */
jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock("@/lib/seo/perek-images-data", () => ({
	getPerekImagesByChapter: jest.fn(),
}));

import { generateMetadata } from "@/app/929/[number]/page";
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
			url: "/929/1",
			images: [expect.objectContaining({ url: sampleImage.socialSrc })],
		}),
	);
});

test("chapter metadata uses its reading description without an illustration", async () => {
	jest.mocked(getPerekImagesByChapter).mockResolvedValue({});
	const metadata = await generateMetadata({
		params: Promise.resolve({ number: "1" }),
	});
	expect(metadata.description).toContain("עם פירושים ומאמרים על הפרק");
	expect(metadata.openGraph).toBeUndefined();
});
