import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	navigate: vi.fn(),
	getArticle: vi.fn(),
	createArticle: vi.fn(),
	updateArticle: vi.fn(),
	deleteArticle: vi.fn(),
	getAuthors: vi.fn(),
	getPerakim: vi.fn(),
	listMoadim: vi.fn(),
	hebrewDatesEditor: vi.fn((_props: { dates: unknown; onChange: unknown }) => (
		<div data-testid="hebrew-dates-editor" />
	)),
	params: { id: "7" },
	links: [] as Record<string, unknown>[],
	panelProps: [] as Record<string, unknown>[],
	// Content the editor still owes the page while its debounce is pending.
	pendingContent: null as string | null,
	flushCalls: 0,
	editorOnChange: null as ((content: string) => void) | null,
	coverageOnChange: null as ((sources: unknown[]) => void) | null,
}));

vi.mock("~/server/articles", () => ({
	getArticle: server.getArticle,
	createArticle: server.createArticle,
	updateArticle: server.updateArticle,
	deleteArticle: server.deleteArticle,
}));
vi.mock("~/server/authors", () => ({ getAuthors: server.getAuthors }));
vi.mock("~/server/moadim", () => ({ listMoadim: server.listMoadim }));
vi.mock("~/server/perakim", () => ({ getPerakim: server.getPerakim }));
vi.mock("~/components/WysiwygEditor", () => ({
	WysiwygEditor: (props: {
		content: string;
		onChange: (content: string) => void;
		ref?: { current: { flush?: () => void } | null };
	}) => {
		server.editorOnChange = props.onChange;
		if (props.ref) {
			props.ref.current = {
				flush: () => {
					server.flushCalls += 1;
					if (server.pendingContent !== null && server.editorOnChange) {
						server.editorOnChange(server.pendingContent);
					}
				},
			};
		}
		// The real editor delivers its pending debounced edit from its own
		// unmount cleanup, which runs after the route's cleanup.
		useEffect(() => {
			return () => {
				if (server.pendingContent !== null && server.editorOnChange) {
					server.editorOnChange(server.pendingContent);
				}
			};
		}, []);
		return <div data-testid="wysiwyg" data-value={props.content} />;
	},
}));
vi.mock("~/components/HebrewDatesEditor", () => ({
	HebrewDatesEditor: (props: { dates: unknown; onChange: unknown }) =>
		server.hebrewDatesEditor(props),
}));
vi.mock("~/components/CoveringSourcesEditor", () => ({
	CoveringSourcesEditor: (props: { onChange: (sources: unknown[]) => void }) => {
		server.coverageOnChange = props.onChange;
		return <div data-testid="covering-sources" />;
	},
}));
vi.mock("~/components/AutoSaveIndicator", () => ({
	AutoSaveIndicator: () => <div data-testid="autosave" />,
}));
vi.mock("~/components/ArticleRelationshipsPanel", () => ({
	ArticleRelationshipsPanel: (props: Record<string, unknown>) => {
		server.panelProps.push(props);
		return <div data-testid="relationships-panel" />;
	},
}));
vi.mock("~/components/editor/entryLinkSearch", () => ({
	searchEntriesForLink: vi.fn(async () => []),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: Record<string, unknown>) => ({
		...config,
		useParams: () => ({ id: server.params.id }),
	}),
	useSearch: () => ({ perekId: undefined }),
	useNavigate: () => server.navigate,
	Link: (props: {
		children?: React.ReactNode;
		to?: string;
		[key: string]: unknown;
	}) => {
		server.links.push(props);
		return <>{props.children}</>;
	},
}));

import { Route } from "~/routes/articles.$id";

const article = {
	id: 7,
	perek_id: 1,
	author_id: 2,
	name: "מאמר בדיקה",
	abstract: "תקציר",
	priority: 3,
	distributable: true,
	content: "<p>תוכן</p>",
	coverage_verified: true,
	coveringSources: [{ perek_id: 1, pasuk: 1 }],
	moedIds: [1],
	hebrewDates: [{ hebrew_month: 11, hebrew_day: 9 }],
};

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { component: Page } = Route as unknown as {
		component: () => React.ReactElement;
	};
	return render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
}

