/**
 * @jest-environment jsdom
 */

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
		prefetch: _prefetch,
		onClick,
		...props
	}: React.ComponentProps<"a"> & { prefetch?: boolean }) => (
		<a
			href={href}
			{...props}
			onClick={(event) => {
				onClick?.(event);
				// Browser navigation belongs to Next, which this unit test mocks.
				event.preventDefault();
			}}
		>
			{children}
		</a>
	),
}));

jest.mock("@/lib/authors/url-utils", () => ({
	authorNameToSlug: (name: string) => encodeURIComponent(name),
}));

jest.mock("../../../src/app/929/[number]/actions", () => ({
	getArticleForBook: jest.fn(),
	getPerushNotesForPerekBatch: jest.fn(),
}));

jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import {
	getArticleForBook,
	getPerushNotesForPerekBatch,
} from "../../../src/app/929/[number]/actions";
import { SeferPanel } from "../../../src/app/929/[number]/components/SeferPanel";
import { getSeferOpenPerush } from "../../../src/app/929/[number]/components/sefer-pasuk-navigation";
import {
	isSeferPasukSelectionMode,
	resetSeferPasukSelectionState,
	toggleSeferPasuk,
} from "../../../src/app/929/[number]/components/sefer-pasuk-selection";
import type { Article } from "../../../src/lib/articles";
import {
	SEFER_PERUSH_SELECTION_STORAGE_KEY,
	setSeferPerushSelection,
} from "../../../src/lib/sefer-perush-selection";

const mockGetArticleForBook = getArticleForBook as jest.MockedFunction<
	typeof getArticleForBook
>;
const mockGetPerushNotesBatch =
	getPerushNotesForPerekBatch as jest.MockedFunction<
		typeof getPerushNotesForPerekBatch
	>;

const RASHI = { id: 1, name: 'רש"י', parshanName: 'רש"י', noteCount: 10 };
const IBN_EZRA = {
	id: 2,
	name: "אבן עזרא",
	parshanName: "אברהם אבן עזרא",
	noteCount: 4,
};

const mockArticles: Article[] = [
	{
		id: 7,
		perekId: 1,
		authorId: 10,
		name: "מאמר ראשון",
		abstract: "<p>תקציר</p>",
		content: "<p>תוכן</p>",
		priority: 1,
		authorName: "הרב ישראל",
		authorImageUrl: "https://example.com/1.jpg",
	},
];

const PROPS = {
	perekId: 1,
	seferName: "בראשית",
	hebrewDateStr: "י׳ בשבט",
	perushim: [RASHI, IBN_EZRA],
	articles: mockArticles,
};

const flushAsync = () => act(async () => {});

const renderPanel = async (ui: React.ReactElement) => {
	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = render(ui);
	});
	return view;
};

beforeEach(() => {
	jest.clearAllMocks();
	localStorage.clear();
	sessionStorage.clear();
	resetSeferPasukSelectionState();
	mockGetPerushNotesBatch.mockResolvedValue({});
});

describe("tabs and date header", () => {
	it("renders the date between the two tab switches", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		expect(screen.getByRole("tab", { name: "פרשנים" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "מאמרים" })).toBeTruthy();
		expect(screen.getByText("י׳ בשבט")).toBeTruthy();
	});

	it("switches the active panel with tab semantics and persists the choice", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		const articlesTab = screen.getByRole("tab", { name: "מאמרים" });
		fireEvent.click(articlesTab);
		expect(articlesTab.getAttribute("aria-selected")).toBe("true");
		expect(
			screen.getByRole("tab", { name: "פרשנים" }).getAttribute("aria-selected"),
		).toBe("false");
		expect(sessionStorage.getItem("seferPanelTab")).toBe("articles");
	});

	it("moves between tabs with arrow keys in RTL order", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		const list = screen.getByRole("tablist");
		// RTL: ArrowLeft moves to מאמרים (visually left of the perushim tab).
		fireEvent.keyDown(list, { key: "ArrowLeft" });
		expect(
			screen.getByRole("tab", { name: "מאמרים" }).getAttribute("aria-selected"),
		).toBe("true");
		fireEvent.keyDown(list, { key: "ArrowRight" });
		expect(
			screen.getByRole("tab", { name: "פרשנים" }).getAttribute("aria-selected"),
		).toBe("true");
		fireEvent.keyDown(list, { key: "End" });
		expect(
			screen.getByRole("tab", { name: "מאמרים" }).getAttribute("aria-selected"),
		).toBe("true");
	});
});

