/** @jest-environment node */
/**
 * Regression tests for #2512: the dedicated commentary page's document title
 * must use the canonical source string (parent book + additional + chapter),
 * matching the visible heading — never the parent name alone.
 *
 * Source resolution uses the REAL canonical sefarim data (perek-dto is not
 * mocked); only the perush content lookups are stubbed.
 */
jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));

jest.mock("../../../src/lib/perushim", () => ({
	getPerushimByPerekId: jest.fn(),
	getPerushDetail: jest.fn(),
	getAllPerushPerekNamePairs: jest.fn(),
}));

jest.mock("../../../src/lib/articles", () => ({
	getArticleById: jest.fn(),
	getArticleSummariesByPerekId: jest.fn(),
	getAllArticlePerekIdPairs: jest.fn(),
}));

jest.mock("../../../src/lib/seo/perek-images-data", () => ({
	getPerekImagesByChapter: jest.fn(async () => ({})),
}));

jest.mock("../../../src/lib/tanahpedia/perek-entity-refs", () => ({
	fetchAllEntityRefs: jest.fn(async () => ({})),
}));

import { generateMetadata } from "@/app/929/[number]/[slug]/page";
import { getPerushDetail, getPerushimByPerekId } from "../../../src/lib/perushim";

const mockGetPerushimByPerekId = getPerushimByPerekId as jest.MockedFunction<
	typeof getPerushimByPerekId
>;
const mockGetPerushDetail = getPerushDetail as jest.MockedFunction<
	typeof getPerushDetail
>;

const RASHI_SLUG = encodeURIComponent('רש"י');

const rashiPerush = {
	id: 1,
	perekId: 0,
	name: 'רש"י',
	parshanName: "רש\"י",
	authorName: "רש\"י",
};

beforeEach(() => {
	jest.clearAllMocks();
	// Every perek "has" רש"י for metadata purposes; notes are empty so the
	// fallback description (the other string carrying the source) is exercised.
	mockGetPerushimByPerekId.mockImplementation(async (perekId: number) => [
		{ ...rashiPerush, perekId },
	]);
	mockGetPerushDetail.mockResolvedValue({ notes: [] } as never);
});

const metadataFor = (perekId: number) =>
	generateMetadata({
		params: Promise.resolve({ number: String(perekId), slug: RASHI_SLUG }),
	});

const expectedTitle = (source: string) =>
	`רש"י על ${source} | תנ"ך על הפרק`;

describe("commentary metadata source (#2512)", () => {
	it.each([
		[315, "מלכים ב ו"], // reported case
		[288, "מלכים א א"],
		[334, "מלכים ב כה"],
		[233, "שמואל א א"],
		[264, "שמואל ב א"],
		[865, "דברי הימים א א"],
		[894, "דברי הימים ב א"],
		[842, "עזרא ע א"],
		[851, "עזרא ע י"],
		[852, "עזרא נ א"],
		[864, "עזרא נ יג"],
		[1, "בראשית א"], // ordinary book, no additional marker
	])(
		"perek %i titles the commentary %s in title, openGraph and fallback description",
		async (perekId, source) => {
			const metadata = await metadataFor(perekId);

			expect(metadata.title).toBe(expectedTitle(source));
			expect(metadata.openGraph).toEqual(
				expect.objectContaining({ title: expectedTitle(source) }),
			);
			expect(metadata.description).toBe(
				`פירוש רש"י מאת רש"י על ${source}`,
			);
		},
	);

	it("keeps the canonical URL and site suffix unchanged", async () => {
		const metadata = await metadataFor(315);

		expect(metadata.alternates?.canonical).toBe(
			`/929/315/${encodeURIComponent('רש"י')}`,
		);
		expect(metadata.openGraph?.url).toBe(metadata.alternates?.canonical);
		expect(metadata.openGraph?.siteName).toBe('תנ"ך על הפרק');
	});
});
