/**
 * Tests for [number]/[articleId]/page.tsx exported functions:
 * generateStaticParams, generateMetadata, ArticlePage.
 */

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
	}: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
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
	isQriDifferentThanKtiv: jest.fn(() => false),
}));

jest.mock(
	"../../../src/app/929/[number]/components/ArticlesSection",
	() => ({
		ArticlesSection: () => <div data-testid="articles-section" />,
	}),
);

jest.mock("../../../src/app/929/[number]/components/Breadcrumb", () => ({
	__esModule: true,
	default: () => <div data-testid="breadcrumb" />,
}));

jest.mock(
	"../../../src/app/929/[number]/components/SeferComposite",
	() => ({
		__esModule: true,
		default: () => <div data-testid="sefer-composite" />,
	}),
);

jest.mock(
	"../../../src/app/929/[number]/[articleId]/ScrollToArticle",
	() => ({
		ScrollToArticle: () => null,
	}),
);

import { render, screen } from "@testing-library/react";
import {
	getArticleById,
	getArticlesByPerekId,
} from "../../../src/lib/articles";
import { getPerekByPerekId } from "../../../src/data/perek-dto";
import {
	getSeferByName,
	getPerekIdsForSefer,
} from "../../../src/data/sefer-dto";
import ArticlePage, {
	generateMetadata,
	generateStaticParams,
} from "../../../src/app/929/[number]/[articleId]/page";

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

			const result = await generateStaticParams({
				params: { number: "5" },
			});

			expect(result).toEqual([
				{ articleId: "10" },
				{ articleId: "20" },
			]);
			expect(mockGetArticlesByPerekId).toHaveBeenCalledWith(5);
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
	});

	describe("ArticlePage", () => {
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
	});
});