describe("ArticleEditPage", () => {
	beforeEach(() => {
		server.params.id = "7";
		server.links.length = 0;
		server.panelProps.length = 0;
		server.pendingContent = null;
		server.flushCalls = 0;
		server.editorOnChange = null;
		server.coverageOnChange = null;
		for (const mock of Object.values(server)) {
			if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
		}
		server.getArticle.mockResolvedValue(article);
		server.getAuthors.mockResolvedValue([
			{ id: 2, name: "הרב קוק", details: "", imageUrl: "" },
		]);
		server.getPerakim.mockResolvedValue([
			{
				id: 1,
				perek_id: 1,
				sefer_id: 1,
				sefer_name: "בראשית",
				perek: 1,
				perek_in_context: 1,
				additional_letter: null,
				pasuk_count: 31,
			},
		]);
		server.listMoadim.mockResolvedValue([]);
	});

	it("links a persisted article to its link proposals and relationship panel", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("relationships-panel")).toBeInTheDocument(),
		);

		// The header link carries the article id into the proposals queue.
		const proposalsLink = server.links.find(
			(link) => link.to === "/link-proposals",
		);
		expect(proposalsLink?.search).toEqual({ articleId: 7 });
		expect(screen.getByText("PRs לקישורי מאמר זה")).toBeInTheDocument();

		// The panel receives the live form values for its managed entries.
		await waitFor(() => expect(server.panelProps.length).toBeGreaterThan(0));
		expect(server.panelProps.at(-1)).toMatchObject({
			articleId: 7,
			perekId: 1,
			authorId: 2,
			authorName: "הרב קוק",
			coveringCount: 1,
			coverageVerified: true,
		});
	});

	it("hides the proposals link and panel for a new article", async () => {
		server.params.id = "new";
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);

		expect(
			screen.queryByText("PRs לקישורי מאמר זה"),
		).not.toBeInTheDocument();
		expect(screen.queryByTestId("relationships-panel")).not.toBeInTheDocument();
		expect(server.links.some((link) => link.to === "/link-proposals")).toBe(
			false,
		);
		expect(server.getArticle).not.toHaveBeenCalled();
	});

	it("shows the spinner while a save is in flight", async () => {
		server.updateArticle.mockReturnValue(new Promise(() => {}));
		renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "שמור עכשיו" }),
			).toBeEnabled(),
		);

		fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "שומר..." }),
			).toBeDisabled(),
		);
		expect(
			screen
				.getByRole("button", { name: "שומר..." })
				.querySelector(".animate-spin"),
		).toBeInTheDocument();
	});

	it("deletes the article only after the confirm dialog approves", async () => {
		server.deleteArticle.mockResolvedValue({});
		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: "מחק מאמר" }));

		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "ביטול",
			}),
		);
		expect(server.deleteArticle).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "מחק מאמר" }));
		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "מחק",
			}),
		);
		await waitFor(() =>
			expect(server.deleteArticle).toHaveBeenCalledWith({ data: 7 }),
		);
		await waitFor(() =>
			expect(server.navigate).toHaveBeenCalledWith(
				expect.objectContaining({ to: "/articles/perek/$perekId" }),
			),
		);
	});

	it("flushes the editor's pending debounce into a manual save", async () => {
		server.updateArticle.mockResolvedValue(article);
		server.pendingContent = "<p>עריכה חדשה</p>";
		renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "שמור עכשיו" }),
			).toBeEnabled(),
		);

		fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));

		expect(server.flushCalls).toBe(1);
		await waitFor(() =>
			expect(server.updateArticle).toHaveBeenCalledWith({
				data: expect.objectContaining({
					id: 7,
					content: "<p>עריכה חדשה</p>",
				}),
			}),
		);
	});

	it("saves pending editor edits when the page unmounts", async () => {
		server.updateArticle.mockResolvedValue(article);
		server.pendingContent = "<p>עריכה חדשה</p>";
		const utils = renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);

		utils.unmount();

		await waitFor(() =>
			expect(server.updateArticle).toHaveBeenCalledWith({
				data: expect.objectContaining({
					id: 7,
					content: "<p>עריכה חדשה</p>",
				}),
			}),
		);
	});

	it(
		"blocks autosave while a covering source is invalid and resumes once fixed",
		{ timeout: 15_000 },
		async () => {
		server.updateArticle.mockResolvedValue(article);
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("covering-sources")).toBeInTheDocument(),
		);

		// A cleared pasuk sits in draft state as NaN: it must never be sent.
		act(() =>
			server.coverageOnChange?.([{ perek_id: 1, pasuk: Number.NaN }]),
		);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		expect(server.updateArticle).not.toHaveBeenCalled();

		act(() =>
			server.coverageOnChange?.([{ perek_id: 1, pasuk: 3 }]),
		);
		await waitFor(
			() =>
				expect(server.updateArticle).toHaveBeenCalledWith({
					data: expect.objectContaining({
						coveringSources: [{ perek_id: 1, pasuk: 3 }],
					}),
				}),
			{ timeout: 4000 },
		);
		},
	);

	it("auto-saves pending edits after the debounce delay", async () => {
		server.updateArticle.mockResolvedValue(article);
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);

		act(() => server.editorOnChange?.("<p>עריכה אוטומטית</p>"));

		await waitFor(
			() =>
				expect(server.updateArticle).toHaveBeenCalledWith({
					data: expect.objectContaining({
						content: "<p>עריכה אוטומטית</p>",
					}),
				}),
			{ timeout: 4000 },
		);
		expect(server.flushCalls).toBe(1);
	});

	it("saves a non-content edit on unmount", async () => {
		server.updateArticle.mockResolvedValue(article);
		const utils = renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);
		fireEvent.change(screen.getByLabelText(/שם המאמר/), {
			target: { value: "שם חדש" },
		});

		utils.unmount();

		await waitFor(() =>
			expect(server.updateArticle).toHaveBeenCalledWith({
				data: expect.objectContaining({ name: "שם חדש" }),
			}),
		);
	});

	it("skips the auto-save when the name is blank", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);
		fireEvent.change(screen.getByLabelText(/שם המאמר/), {
			target: { value: "" },
		});

		act(() => server.editorOnChange?.("<p>עריכה</p>"));

		// Past the debounce: a blank name must not reach the server.
		await new Promise((resolve) => setTimeout(resolve, 2500));
		expect(server.updateArticle).not.toHaveBeenCalled();
	});

	it("creates a new article then routes follow-up saves to its id", async () => {
		server.params.id = "new";
		server.createArticle.mockResolvedValue({ ...article, id: 42 });
		server.updateArticle.mockResolvedValue({ ...article, id: 42 });
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);
		fireEvent.change(screen.getByLabelText(/שם המאמר/), {
			target: { value: "מאמר חדש" },
		});

		act(() => server.editorOnChange?.("<p>גרסה ראשונה</p>"));
		await waitFor(
			() => expect(server.createArticle).toHaveBeenCalled(),
			{ timeout: 4000 },
		);
		expect(server.navigate).toHaveBeenCalled();

		// The next auto-save must update the persisted article, not re-create.
		act(() => server.editorOnChange?.("<p>גרסה שנייה</p>"));
		await waitFor(
			() =>
				expect(server.updateArticle).toHaveBeenCalledWith({
					data: expect.objectContaining({
						id: 42,
						content: "<p>גרסה שנייה</p>",
					}),
				}),
			{ timeout: 4000 },
		);
	});

	it("renders an article with no stored content", async () => {
		server.getArticle.mockResolvedValue({ ...article, content: null });
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);
		expect(screen.getByTestId("wysiwyg")).toHaveAttribute("data-value", "");
	});

	it("skips the deferred save while a StrictMode remount is in flight", async () => {
		// Content the editor still owes the page: during the replay its unmount
		// cleanup delivers it while mountedRef is already true again.
		server.pendingContent = "<p>עריכה ממתינה</p>";
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const { component: Page } = Route as unknown as {
			component: () => React.ReactElement;
		};
		const utils = render(
			<StrictMode>
				<QueryClientProvider client={client}>
					<Page />
				</QueryClientProvider>
			</StrictMode>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);

		// Without the mountedRef guard the deferred save would persist the
		// pending edit on a StrictMode replay; it must stay silent.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.updateArticle).not.toHaveBeenCalled();

		// A real unmount still saves the pending edit.
		utils.unmount();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(server.updateArticle).toHaveBeenCalledWith({
			data: expect.objectContaining({ content: "<p>עריכה ממתינה</p>" }),
		});
	});

	it("does not save on unmount when nothing changed", async () => {
		const utils = renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("wysiwyg")).toBeInTheDocument(),
		);

		utils.unmount();

		// The deferred unmount save fires on a 0ms timeout after teardown.
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.updateArticle).not.toHaveBeenCalled();
	});

	it(
		"keeps edits typed while a save is in flight",
		{ timeout: 15_000 },
		async () => {
			let resolveSave: ((value: unknown) => void) | undefined;
			server.updateArticle.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveSave = resolve;
					}),
			);
			// The post-save refetch returns the persisted snapshot, which
			// differs from the value typed while the save was in flight.
			server.getArticle
				.mockResolvedValueOnce(article)
				.mockResolvedValue({ ...article, name: "השם השמור" });
			renderPage();
			const nameInput = (await screen.findByLabelText(
				/שם המאמר/,
			)) as HTMLInputElement;

			fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
			await waitFor(() =>
				expect(server.updateArticle).toHaveBeenCalledTimes(1),
			);

			fireEvent.change(nameInput, {
				target: { value: "נערך תוך כדי שמירה" },
			});
			expect(nameInput.value).toBe("נערך תוך כדי שמירה");

			await act(async () => resolveSave?.({ ...article, name: "השם השמור" }));
			await waitFor(() =>
				expect(server.getArticle).toHaveBeenCalledTimes(2),
			);

			// The refetch must not revert the field, and the next autosave
			// must persist the value the user actually typed.
			await waitFor(() =>
				expect(nameInput.value).toBe("נערך תוך כדי שמירה"),
			);
			await waitFor(
				() =>
					expect(server.updateArticle).toHaveBeenLastCalledWith({
						data: expect.objectContaining({
							name: "נערך תוך כדי שמירה",
						}),
					}),
				{ timeout: 5000 },
			);
		},
	);

	it("queues the unmount save behind a save still in flight", async () => {
		const resolvers: Array<(value: unknown) => void> = [];
		server.updateArticle.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve);
				}),
		);
		const utils = renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "שמור עכשיו" }),
			).toBeEnabled(),
		);

		act(() => server.editorOnChange?.("<p>גרסה ראשונה</p>"));
		fireEvent.click(screen.getByRole("button", { name: "שמור עכשיו" }));
		await waitFor(() =>
			expect(server.updateArticle).toHaveBeenCalledTimes(1),
		);

		server.pendingContent = "<p>גרסה שנייה</p>";
		utils.unmount();

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.updateArticle).toHaveBeenCalledTimes(1);

		resolvers[0]?.(article);
		await waitFor(() =>
			expect(server.updateArticle).toHaveBeenLastCalledWith({
				data: expect.objectContaining({
					content: "<p>גרסה שנייה</p>",
				}),
			}),
		);
	});
});