describe("perush tag selection and persistence", () => {
	it("renders eligible perushim as tags without pesukim counters", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		expect(screen.getByRole("button", { name: 'בחירת רש"י' })).toBeTruthy();
		expect(screen.getByRole("button", { name: "בחירת אבן עזרא" })).toBeTruthy();
		expect(screen.getByRole("button", { name: 'בחירת רש"י' })).toBeTruthy();
		// The old tags carried numeric pesukim counters; the panel row's own
		// בחירת פסוקים control is not a counter.
		expect(screen.queryByText(/\d+ פסוקים/)).toBeNull();
	});

	it("writes toggles to the Tanach-wide default while inheriting", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		fireEvent.click(screen.getByRole("button", { name: 'בחירת רש"י' }));
		await flushAsync();
		const stored = JSON.parse(
			localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY) ?? "{}",
		);
		expect(stored.global).toEqual([1]);
		expect(stored.sefer.בראשית).toEqual([1]);
	});

	it("automatically remembers each sefer and defaults new sefarim without scope controls", async () => {
		const view = await renderPanel(<SeferPanel {...PROPS} />);
		expect(screen.queryByText("התאמה לספר זה")).toBeNull();
		expect(screen.queryByText('בחירת ברירת מחדל לתנ"ך')).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: 'בחירת רש"י' }));
		await flushAsync();
		view.rerender(<SeferPanel {...PROPS} seferName="שמות" />);
		expect(screen.getByRole("button", { name: 'בחירת רש"י' })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		fireEvent.click(screen.getByRole("button", { name: "בחירת אבן עזרא" }));
		await flushAsync();
		view.rerender(<SeferPanel {...PROPS} seferName="בראשית" />);
		expect(screen.getByRole("button", { name: 'בחירת רש"י' })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "בחירת אבן עזרא" }),
		).toHaveAttribute("aria-pressed", "false");
	});

	it("keeps stored ids unavailable on this perek when toggling others", async () => {
		setSeferPerushSelection("בראשית", [99]);
		await renderPanel(<SeferPanel {...PROPS} />);
		fireEvent.click(screen.getByRole("button", { name: 'בחירת רש"י' }));
		await flushAsync();
		const stored = JSON.parse(
			localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY) ?? "{}",
		);
		expect(stored.global).toEqual([99, 1]);
	});
});

describe("grouped commentary", () => {
	it("fetches selected perushim in one batch and groups notes by pasuk", async () => {
		setSeferPerushSelection("בראשית", [1, 2]);
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [
				{ pasuk: 2, noteIdx: 0, noteContent: "<p>רשי ב</p>" },
				{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" },
			],
			2: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>אע א</p>" }],
		});
		await renderPanel(<SeferPanel {...PROPS} />);
		await screen.findByText("פסוק א");
		expect(mockGetPerushNotesBatch).toHaveBeenCalledWith(1, [1, 2]);
		const pasukA = screen.getByText("פסוק א");
		const pasukB = screen.getByText("פסוק ב");
		expect(
			pasukA.compareDocumentPosition(pasukB) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.getByText("רשי א")).toBeTruthy();
		expect(screen.getByText("אע א")).toBeTruthy();
		expect(screen.getByText("רשי ב")).toBeTruthy();
	});

	it("filters groups by selected pesukim", async () => {
		setSeferPerushSelection("בראשית", [1]);
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [
				{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" },
				{ pasuk: 2, noteIdx: 0, noteContent: "<p>רשי ב</p>" },
			],
		});
		await renderPanel(<SeferPanel {...PROPS} selectedPesukim={new Set([2])} />);
		await screen.findByText("פסוק ב");
		expect(screen.queryByText("פסוק א")).toBeNull();
		expect(screen.getByText("רשי ב")).toBeTruthy();
	});

	it("publishes commentary pesukim for pasuk navigation only on the perushim tab", async () => {
		setSeferPerushSelection("בראשית", [1]);
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [{ pasuk: 3, noteIdx: 0, noteContent: "<p>x</p>" }],
		});
		await renderPanel(<SeferPanel {...PROPS} />);
		await screen.findByText("פסוק ג");
		expect(getSeferOpenPerush(1)?.pesukim.has(3)).toBe(true);
		fireEvent.click(screen.getByRole("tab", { name: "מאמרים" }));
		expect(getSeferOpenPerush(1)).toBeNull();
	});

	it("shows an honest failure and retries the batch", async () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			setSeferPerushSelection("בראשית", [1]);
			mockGetPerushNotesBatch.mockRejectedValueOnce(new Error("db down"));
			await renderPanel(<SeferPanel {...PROPS} />);
			await screen.findByText(/טעינת הפירוש רש"י נכשלה/);
			mockGetPerushNotesBatch.mockResolvedValue({
				1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" }],
			});
			fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
			await screen.findByText("פסוק א");
			expect(mockGetPerushNotesBatch).toHaveBeenCalledTimes(2);
		} finally {
			error.mockRestore();
		}
	});

	it("shows the empty state when nothing is selected", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		expect(screen.getByText(/לא נבחרו פרשנים/)).toBeTruthy();
	});
});

