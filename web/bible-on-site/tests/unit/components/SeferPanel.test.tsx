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
		...props
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...props}>
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
		expect(screen.getByRole("link", { name: 'רש"י' })).toBeTruthy();
		expect(screen.getByRole("link", { name: "אבן עזרא" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: 'בחירת רש"י' }),
		).toBeTruthy();
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
		expect(stored.sefer ?? {}).toEqual({});
	});

	it("scopes edits to the sefer once an override exists and clears back", async () => {
		await renderPanel(<SeferPanel {...PROPS} />);
		fireEvent.click(screen.getByRole("button", { name: "התאמה לספר זה" }));
		fireEvent.click(
			screen.getByRole("button", { name: "בחירת אבן עזרא" }),
		);
		await flushAsync();
		let stored = JSON.parse(
			localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY) ?? "{}",
		);
		expect(stored.sefer.בראשית).toEqual([2]);
		expect(stored.global).toEqual([]);
		fireEvent.click(
			screen.getByRole("button", { name: 'חזרה לברירת מחדל לתנ"ך' }),
		);
		await flushAsync();
		stored = JSON.parse(
			localStorage.getItem(SEFER_PERUSH_SELECTION_STORAGE_KEY) ?? "{}",
		);
		expect(stored.sefer.בראשית).toBeUndefined();
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
	it("opens a perush deep view from its tag link", async () => {
		mockGetPerushNotesBatch.mockResolvedValue({
			1: [{ pasuk: 1, noteIdx: 0, noteContent: "<p>רשי א</p>" }],
		});
		await renderPanel(<SeferPanel {...PROPS} />);
		fireEvent.click(screen.getByRole("link", { name: 'רש"י' }));
		await screen.findByText("→ חזרה לפרשנים");
		expect(
			screen.getByRole("heading", { name: 'רש"י' }),
		).toBeTruthy();
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
		await screen.findByRole("link", { name: "אבן עזרא" });
		await flushAsync();
	});

	it("opens a deep-linked article in the מאמרים panel", async () => {
		mockGetArticleForBook.mockResolvedValue(mockArticles[0]);
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
		mockGetArticleForBook.mockResolvedValue(mockArticles[0]);
		await renderPanel(<SeferPanel {...PROPS} initialSlug="7" />);
		const toggle = await screen.findByRole("button", { name: "מסך מלא" });
		fireEvent.click(toggle);
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});
