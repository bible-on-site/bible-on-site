/**
 * Tests for the [authorParam] page's exported functions:
 * generateStaticParams, generateMetadata, and resolveAuthor (via getCachedAuthor).
 */

// Bypass unstable_cache — just run the wrapped function directly
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
	default: () => null,
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../src/lib/authors", () => ({
	getAllAuthorSlugs: jest.fn(),
	getArticlesByAuthorId: jest.fn(),
	getAuthorById: jest.fn(),
	getAuthorByName: jest.fn(),
}));

import { render, screen } from "@testing-library/react";
import {
	getAllAuthorSlugs,
	getArticlesByAuthorId,
	getAuthorById,
	getAuthorByName,
} from "../../../src/lib/authors";
import AuthorPage, {
	generateMetadata,
	generateStaticParams,
} from "../../../src/app/929/authors/[authorParam]/page";

const mockGetAllAuthorSlugs = getAllAuthorSlugs as jest.MockedFunction<
	typeof getAllAuthorSlugs
>;
const mockGetAuthorById = getAuthorById as jest.MockedFunction<
	typeof getAuthorById
>;
const mockGetAuthorByName = getAuthorByName as jest.MockedFunction<
	typeof getAuthorByName
>;
const mockGetArticlesByAuthorId =
	getArticlesByAuthorId as jest.MockedFunction<typeof getArticlesByAuthorId>;

describe("[authorParam] page", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("generateStaticParams", () => {
		it("maps author slugs to params", async () => {
			mockGetAllAuthorSlugs.mockResolvedValue([
				"הרב לדוגמא שליטא",
				"הרב אחר זל",
			]);

			const result = await generateStaticParams();

			expect(result).toEqual([
				{ authorParam: "הרב לדוגמא שליטא" },
				{ authorParam: "הרב אחר זל" },
			]);
		});

		it("returns empty array when no slugs", async () => {
			mockGetAllAuthorSlugs.mockResolvedValue([]);

			const result = await generateStaticParams();

			expect(result).toEqual([]);
		});
	});

	describe("generateMetadata", () => {
		it("returns author name in title when found by numeric ID", async () => {
			mockGetAuthorById.mockResolvedValue({
				id: 1,
				name: "הרב לדוגמא",
				details: "תיאור ארוך מאוד",
				imageUrl: "https://example.com/1.jpg",
			});

			const result = await generateMetadata({
				params: Promise.resolve({ authorParam: "1" }),
			});

			expect(result).toEqual({
				title: "הרב לדוגמא | תנ״ך באתר",
				description: "תיאור ארוך מאוד",
			});
			expect(mockGetAuthorById).toHaveBeenCalledWith(1);
		});

		it("returns author name in title when found by name slug", async () => {
			mockGetAuthorByName.mockResolvedValue({
				id: 1,
				name: "הרב לדוגמא",
				details: "",
				imageUrl: "https://example.com/1.jpg",
			});

			const result = await generateMetadata({
				params: Promise.resolve({
					authorParam: encodeURIComponent("הרב לדוגמא"),
				}),
			});

			expect(result).toEqual({
				title: "הרב לדוגמא | תנ״ך באתר",
				description: "מאמרים מאת הרב לדוגמא",
			});
			expect(mockGetAuthorByName).toHaveBeenCalledWith("הרב לדוגמא");
		});

		it("returns not-found metadata when author is missing", async () => {
			mockGetAuthorByName.mockResolvedValue(null);

			const result = await generateMetadata({
				params: Promise.resolve({ authorParam: "nonexistent" }),
			});

			expect(result).toEqual({
				title: "הרב לא נמצא | תנ״ך באתר",
			});
		});

		it("truncates long details to 160 chars for description", async () => {
			const longDetails = "א".repeat(200);
			mockGetAuthorById.mockResolvedValue({
				id: 1,
				name: "הרב לדוגמא",
				details: longDetails,
				imageUrl: "https://example.com/1.jpg",
			});

			const result = await generateMetadata({
				params: Promise.resolve({ authorParam: "1" }),
			});

			expect(result.description).toHaveLength(160);
		});
	});

	describe("AuthorPage (default export)", () => {
		it("renders author with image, details, and articles", async () => {
			mockGetAuthorById.mockResolvedValue({
				id: 1,
				name: "הרב לדוגמא",
				details: "תיאור הרב",
				imageUrl: "https://example.com/1.jpg",
			});
			mockGetArticlesByAuthorId.mockResolvedValue([
				{
					id: 10,
					name: "מאמר ראשון",
					perekId: 5,
					abstract: "תקציר",
				},
			]);

			const jsx = await AuthorPage({
				params: Promise.resolve({ authorParam: "1" }),
			});
			render(jsx);

			expect(screen.getByText("הרב לדוגמא")).toBeTruthy();
			expect(screen.getByText("תיאור הרב")).toBeTruthy();
			expect(screen.getByText("מאמר ראשון")).toBeTruthy();
			expect(screen.getByText("מאמרים (1)")).toBeTruthy();
		});

		it("renders placeholder when author has no image", async () => {
			mockGetAuthorByName.mockResolvedValue({
				id: 2,
				name: "הרב ללא תמונה",
				details: "",
				imageUrl: "",
			});
			mockGetArticlesByAuthorId.mockResolvedValue([]);

			const jsx = await AuthorPage({
				params: Promise.resolve({
					authorParam: encodeURIComponent("הרב ללא תמונה"),
				}),
			});
			render(jsx);

			expect(screen.getByText("הרב ללא תמונה")).toBeTruthy();
			expect(screen.getByText("👤")).toBeTruthy();
			expect(screen.getByText("אין מאמרים עדיין")).toBeTruthy();
		});

		it("calls notFound when author is missing", async () => {
			const { notFound } = jest.requireMock("next/navigation");
			mockGetAuthorByName.mockResolvedValue(null);

			await expect(
				AuthorPage({
					params: Promise.resolve({ authorParam: "nonexistent" }),
				}),
			).rejects.toThrow("NEXT_NOT_FOUND");

			expect(notFound).toHaveBeenCalled();
		});
	});
});
