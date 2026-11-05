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

import {
	ArticleRelationshipsPanel,
	requireEntry,
} from "~/components/ArticleRelationshipsPanel";
import { supportedRelationships } from "~/lib/article-relationships";

function renderPanel(
	props: Partial<React.ComponentProps<typeof ArticleRelationshipsPanel>> = {},
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
	moadim: [{ id: 1, slug: "פסח", name: "פסח" }],
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
		expect(await screen.findByText("לעילוי נשמת אבי מורי")).toBeInTheDocument();
		expect(
			screen.getByText(/הקצאה עד 2030-01-02 03:04:05/),
		).toBeInTheDocument();
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
		// מועדים (#3101) graduated to a live managed section; only the
		// recurring Hebrew date (#3098) still waits on its schema.
		expect(
			await screen.findAllByText(/ממתין לסכמה — יוטמע דרך חוזה זה/),
		).toHaveLength(1);
		expect(screen.getByText(/3098/)).toBeInTheDocument();
	});

	it("lists the article's linked moadim inside the managed section", async () => {
		renderPanel();
		expect(await screen.findByText("פסח")).toBeInTheDocument();
		expect(screen.getByText("(פסח)")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "דף המועדים" })).toHaveAttribute(
			"href",
			"/moadim",
		);
	});

	it("shows the moed loading, missing-schema and empty states", async () => {
		// Loading — the query has not resolved yet (every managed section
		// shows the same spinner text, so at least one must render).
		mocks.getArticleRelationshipDetails.mockReturnValue(new Promise(() => {}));
		renderPanel();
		expect(screen.getAllByText("טוען…").length).toBeGreaterThan(0);
		document.body.replaceChildren();

		// Schema undeployed — undefined is not an empty link set.
		mocks.getArticleRelationshipDetails.mockResolvedValue({
			...details,
			moadim: undefined,
		});
		renderPanel();
		expect(
			await screen.findByText(/סכמת המועדים עוד לא נפרסה/),
		).toBeInTheDocument();
		document.body.replaceChildren();

		// Schema live, no links.
		mocks.getArticleRelationshipDetails.mockResolvedValue({
			...details,
			moadim: [],
		});
		renderPanel();
		expect(await screen.findByText("אין מועדים משויכים")).toBeInTheDocument();
	});

	it("falls back to the raw author id when no name is provided", () => {
		renderPanel({ authorName: undefined });
		expect(screen.getByText(/מזהה 2/)).toBeInTheDocument();
	});

	it("shows the covering-source schema as undeployed when the count is missing", () => {
		renderPanel({ coveringCount: undefined });
		expect(
			screen.getByText(/סכמת מקורות הכיסוי עוד לא נפרסה/),
		).toBeInTheDocument();
	});

	it("marks coverage as unknown when it is not verified", () => {
		renderPanel({ coverageVerified: false });
		expect(screen.getByText(/כיסוי לא ידוע/)).toBeInTheDocument();
	});

	it("shows the empty state and id fallbacks for dedications", async () => {
		mocks.getArticleRelationshipDetails.mockResolvedValue({
			...details,
			dedications: [
				{
					dedicationId: 9,
					subject: null,
					expiresAt: null,
					dedicationExpiresAt: "2020-05-06 07:08:09",
				},
			],
		});
		renderPanel();
		expect(await screen.findByText("הקדשה 9")).toBeInTheDocument();
		expect(
			screen.getByText(/ההקדשה פגה 2020-05-06 07:08:09/),
		).toBeInTheDocument();
	});

	it("shows an explicit empty state when no dedications are assigned", async () => {
		mocks.getArticleRelationshipDetails.mockResolvedValue({
			...details,
			dedications: [],
		});
		renderPanel();
		expect(await screen.findByText(/אין הקדשות משויכות/)).toBeInTheDocument();
	});

	it("shows an explicit empty state when no annotations are stored", async () => {
		mocks.getArticleRelationshipDetails.mockResolvedValue({
			...details,
			mentionAnnotations: [],
		});
		renderPanel();
		expect(
			await screen.findByText(/אין אנוטציות מאוחסנות/),
		).toBeInTheDocument();
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
		mocks.getArticleRelationshipDetails.mockRejectedValue(new Error("db down"));
		renderPanel();
		expect(
			await screen.findByText(/שגיאה בטעינה: db down/),
		).toBeInTheDocument();
	});
});

describe("requireEntry", () => {
	it("falls back to the registry when the supported list lacks the key", () => {
		const entry = requireEntry([], "primaryPerek");
		expect(entry.key).toBe("primaryPerek");
		expect(supportedRelationships()).toContainEqual(entry);
	});

	it("returns the supplied entry when present", () => {
		const [first] = supportedRelationships();
		expect(requireEntry([first], first.key)).toBe(first);
	});

	it("throws for a key that is not in the registry at all", () => {
		expect(() => requireEntry([], "no-such-relationship")).toThrow(
			"registry entry missing: no-such-relationship",
		);
	});
});
