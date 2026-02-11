/**
 * Tests for [number]/[articleId]/page.tsx exported functions:
 * generateStaticParams, generateMetadata, ArticlePage.
 */

jest.mock("../../../src/lib/perushim", () => ({
	getPerushimByPerekId: jest.fn(),
	getPerushDetail: jest.fn(),
}));

jest.mock("../../../src/app/929/[number]/components/PerushimSection", () => ({
	PerushimSection: () => <div data-testid="perushim-section" />,
}));

jest.mock("next/cache", () => ({
	unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));

jest.mock("next/navigation", () => ({
	notFound: jest.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
}));

jest.mock("../../../src/lib/articles", () => ({
	getArticleById: jest.fn(),
	getArticlesByPerekId: jest.fn(),
}));

jest.mock("../../../src/lib/authors", () => ({
	authorNameToSlug: jest.fn((name: string) => encodeURIComponent(name)),
}));

jest.mock("../../../src/data/perek-dto", () => ({
	getPerekByPerekId: jest.fn(),
}));

jest.mock("../../../src/data/sefer-dto", () => ({
	getSeferByName: jest.fn(),
	getPerekIdsForSefer: jest.fn(),
}));

jest.mock("../../../src/data/db/tanah-view-types", () => ({
	isQriDifferentThanKtiv: jest.fn(
		(segment: { ktivOffset?: number }) => segment.ktivOffset !== undefined,
	),
}));

jest.mock("../../../src/app/929/[number]/components/ArticlesSection", () => ({
	ArticlesSection: () => <div data-testid="articles-section" />,
}));

jest.mock("../../../src/app/929/[number]/components/Breadcrumb", () => ({
	__esModule: true,
	default: () => <div data-testid="breadcrumb" />,
}));

jest.mock("../../../src/app/929/[number]/components/SeferComposite", () => ({
	__esModule: true,
	default: () => <div data-testid="sefer-composite" />,
}));

jest.mock("../../../src/app/929/[number]/[articleId]/ScrollToArticle", () => ({
	ScrollToArticle: () => null,
}));

jest.mock("../../../src/app/929/[number]/components/Ptuha", () => ({
	Ptuah: () => <span data-testid="ptuha" />,
}));

jest.mock("../../../src/app/929/[number]/components/Stuma", () => ({
	Stuma: () => <span data-testid="stuma" />,
}));

import { render, screen } from "@testing-library/react";
import ArticlePage, {
	generateMetadata,
	generateStaticParams,
} from "../../../src/app/929/[number]/[articleId]/page";
import { getPerekByPerekId } from "../../../src/data/perek-dto";
import {
	getPerekIdsForSefer,
	getSeferByName,
} from "../../../src/data/sefer-dto";
import {
	getArticleById,
	getArticlesByPerekId,
} from "../../../src/lib/articles";
import {
	getPerushDetail,
	getPerushimByPerekId,
} from "../../../src/lib/perushim";

const mockGetArticleById = getArticleById as jest.MockedFunction<
	typeof getArticleById
>;
const mockGetArticlesByPerekId = getArticlesByPerekId as jest.MockedFunction<
	typeof getArticlesByPerekId
>;
const mockGetPerekByPerekId = getPerekByPerekId as jest.MockedFunction<
	typeof getPerekByPerekId
>;
const mockGetSeferByName = getSeferByName as jest.MockedFunction<
	typeof getSeferByName
>;
const mockGetPerekIdsForSefer = getPerekIdsForSefer as jest.MockedFunction<
	typeof getPerekIdsForSefer
>;
const mockGetPerushimByPerekId = getPerushimByPerekId as jest.MockedFunction<
	typeof getPerushimByPerekId
>;
const mockGetPerushDetail = getPerushDetail as jest.MockedFunction<
	typeof getPerushDetail
>;

const sampleArticle = {
	id: 42,
	perekId: 5,
	authorId: 1,
	name: "מאמר לדוגמא",
	authorName: "הרב ישראל",
	authorImageUrl: "https://example.com/1.jpg",
	abstract: "תקציר המאמר",
	content: "<p>תוכן המאמר</p>",
	priority: 1,
};

describe("[articleId] page", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("generateStaticParams", () => {
		it("maps articles for a perek to static params", async () => {
			mockGetArticlesByPerekId.mockResolvedValue([
				{ ...sampleArticle, id: 10 },
				{ ...sampleArticle, id: 20 },
			]);
			mockGetPerushimByPerekId.mockResolvedValue([]);

			const result = await generateStaticParams({
				params: { number: "5" },
			});

			expect(result).toEqual([{ articleId: "10" }, { articleId: "20" }]);
			expect(mockGetArticlesByPerekId).toHaveBeenCalledWith(5);
		});

		it("includes perush names from perushim as static params", async () => {
			mockGetArticlesByPerekId.mockResolvedValue([]);
			mockGetPerushimByPerekId.mockResolvedValue([
				{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 10 },
			]);
			const result = await generateStaticParams({ params: { number: "5" } });
			expect(result).toEqual([{ articleId: "רש״י" }]);
		});
	});

	describe("generateMetadata", () => {
		it("returns article title and description when found", async () => {
			mockGetArticleById.mockResolvedValue(sampleArticle);

			const result = await generateMetadata({
				params: Promise.resolve({ number: "5", articleId: "42" }),
			});

			expect(result).toEqual({
				title: "מאמר לדוגמא | הרב ישראל | תנ״ך באתר",
				description: "תקציר המאמר",
			});
		});

		it("uses content stripped of HTML when abstract is empty", async () => {
			mockGetArticleById.mockResolvedValue({
				...sampleArticle,
				abstract: null,
			});

			const result = await generateMetadata({
				params: Promise.resolve({ number: "5", articleId: "42" }),
			});

			expect(result.description).toBe("תוכן המאמר");
		});

		it("falls back to author name when no abstract or content", async () => {
			mockGetArticleById.mockResolvedValue({
				...sampleArticle,
				abstract: null,
				content: null,
			});

			const result = await generateMetadata({
				params: Promise.resolve({ number: "5", articleId: "42" }),
			});

			expect(result.description).toBe("מאמר מאת הרב ישראל");
		});

		it("returns not-found metadata when article is missing", async () => {
			mockGetArticleById.mockResolvedValue(null);

			const result = await generateMetadata({
				params: Promise.resolve({ number: "5", articleId: "999" }),
			});

			expect(result).toEqual({
				title: "מאמר לא נמצא | תנ״ך באתר",
			});
		});

		it("returns perush metadata when articleId is non-numeric (perush name)", async () => {
			const perek = {
				perekId: 5,
				perekHeb: "ה",
				header: "בראשית ה",
				helek: "תורה",
				sefer: "בראשית",
				source: "mechon-mamre",
				pesukim: [
					{
						segments: [
							{ type: "qri" as const, value: "בראשית", ktivOffset: undefined },
						],
					},
				],
			};
			mockGetPerushimByPerekId.mockResolvedValue([
				{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 10 },
			]);
			mockGetPerekByPerekId.mockReturnValue(perek);
			mockGetSeferByName.mockReturnValue({
				name: "בראשית",
				additional: "",
				perakim: [perek],
			});

			const result = await generateMetadata({
				params: Promise.resolve({ number: "5", articleId: "רש״י" }),
			});

			expect(result.title).toContain("רש״י");
			expect(result.title).toContain("תנ״ך באתר");
		});

		it("returns not-found metadata when perush name not found", async () => {
			mockGetPerushimByPerekId.mockResolvedValue([]);

			const result = await generateMetadata({
				params: Promise.resolve({ number: "5", articleId: "unknown" }),
			});

			expect(result).toEqual({ title: "פירוש לא נמצא | תנ״ך באתר" });
		});
	});

	describe("ArticlePage", () => {
		/** A perek with all segment types for thorough branch coverage */
		const allSegmentTypesPerek = {
			perekId: 5,
			perekHeb: "ה",
			header: "בראשית ה",
			helek: "תורה",
			sefer: "בראשית",
			source: "mechon-mamre",
			pesukim: [
				{
					segments: [
						{ type: "ktiv" as const, value: "כתיב", qriOffset: 1 },
						{
							type: "qri" as const,
							value: "קרי",
							ktivOffset: -1,
						},
						{ type: "ptuha" as const },
						{ type: "stuma" as const },
						{
							type: "qri" as const,
							value: "רגיל",
							ktivOffset: undefined,
						},
						{
							type: "ktiv" as const,
							value: "מלה־",
							qriOffset: 1,
						},
					],
				},
			],
		};

		const minimalPerek = {
			perekId: 5,
			perekHeb: "ה",
			header: "בראשית ה",
			helek: "תורה",
			sefer: "בראשית",
			source: "mechon-mamre",
			pesukim: [
				{
					segments: [
						{ type: "qri" as const, value: "בראשית", ktivOffset: undefined },
					],
				},
			],
		};

		beforeEach(() => {
			mockGetArticleById.mockResolvedValue(sampleArticle);
			mockGetArticlesByPerekId.mockResolvedValue([sampleArticle]);
			mockGetPerekByPerekId.mockReturnValue(minimalPerek);
			mockGetSeferByName.mockReturnValue({
				name: "בראשית",
				additional: "",
				perakim: [minimalPerek],
			});
			mockGetPerekIdsForSefer.mockReturnValue([5]);
			mockGetPerushimByPerekId.mockResolvedValue([]);
		});

		it("renders article with author info and content", async () => {
			const jsx = await ArticlePage({
				params: Promise.resolve({ number: "5", articleId: "42" }),
			});
			render(jsx);

			expect(screen.getByText("מאמר לדוגמא")).toBeTruthy();
			expect(screen.getByText("הרב ישראל")).toBeTruthy();
			expect(screen.getByText("חזרה לפרק →")).toBeTruthy();
		});

		it("renders all segment types (ktiv, qri+different, ptuha, stuma, maqaf)", async () => {
			mockGetPerekByPerekId.mockReturnValue(allSegmentTypesPerek);

			const jsx = await ArticlePage({
				params: Promise.resolve({ number: "5", articleId: "42" }),
			});
			const { container } = render(jsx);
			const html = container.innerHTML;

			// ktiv text rendered directly
			expect(screen.getByText("כתיב")).toBeTruthy();
			// qri with different ktiv renders parenthesised with label
			expect(html).toContain("קרי");
			// regular qri (no ktivOffset) rendered as-is
			expect(screen.getByText("רגיל")).toBeTruthy();
			// ptuha and stuma mocks rendered
			expect(screen.getByTestId("ptuha")).toBeTruthy();
			expect(screen.getByTestId("stuma")).toBeTruthy();
			// maqaf trailing character: "מלה־" — should not add space after it
			expect(screen.getByText("מלה־")).toBeTruthy();
		});

		it("calls notFound when perekId is NaN", async () => {
			const { notFound } = jest.requireMock("next/navigation");

			await expect(
				ArticlePage({
					params: Promise.resolve({ number: "abc", articleId: "42" }),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");

			expect(notFound).toHaveBeenCalled();
		});

		it("calls notFound when article not found", async () => {
			const { notFound } = jest.requireMock("next/navigation");
			mockGetArticleById.mockResolvedValue(null);

			await expect(
				ArticlePage({
					params: Promise.resolve({ number: "5", articleId: "999" }),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");

			expect(notFound).toHaveBeenCalled();
		});

		it("calls notFound when article perekId mismatch", async () => {
			const { notFound } = jest.requireMock("next/navigation");
			mockGetArticleById.mockResolvedValue({
				...sampleArticle,
				perekId: 99,
			});

			await expect(
				ArticlePage({
					params: Promise.resolve({ number: "5", articleId: "42" }),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");

			expect(notFound).toHaveBeenCalled();
		});

		it("renders perush view when articleId is non-numeric", async () => {
			const perush = {
				id: 1,
				name: "רש״י",
				parshanName: "רש״י",
				noteCount: 10,
			};
			mockGetPerushimByPerekId.mockResolvedValue([perush]);
			mockGetPerushDetail.mockResolvedValue({
				id: 1,
				name: "רש״י",
				parshanName: "רש״י",
				notes: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>פירוש</p>" }],
			});

			const jsx = await ArticlePage({
				params: Promise.resolve({ number: "5", articleId: "רש״י" }),
			});
			render(jsx);

			expect(screen.getAllByText("רש״י").length).toBeGreaterThanOrEqual(1);
			expect(screen.getByText("חזרה לפרק →")).toBeTruthy();
		});

		it("calls notFound when perush name not in perushim list", async () => {
			const { notFound } = jest.requireMock("next/navigation");
			mockGetPerushimByPerekId.mockResolvedValue([]);

			await expect(
				ArticlePage({
					params: Promise.resolve({ number: "5", articleId: "nonexistent" }),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");

			expect(notFound).toHaveBeenCalled();
		});

		it("calls notFound when perushDetail is null", async () => {
			const { notFound } = jest.requireMock("next/navigation");
			mockGetPerushimByPerekId.mockResolvedValue([
				{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 10 },
			]);
			mockGetPerushDetail.mockResolvedValue(null);

			await expect(
				ArticlePage({
					params: Promise.resolve({ number: "5", articleId: "רש״י" }),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");

			expect(notFound).toHaveBeenCalled();
		});

		it("renders perush view with all segment types", async () => {
			mockGetPerekByPerekId.mockReturnValue(allSegmentTypesPerek);
			mockGetPerushimByPerekId.mockResolvedValue([
				{ id: 1, name: "רש״י", parshanName: "רש״י", noteCount: 5 },
			]);
			mockGetPerushDetail.mockResolvedValue({
				id: 1,
				name: "רש״י",
				parshanName: "רש״י",
				notes: [{ pasuk: 1, noteIdx: 0, noteContent: "note" }],
			});

			const jsx = await ArticlePage({
				params: Promise.resolve({ number: "5", articleId: "רש״י" }),
			});
			const { container } = render(jsx);

			expect(container.innerHTML).toContain("כתיב");
			expect(container.innerHTML).toContain("קרי");
		});
	});
});