describe("pasuk selection on the scripture page", () => {
	it("filters groups by the selection store when no prop is given", async () => {
		setSeferPerushSelection("בראשית", [1]);
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [
				{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" },
				{ pasuk: 2, noteIdx: 0, noteContent: "<p>רשי ב</p>" },
			],
		});
		toggleSeferPasuk(1, 2);
		await renderPanel(<SeferPanel {...PROPS} />);
		await screen.findByText("פסוק ב");
		expect(screen.queryByText("פסוק א")).toBeNull();
		expect(screen.getByText("מסוננים: 1 פסוקים")).toBeTruthy();
	});

	it("enters and exits selection mode and clears the selection", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		expect(screen.getByText("כל פסוקי הפרק")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "בחירת פסוקים" }));
		expect(isSeferPasukSelectionMode(1)).toBe(true);
		expect(screen.getByText("סמנו פסוקים על גבי הפרק")).toBeTruthy();

		act(() => toggleSeferPasuk(1, 4));
		expect(screen.getByText("מסוננים: 1 פסוקים")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "סיום בחירה" }));
		expect(isSeferPasukSelectionMode(1)).toBe(false);
		// Selection survives the mode exit (item 3: separate concerns).
		expect(screen.getByText("מסוננים: 1 פסוקים")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "ניקוי בחירה" }));
		expect(screen.getByText("כל פסוקי הפרק")).toBeTruthy();
	});
});

describe("deep links", () => {
	it("toggles the full perush label without navigating or hiding the selection group", async () => {
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" }],
		});
		await renderPanel(<SeferPanel {...PROPS} />);
		fireEvent.click(screen.getByRole("button", { name: 'בחירת רש"י' }));
		expect(screen.queryByText("→ חזרה לפרשנים")).toBeNull();
		expect(screen.queryByRole("link", { name: 'רש"י' })).toBeNull();
		expect(
			screen
				.getByRole("button", { name: 'בחירת רש"י' })
				.getAttribute("aria-pressed"),
		).toBe("true");
		await screen.findByText("פסוק א");
	});

	it("selects only the deep-linked perush without writing storage", async () => {
		setSeferPerushSelection("בראשית", [2]);
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" }],
		});
		await renderPanel(<SeferPanel {...PROPS} initialSlug={'רש"י'} />);
		await screen.findByText("פסוק א");
		expect(screen.getByText("→ חזרה לפרשנים")).toBeTruthy();
		// The deep link resolved to רש"י (id 1) — the stored selection is untouched.
		const stored = JSON.parse(
			localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY) ?? "{}",
		);
		expect(stored.global).toEqual([2]);
		expect(mockGetPerushNotesBatch).toHaveBeenCalledWith(1, [1]);
		fireEvent.click(screen.getByText("→ חזרה לפרשנים"));
		await screen.findByRole("button", { name: "בחירת אבן עזרא" });
		await flushAsync();
	});

	it("opens a deep-linked article in the מאמרים panel", async () => {
		mockGetArticleForBook.mockResolvedValue({
			article: mockArticles[0],
			dedicationLines: [],
		});
		await renderPanel(<SeferPanel {...PROPS} initialSlug="7" />);
		await screen.findByText("חזרה למאמרים →");
		expect(
			screen.getByRole("tab", { name: "מאמרים" }).getAttribute("aria-selected"),
		).toBe("true");
	});

	it("clears a perush deep link back to the perek book route", async () => {
		const push = jest.spyOn(History.prototype, "pushState");
		try {
			mockGetPerushNotesBatch.mockResolvedValue({
				1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>x</p>" }],
			});
			await renderPanel(
				<SeferPanel {...PROPS} perekId={615} initialSlug={'רש"י'} />,
			);
			await screen.findByText("→ חזרה לפרשנים");
			push.mockClear();
			fireEvent.click(screen.getByText("→ חזרה לפרשנים"));
			await flushAsync();
			expect(push).toHaveBeenCalledWith(
				expect.objectContaining({ route: "/929/615?book" }),
				"",
				"/929/615?book",
			);
		} finally {
			push.mockRestore();
		}
	});
});

