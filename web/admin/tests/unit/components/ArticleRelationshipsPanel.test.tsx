import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getArticleRelationshipDetails: vi.fn(),
}));

vi.mock("~/server/article-relationships", () => ({
	getArticleRelationshipDetails: mocks.getArticleRelationshipDetails,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		className,
	}: {
		to: string;
		children: React.ReactNode;
		className?: string;
	}) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));

import { ArticleRelationshipsPanel } from "~/components/ArticleRelationshipsPanel";

function renderPanel(
	props: Partial<
		React.ComponentProps<typeof ArticleRelationshipsPanel>
	> = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<ArticleRelationshipsPanel
				articleId={7}
				perekId={1}
				authorId={2}
				authorName='רש"י'
				coveringCount={3}
				coverageVerified={true}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

const details = {
	articleId: 7,
	contentHash: "abcdef0123",
	dedications: [
		{
			dedicationId: 5,
			subject: "לעילוי נשמת אבי מורי",
			expiresAt: "2030-01-02 03:04:05",
			dedicationExpiresAt: null,
		},
	],
	mentionAnnotations: [
		{
			id: "ann-1",
			intendedName: "אברהם",
			entityType: "PERSON",
			disambiguation: null,
			confidence: "0.92",
			acceptance: "manual",
			modelRevision: "rev-1",
			spanStart: 3,
			spanEnd: 9,
			surface: "אברהם אבינו",
			contentHash: "c".repeat(64),
			currentContent: true,
		},
		{
			id: "ann-2",
			intendedName: "משה",
			entityType: "PERSON",
			disambiguation: null,
			confidence: null,
			acceptance: "held",
			modelRevision: "rev-2",
			spanStart: null,
			spanEnd: null,
			surface: "משה רבנו",
			contentHash: "d".repeat(64),
			currentContent: false,
		},
	],
};

describe("ArticleRelationshipsPanel", () => {
	beforeEach(() => {
		mocks.getArticleRelationshipDetails.mockReset();
		mocks.getArticleRelationshipDetails.mockResolvedValue(details);
	});

	it("renders every registry section including pending ones", async () => {
		renderPanel();
		expect(screen.getByText("פרק ראשי")).toBeInTheDocument();
		expect(screen.getByText("מחבר")).toBeInTheDocument();
		expect(screen.getByText("כיסוי פסוקים מאומת")).toBeInTheDocument();
		expect(screen.getByText("הקדשות")).toBeInTheDocument();
		expect(screen.getByText("אנוטציות תנכפדיה")).toBeInTheDocument();
		expect(screen.getByText("תאריך עברי חוזר")).toBeInTheDocument();
		expect(screen.getByText("מועדים")).toBeInTheDocument();
		await waitFor(() =>
			expect(mocks.getArticleRelationshipDetails).toHaveBeenCalledWith({
				data: 7,
			}),
		);
	});

	it("shows the current single-valued values from the form", () => {
		renderPanel();
		expect(screen.getByText(/פרק 1/)).toBeInTheDocument();
		expect(screen.getByText(/רש"י/)).toBeInTheDocument();
		expect(screen.getByText(/כיסוי מאומת/)).toBeInTheDocument();
	});

	it("lists dedication assignments with a link to the workflow", async () => {
		renderPanel();
		expect(
			await screen.findByText("לעילוי נשמת אבי מורי"),
		).toBeInTheDocument();
		expect(screen.getByText(/הקצאה עד 2030-01-02 03:04:05/)).toBeInTheDocument();
		const link = screen.getByRole("link", { name: "דף ההקדשות" });
		expect(link).toHaveAttribute("href", "/dedications");
	});

	it("lists stored mention annotations and flags stale ones", async () => {
		renderPanel();
		expect(await screen.findByText("אברהם אבינו")).toBeInTheDocument();
		expect(screen.getByText("משה רבנו")).toBeInTheDocument();
		expect(screen.getByText(/לא עדכני — התוכן השתנה/)).toBeInTheDocument();
	});

	it("surfaces pending-schema relationships with their owning issue", async () => {
		renderPanel();
		expect(
			await screen.findAllByText(/ממתין לסכמה — יוטמע דרך חוזה זה/),
		).toHaveLength(2);
		expect(screen.getByText(/3098/)).toBeInTheDocument();
		expect(screen.getByText(/3101/)).toBeInTheDocument();
	});

	it("shows the annotation schema as undeployed, not empty", async () => {
		mocks.getArticleRelationshipDetails.mockResolvedValue({
			...details,
			mentionAnnotations: undefined,
		});
		renderPanel();
		expect(
			await screen.findByText(/סכמת אנוטציות התנכפדיה עוד לא נפרסה/),
		).toBeInTheDocument();
	});

	it("reports a load error on the managed sections", async () => {
		mocks.getArticleRelationshipDetails.mockRejectedValue(
			new Error("db down"),
		);
		renderPanel();
		expect(
			await screen.findByText(/שגיאה בטעינה: db down/),
		).toBeInTheDocument();
	});
});