describe("Article edit Hebrew dates (#3098)", () => {
	beforeEach(() => {
		for (const mock of [
			server.navigate,
			server.getArticle,
			server.getAuthors,
			server.getPerakim,
			server.createArticle,
			server.updateArticle,
			server.deleteArticle,
			server.hebrewDatesEditor,
		])
			mock.mockReset();
		server.hebrewDatesEditor.mockImplementation(() => (
			<div data-testid="hebrew-dates-editor" />
		));
		server.listMoadim.mockResolvedValue([]);
		server.getArticle.mockResolvedValue(article);
		server.getAuthors.mockResolvedValue([]);
		server.getPerakim.mockResolvedValue([]);
	});

	it("shows the assignment editor for a persisted article with dates", async () => {
		server.params = { id: "7" };
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("hebrew-dates-editor")).toBeTruthy(),
		);
		expect(server.hebrewDatesEditor).toHaveBeenCalledWith(
			expect.objectContaining({
				dates: [{ hebrew_month: 11, hebrew_day: 9 }],
			}),
		);
	});

	it("hides the assignment editor when the schema is not deployed", async () => {
		server.params = { id: "7" };
		server.getArticle.mockResolvedValue({ ...article, hebrewDates: undefined });
		renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: "עריכת מאמר" }),
			).toBeTruthy(),
		);
		expect(screen.queryByTestId("hebrew-dates-editor")).toBeNull();
	});

	it("opens a new article with an editable empty assignment set", async () => {
		server.params = { id: "new" };
		renderPage();
		await waitFor(() =>
			expect(screen.getByTestId("hebrew-dates-editor")).toBeTruthy(),
		);
		expect(server.hebrewDatesEditor).toHaveBeenCalledWith(
			expect.objectContaining({ dates: [] }),
		);
	});
});