describe("article fullscreen", () => {
	it("opens the article fullscreen overlay and closes on Escape", async () => {
		mockGetArticleForBook.mockResolvedValue({
			article: mockArticles[0],
			dedicationLines: [],
		});
		await renderPanel(<SeferPanel {...PROPS} initialSlug="7" />);
		const toggle = await screen.findByRole("button", { name: "מסך מלא" });
		fireEvent.click(toggle);
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("ignores non-Escape keys and closes on the overlay's own control", async () => {
		mockGetArticleForBook.mockResolvedValue({
			article: mockArticles[0],
			dedicationLines: [],
		});
		await renderPanel(<SeferPanel {...PROPS} initialSlug="7" />);
		fireEvent.click(await screen.findByRole("button", { name: "מסך מלא" }));
		await screen.findByRole("dialog");
		fireEvent.keyDown(document, { key: "x" });
		const dialog = screen.getByRole("dialog");
		expect(dialog).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "צמצם" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});

describe("tab keyboard navigation", () => {
	it("supports Home, ignores other keys, and skips no-op moves", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		const list = screen.getByRole("tablist");
		fireEvent.keyDown(list, { key: "ArrowLeft" });
		expect(
			screen.getByRole("tab", { name: "מאמרים" }).getAttribute("aria-selected"),
		).toBe("true");
		fireEvent.keyDown(list, { key: "Home" });
		expect(
			screen.getByRole("tab", { name: "פרשנים" }).getAttribute("aria-selected"),
		).toBe("true");
		// A non-navigation key resolves to nothing; ArrowRight on the visually
		// rightmost tab (perushim, index 0) resolves back to the same index.
		fireEvent.keyDown(list, { key: "x" });
		fireEvent.keyDown(list, { key: "ArrowRight" });
		expect(
			screen.getByRole("tab", { name: "פרשנים" }).getAttribute("aria-selected"),
		).toBe("true");
	});
});

describe("stored tab fallback", () => {
	it("falls back to the default tab when sessionStorage throws", async () => {
		const getItem = jest
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new Error("denied");
			});
		try {
			await renderPanel(<SeferPanel {...PROPS} />);
			expect(
				screen
					.getByRole("tab", { name: "פרשנים" })
					.getAttribute("aria-selected"),
			).toBe("true");
		} finally {
			getItem.mockRestore();
		}
	});
});

describe("deep article load failures", () => {
	it("reports the failure and falls back to the article list", async () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			mockGetArticleForBook.mockRejectedValue(new Error("boom"));
			await renderPanel(<SeferPanel {...PROPS} initialSlug="7" />);
			await screen.findByRole("link", { name: /מאמר ראשון/ });
			expect(error).toHaveBeenCalledWith(
				"Failed to load book article",
				expect.objectContaining({ perekId: 1, articleId: 7 }),
			);
		} finally {
			error.mockRestore();
		}
	});

	it("clears the deep link when the article no longer exists", async () => {
		mockGetArticleForBook.mockResolvedValue(null);
		await renderPanel(<SeferPanel {...PROPS} initialSlug="7" />);
		await screen.findByRole("link", { name: /מאמר ראשון/ });
		expect(screen.queryByText("חזרה למאמרים →")).toBeNull();
	});
});

describe("modifier clicks", () => {
	it("keeps perush selection buttons from writing history even with modifiers", async () => {
		const push = jest.spyOn(History.prototype, "pushState");
		try {
			await renderPanel(<SeferPanel {...PROPS} />);
			push.mockClear();
			const tag = screen.getByRole("button", { name: 'בחירת רש"י' });
			for (const modifier of [
				"metaKey",
				"ctrlKey",
				"shiftKey",
				"altKey",
			] as const) {
				fireEvent.click(tag, { [modifier]: true });
				await flushAsync();
			}
			expect(screen.queryByText("→ חזרה לפרשנים")).toBeNull();
			expect(push).not.toHaveBeenCalled();
		} finally {
			push.mockRestore();
		}
	});

	it("leaves article card clicks with modifiers to the real anchor", async () => {
		const push = jest.spyOn(History.prototype, "pushState");
		try {
			await renderPanel(<SeferPanel {...PROPS} />);
			fireEvent.click(screen.getByRole("tab", { name: "מאמרים" }));
			push.mockClear();
			const card = document.getElementById("article-7");
			card?.addEventListener("click", (event) => event.preventDefault());
			expect(card).toBeTruthy();
			for (const modifier of [
				"metaKey",
				"ctrlKey",
				"shiftKey",
				"altKey",
			] as const) {
				fireEvent.click(card as HTMLElement, { [modifier]: true });
			}
			expect(screen.queryByText("חזרה למאמרים →")).toBeNull();
			expect(push).not.toHaveBeenCalled();
		} finally {
			push.mockRestore();
		}
	});
});

