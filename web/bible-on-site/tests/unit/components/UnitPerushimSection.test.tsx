/**
 * @jest-environment jsdom
 *
 * UnitPerushimSection keeps an open perush inside the alternative-
 * division page (issue #2190): selection is a query param on the unit
 * URL (never a /929 redirect), notes arrive clipped to the unit's
 * canonical bounds by the server action, and switching unit/perush or
 * navigating back/forward refreshes without stale commentary.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
let currentParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
	useSearchParams: () => currentParams,
	usePathname: () => "/מסורה/8",
	useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

jest.mock("../../../src/app/components/reading/actions", () => ({
	getUnitPerushNotes: jest.fn(),
}));

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { getUnitPerushNotes } from "../../../src/app/components/reading/actions";
import {
	perushParamName,
	unitPathWithoutPerush,
	unitPerushHref,
} from "../../../src/app/components/reading/unit-perush";
import { UnitPerushimSection } from "../../../src/app/components/reading/UnitPerushimSection";
import type {
	RangePerushSummary,
	RangedPerushNote,
} from "../../../src/lib/perushim";

const mockGetUnitPerushNotes = getUnitPerushNotes as jest.MockedFunction<
	typeof getUnitPerushNotes
>;

const perushim: RangePerushSummary[] = [
	{ id: 38, name: 'רש"י', parshanName: 'רש"י', noteCount: 12, perekId: 2 },
	{ id: 7, name: 'רמב"ן', parshanName: 'רמב"ן', noteCount: 4, perekId: 2 },
];

const notes: RangedPerushNote[] = [
	{ perekId: 2, pasuk: 4, noteIdx: 0, noteContent: "<p>note-2-4</p>" },
	{ perekId: 3, pasuk: 15, noteIdx: 0, noteContent: "<p>note-3-15</p>" },
];

const perekSources = { 2: "בראשית ב", 3: "בראשית ג" };

function renderSection(
	overrides: Partial<Parameters<typeof UnitPerushimSection>[0]> = {},
) {
	return render(
		<UnitPerushimSection
			division="masora"
			unitId={8}
			scope="torah"
			unitPath="/מסורה/8"
			perekId={2}
			perushim={perushim}
			title="פרשנים על הפרשה"
			emptyMessage="אין פרשנות לפרשה זו"
			perekSources={perekSources}
			{...overrides}
		/>,
	);
}

describe("UnitPerushimSection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		currentParams = new URLSearchParams();
		mockGetUnitPerushNotes.mockResolvedValue(notes);
		Element.prototype.scrollIntoView = jest.fn();
	});

	it("links perushim inside the division — never to /929", () => {
		renderSection();
		for (const link of screen.getAllByRole("link")) {
			expect(link.getAttribute("href")).toMatch(/^\/מסורה\/8\?/);
		}
		const rashi = screen.getByRole("link", { name: /רש"י/ });
		expect(rashi.getAttribute("href")).toContain("perush=");
		expect(decodeURIComponent(rashi.getAttribute("href") ?? "")).toContain(
			'perush=רש"י',
		);
	});

	it("pushes the unit URL with the perush param on click", () => {
		renderSection();
		fireEvent.click(screen.getByRole("link", { name: /רש"י/ }));
		expect(mockPush).toHaveBeenCalledTimes(1);
		const [url, opts] = mockPush.mock.calls[0];
		expect(decodeURIComponent(url)).toBe('/מסורה/8?perush=רש"י');
		expect(opts).toEqual({ scroll: false });
	});

	it("keeps unrelated params (reader mode) in the perush href", () => {
		currentParams = new URLSearchParams("book=&toc");
		renderSection();
		const rashi = screen.getByRole("link", { name: /רש"י/ });
		const href = decodeURIComponent(rashi.getAttribute("href") ?? "");
		expect(href).toContain("book=");
		expect(href).toContain('perush=רש"י');
	});

	it("fetches range-bounded notes for the selected perush", async () => {
		currentParams = new URLSearchParams(`perush=${encodeURIComponent('רש"י')}`);
		renderSection();
		// While notes are pending the carousel shows the loading state.
		expect(screen.getByText("מתחבר לפירוש...")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByText("note-2-4")).toBeInTheDocument(),
		);
		expect(mockGetUnitPerushNotes).toHaveBeenCalledWith(
			"masora",
			8,
			"torah",
			38,
		);
		// Canonical anchors address both covered perakim.
		expect(
			document.querySelector('a[href="#pasuk-2-4"]'),
		).toBeInTheDocument();
		expect(
			document.querySelector('a[href="#pasuk-3-15"]'),
		).toBeInTheDocument();
		expect(screen.getByText("בראשית ב")).toBeInTheDocument();
	});

	it("shares via the canonical /929 perush path", async () => {
		currentParams = new URLSearchParams(`perush=${encodeURIComponent('רש"י')}`);
		renderSection();
		await waitFor(() =>
			expect(screen.getByText("note-2-4")).toBeInTheDocument(),
		);
		expect(screen.getByRole("link", { name: "שיתוף" })).toHaveAttribute(
			"href",
			`/929/2/${encodeURIComponent('רש"י')}`,
		);
	});

	it("back returns to the unit URL without the perush param", async () => {
		currentParams = new URLSearchParams(
			`perush=${encodeURIComponent('רש"י')}&book`,
		);
		renderSection();
		await waitFor(() =>
			expect(screen.getByText("note-2-4")).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("button", { name: /חזרה לפרשנים/ }));
		expect(mockPush).toHaveBeenCalledWith("/מסורה/8?book=", {
			scroll: false,
		});
	});

	it("cleans a perush param that names no perush of this unit", () => {
		currentParams = new URLSearchParams("perush=נואף");
		renderSection();
		expect(mockReplace).toHaveBeenCalledWith("/מסורה/8", {
			scroll: false,
		});
		expect(mockGetUnitPerushNotes).not.toHaveBeenCalled();
	});

	it("keeps the carousel when the scope's param is absent", () => {
		renderSection();
		expect(
			screen.getByRole("link", { name: /רש"י/ }),
		).toBeInTheDocument();
		expect(mockGetUnitPerushNotes).not.toHaveBeenCalled();
	});

	it("uses the haftara param and scope for haftara sections", async () => {
		currentParams = new URLSearchParams(
			`haftaraPerush=${encodeURIComponent('רש"י')}`,
		);
		render(
			<UnitPerushimSection
				division="parasha"
				unitId={1}
				scope="haftara"
				unitPath="/פרשה/1"
				perekId={100}
				perushim={perushim}
				title="פרשנים על ההפטרה"
				emptyMessage="אין פרשנות להפטרה זו"
			/>,
		);
		await waitFor(() =>
			expect(mockGetUnitPerushNotes).toHaveBeenCalledWith(
				"parasha",
				1,
				"haftara",
				38,
			),
		);
	});

	it("leaves the other scope's param untouched when cleaning its own", () => {
		currentParams = new URLSearchParams(
			`perush=${encodeURIComponent('רש"י')}&haftaraPerush=נואף`,
		);
		render(
			<UnitPerushimSection
				division="parasha"
				unitId={1}
				scope="haftara"
				unitPath="/פרשה/1"
				perekId={100}
				perushim={perushim}
				title="פרשנים על ההפטרה"
				emptyMessage="אין פרשנות להפטרה זו"
			/>,
		);
		expect(mockReplace).toHaveBeenCalledWith(
			`/פרשה/1?perush=${encodeURIComponent('רש"י')}`,
			{ scroll: false },
		);
	});

	it("refreshes notes when the selection changes and drops stale fetches", async () => {
		let resolveFirst: (value: RangedPerushNote[]) => void = () => {};
		let resolveSecond: (value: RangedPerushNote[]) => void = () => {};
		mockGetUnitPerushNotes
			.mockImplementationOnce(
				() =>
					new Promise<RangedPerushNote[]>((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<RangedPerushNote[]>((resolve) => {
						resolveSecond = resolve;
					}),
			);

		currentParams = new URLSearchParams(
			`perush=${encodeURIComponent('רש"י')}`,
		);
		const { rerender } = renderSection();

		// Switch selection before the first fetch resolves.
		currentParams = new URLSearchParams(`perush=${encodeURIComponent('רמב"ן')}`);
		rerender(
			<UnitPerushimSection
				division="masora"
				unitId={8}
				scope="torah"
				unitPath="/מסורה/8"
				perekId={2}
				perushim={perushim}
				title="פרשנים על הפרשה"
				emptyMessage="אין פרשנות לפרשה זו"
				perekSources={perekSources}
			/>,
		);

		const secondNotes: RangedPerushNote[] = [
			{ perekId: 3, pasuk: 1, noteIdx: 0, noteContent: "<p>ramban-3-1</p>" },
		];
		await act(async () => resolveSecond(secondNotes));
		await waitFor(() =>
			expect(screen.getByText("ramban-3-1")).toBeInTheDocument(),
		);

		// The stale first response can no longer replace the new view.
		await act(async () => resolveFirst(notes));
		expect(screen.getByText("ramban-3-1")).toBeInTheDocument();
		expect(screen.queryByText("note-2-4")).toBeNull();
		expect(screen.getByRole("heading", { name: 'רמב"ן' })).toBeInTheDocument();
	});

	it("ignores a stale rejection after the selection changes", async () => {
		let rejectStale: (reason?: unknown) => void = () => {};
		let resolveCurrent: (value: RangedPerushNote[]) => void = () => {};
		mockGetUnitPerushNotes
			.mockImplementationOnce(
				() =>
					new Promise<RangedPerushNote[]>((_resolve, reject) => {
						rejectStale = reject;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<RangedPerushNote[]>((resolve) => {
						resolveCurrent = resolve;
					}),
			);

		currentParams = new URLSearchParams(
			`perush=${encodeURIComponent('רש"י')}`,
		);
		const { rerender } = renderSection();
		currentParams = new URLSearchParams(`perush=${encodeURIComponent('רמב"ן')}`);
		rerender(
			<UnitPerushimSection
				division="masora"
				unitId={8}
				scope="torah"
				unitPath="/מסורה/8"
				perekId={2}
				perushim={perushim}
				title="פרשנים על הפרשה"
				emptyMessage="אין פרשנות לפרשה זו"
			/>,
		);

		const errorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		// A rejection settling after the switch is logged but dropped.
		await act(async () => rejectStale(new Error("stale")));
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to load bounded commentary",
			expect.objectContaining({ perushId: 38 }),
		);
		await act(async () => resolveCurrent(notes));
		await waitFor(() =>
			expect(screen.getByText("note-2-4")).toBeInTheDocument(),
		);
		expect(screen.getByRole("heading", { name: 'רמב"ן' })).toBeInTheDocument();
		errorSpy.mockRestore();
	});

	it("shows the empty message when the perush has no notes in bounds", async () => {
		mockGetUnitPerushNotes.mockResolvedValue([]);
		currentParams = new URLSearchParams(`perush=${encodeURIComponent('רש"י')}`);
		renderSection();
		await waitFor(() =>
			expect(screen.getByText("אין פרשנות לפרשה זו")).toBeInTheDocument(),
		);
	});

	it("shows the empty message when the notes fetch fails", async () => {
		mockGetUnitPerushNotes.mockRejectedValue(new Error("API down"));
		const errorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		currentParams = new URLSearchParams(`perush=${encodeURIComponent('רש"י')}`);
		renderSection();
		await waitFor(() =>
			expect(screen.getByText("אין פרשנות לפרשה זו")).toBeInTheDocument(),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to load bounded commentary",
			expect.objectContaining({ perushId: 38 }),
		);
		errorSpy.mockRestore();
	});

	it("renders the empty state when the unit carries no perushim", () => {
		renderSection({ perushim: null });
		expect(screen.getByText("אין פרשנות לפרשה זו")).toBeInTheDocument();
	});
});

describe("unit-perush url helpers", () => {
	it("names a separate param per scope", () => {
		expect(perushParamName("torah")).toBe("perush");
		expect(perushParamName("haftara")).toBe("haftaraPerush");
	});

	it("accepts a ?-prefixed search string", () => {
		const href = unitPerushHref("/מסורה/8", "torah", 'רש"י', "?book=");
		expect(decodeURIComponent(href)).toBe('/מסורה/8?book=&perush=רש"י');
	});

	it("drops only the scope's param and the query when emptied", () => {
		expect(
			decodeURIComponent(
				unitPathWithoutPerush("/פרשה/1", "haftara", "perush=a&haftaraPerush=b"),
			),
		).toBe("/פרשה/1?perush=a");
		expect(unitPathWithoutPerush("/פרשה/1", "torah", "perush=a")).toBe(
			"/פרשה/1",
		);
	});

	it("accepts a ?-prefixed search string when dropping the param", () => {
		expect(
			unitPathWithoutPerush("/פרשה/1", "torah", "?perush=a&book=1"),
		).toBe("/פרשה/1?book=1");
		expect(unitPathWithoutPerush("/מסורה/8", "haftara", "?haftaraPerush=a")).toBe(
			"/מסורה/8",
		);
	});

	it("treats an omitted search string as empty", () => {
		expect(decodeURIComponent(unitPerushHref("/מסורה/8", "torah", 'רש"י'))).toBe(
			'/מסורה/8?perush=רש"י',
		);
		expect(unitPathWithoutPerush("/פרשה/1", "haftara")).toBe("/פרשה/1");
	});
});
