import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	routeParams: { id: "7" },
	search: {} as Record<string, unknown>,
	navigate: vi.fn(),
	getArticle: vi.fn(),
	getAuthors: vi.fn(),
	getPerakim: vi.fn(),
	createArticle: vi.fn(),
	updateArticle: vi.fn(),
	deleteArticle: vi.fn(),
	hebrewDatesEditor: vi.fn((_props: { dates: unknown; onChange: unknown }) => (
		<div data-testid="hebrew-dates-editor" />
	)),
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => ({
		options,
		useParams: () => mocks.routeParams,
	}),
	useSearch: () => mocks.search,
	useNavigate: () => mocks.navigate,
	Link: ({
		children,
		to,
		params,
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
	}) => (
		<a
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to,
			)}
		>
			{children}
		</a>
	),
}));
vi.mock("~/server/articles", () => ({
	getArticle: mocks.getArticle,
	createArticle: mocks.createArticle,
	updateArticle: mocks.updateArticle,
	deleteArticle: mocks.deleteArticle,
}));
vi.mock("~/server/authors", () => ({ getAuthors: mocks.getAuthors }));
vi.mock("~/server/perakim", () => ({ getPerakim: mocks.getPerakim }));
vi.mock("~/components/HebrewDatesEditor", () => ({
	HebrewDatesEditor: (props: { dates: unknown; onChange: unknown }) =>
		mocks.hebrewDatesEditor(props),
}));
vi.mock("~/components/CoveringSourcesEditor", () => ({
	CoveringSourcesEditor: () => <div data-testid="covering-sources-editor" />,
}));
vi.mock("~/components/WysiwygEditor", () => ({
	WysiwygEditor: () => <div data-testid="wysiwyg" />,
}));
vi.mock("~/components/AutoSaveIndicator", () => ({
	AutoSaveIndicator: () => null,
}));
vi.mock("~/components/editor/entryLinkSearch", () => ({
	searchEntriesForLink: vi.fn(),
}));

import { Route } from "~/routes/articles.$id";

const article = {
	id: 7,
	perek_id: 3,
	author_id: 2,
	abstract: "",
	name: "מאמר",
	priority: 1,
	distributable: true,
	content: "<p>תוכן</p>",
	coverage_verified: false,
	coveringSources: undefined,
	hebrewDates: [{ hebrew_month: 11, hebrew_day: 9 }],
};

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const Component = Route.options.component;
	if (!Component) throw new Error("Article edit route component is missing");
	return render(
		<QueryClientProvider client={client}>
			<Component />
		</QueryClientProvider>,
	);
}

describe("Article edit Hebrew dates (#3098)", () => {
	beforeEach(() => {
		for (const mock of [
			mocks.navigate,
			mocks.getArticle,
			mocks.getAuthors,
			mocks.getPerakim,
			mocks.createArticle,
			mocks.updateArticle,
			mocks.deleteArticle,
			mocks.hebrewDatesEditor,
		])
			mock.mockReset();
		mocks.hebrewDatesEditor.mockImplementation(() => (
			<div data-testid="hebrew-dates-editor" />
		));
		mocks.getArticle.mockResolvedValue(article);
		mocks.getAuthors.mockResolvedValue([]);
		mocks.getPerakim.mockResolvedValue([]);
	});

	it("shows the assignment editor for a persisted article with dates", async () => {
		mocks.routeParams = { id: "7" };
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("hebrew-dates-editor")).toBeTruthy(),
		);
		expect(mocks.hebrewDatesEditor).toHaveBeenCalledWith(
			expect.objectContaining({
				dates: [{ hebrew_month: 11, hebrew_day: 9 }],
			}),
		);
	});

	it("hides the assignment editor when the schema is not deployed", async () => {
		mocks.routeParams = { id: "7" };
		mocks.getArticle.mockResolvedValue({ ...article, hebrewDates: undefined });
		renderPage();
		await waitFor(() => expect(screen.getByText("✏️ עריכת מאמר")).toBeTruthy());
		expect(screen.queryByTestId("hebrew-dates-editor")).toBeNull();
	});

	it("opens a new article with an editable empty assignment set", async () => {
		mocks.routeParams = { id: "new" };
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("hebrew-dates-editor")).toBeTruthy(),
		);
		expect(mocks.hebrewDatesEditor).toHaveBeenCalledWith(
			expect.objectContaining({ dates: [] }),
		);
	});
});