describe("commentary empty states", () => {
	it("reports a selection-filtered empty commentary", async () => {
		setSeferPerushSelection("בראשית", [1]);
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" }],
		});
		await renderPanel(<SeferPanel {...PROPS} selectedPesukim={new Set([5])} />);
		await screen.findByText("אין פרשנות מן הפרשנים שנבחרו לפסוקים שנבחרו");
	});
});

describe("panel without a perek", () => {
	it("renders pasuk group headers as plain text and navigates without history", async () => {
		const push = jest.spyOn(History.prototype, "pushState");
		try {
			setSeferPerushSelection("בראשית", [1]);
			mockGetPerushNotesBatch.mockResolvedValue({
				1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>x</p>" }],
			});
			await renderPanel(<SeferPanel {...PROPS} perekId={0} />);
			await screen.findByText("פסוק א");
			expect(screen.queryByRole("button", { name: /מעבר לפסוק/ })).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: 'בחירת רש"י' }));
			await flushAsync();
			expect(screen.queryByText("→ חזרה לפרשנים")).toBeNull();
			expect(push).not.toHaveBeenCalled();
		} finally {
			push.mockRestore();
		}
	});
});

describe("commentary batch lifecycle", () => {
	it("ignores a batch rejection that lands after unmount", async () => {
		setSeferPerushSelection("בראשית", [1]);
		let rejectBatch: (error: unknown) => void = () => {};
		mockGetPerushNotesBatch.mockImplementation(
			() =>
				new Promise((_, reject) => {
					rejectBatch = reject;
				}),
		);
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			const view = await renderPanel(<SeferPanel {...PROPS} />);
			view.unmount();
			await act(async () => {
				rejectBatch(new Error("late"));
			});
			expect(screen.queryByText(/נכשלה/)).toBeNull();
		} finally {
			error.mockRestore();
		}
	});
});

describe("pending commentary regression", () => {
	it("retains both responses when selection changes before the first batch resolves", async () => {
		let finishFirst!: (
			notes: Record<number, import("../../../src/lib/perushim").PerushNote[]>,
		) => void;
		mockGetPerushNotesBatch
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({
				2: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>תגובה שניה</p>" }],
			});
		await renderPanel(<SeferPanel {...PROPS} />);
		fireEvent.click(screen.getByRole("button", { name: 'בחירת רש"י' }));
		fireEvent.click(screen.getByRole("button", { name: "בחירת אבן עזרא" }));
		await flushAsync();
		await act(async () => {
			finishFirst({
				1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>תגובה ראשונה</p>" }],
			});
		});
		expect(await screen.findByText("תגובה ראשונה")).toBeTruthy();
		expect(screen.getByText("תגובה שניה")).toBeTruthy();
		expect(mockGetPerushNotesBatch).toHaveBeenCalledTimes(2);
	});
	it("reloads notes on chapter changes and discards the previous chapter's late response", async () => {
		let finishOld!: (
			notes: Record<number, import("../../../src/lib/perushim").PerushNote[]>,
		) => void;
		setSeferPerushSelection("בראשית", [1]);
		mockGetPerushNotesBatch
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishOld = resolve;
					}),
			)
			.mockResolvedValue({
				1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>פרק חדש</p>" }],
			});
		const view = await renderPanel(<SeferPanel {...PROPS} />);
		view.rerender(<SeferPanel {...PROPS} perekId={2} />);
		expect(await screen.findByText("פרק חדש")).toBeTruthy();
		await act(async () => {
			finishOld({
				1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>פרק ישן</p>" }],
			});
		});
		expect(screen.queryByText("פרק ישן")).toBeNull();
	});
	it("opens the full article body when clicking its abstract, including with parent navigation", async () => {
		// The article's own dedication scope reaches the in-book view too
		// (#2731) — the standalone route renders the same lines.
		mockGetArticleForBook.mockResolvedValue({
			article: mockArticles[0],
			dedicationLines: ["מוקדש לבדיקה"],
		});
		const onNavigate = jest.fn();
		await renderPanel(<SeferPanel {...PROPS} onNavigate={onNavigate} />);
		fireEvent.click(screen.getByRole("tab", { name: "מאמרים" }));
		fireEvent.click(screen.getByText("תקציר"));
		expect(await screen.findByText("תוכן")).toBeTruthy();
		expect(await screen.findByText("מוקדש לבדיקה")).toBeTruthy();
		expect(onNavigate).toHaveBeenCalledWith("7");
		expect(mockGetArticleForBook).toHaveBeenCalledWith(7);
	});
});
