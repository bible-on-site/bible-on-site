/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { BookmarkProvider } from "html-flip-book-react";
import { renderPasukWithEntityRefs } from "@/app/929/[number]/components/pasuk-renderer";
import { sampleImage } from "./perek-image-fixture";

jest.mock("@/app/929/[number]/components/pasuk-renderer", () => {
	const actual = jest.requireActual(
		"@/app/929/[number]/components/pasuk-renderer",
	);
	return {
		...actual,
		renderPasukWithEntityRefs: jest.fn(actual.renderPasukWithEntityRefs),
	};
});
let capturedFlipBookProps: Record<string, unknown> = {};
let capturedTocProps: Record<string, unknown> = {};
var mockVisiblePageIndices: number[] | undefined;
var mockPathname = "/929/1";
jest.mock("next/navigation", () => ({
	usePathname: () => mockPathname,
}));
const mockRestorePage = jest.fn();
const mockJumpToPage = jest.fn();
const mockGetCurrentPageIndex = jest.fn().mockReturnValue(3);

jest.mock("next/dynamic", () => {
	const { forwardRef, useImperativeHandle } =
		require("react") as typeof import("react");
	return (_loader: unknown) =>
		forwardRef(function MockFlipBook(props: Record<string, unknown>, ref) {
			capturedFlipBookProps = props;
			useImperativeHandle(ref, () => ({
				getCurrentPageIndex: mockGetCurrentPageIndex,
				restorePage: mockRestorePage,
				jumpToPage: mockJumpToPage,
			}));
			return (
				<div data-testid="mock-flipbook">
					{(props.pages as React.ReactNode[]).filter(
						(_page, index) => mockVisiblePageIndices?.includes(index) ?? true,
					)}
				</div>
			);
		});
});

jest.mock(
	"html-flip-book-react",
	() => ({
		TocPage: (props: Record<string, unknown>) => {
			capturedTocProps = props;
			return <div data-testid="mock-toc" />;
		},
	}),
	{ virtual: true },
);

jest.mock(
	"html-flip-book-react/toolbar",
	() => ({
		ActionButton: ({
			onClick,
			children,
			ariaLabel,
		}: {
			onClick: () => void;
			children: React.ReactNode;
			ariaLabel: string;
		}) => (
			<button type="button" onClick={onClick} aria-label={ariaLabel}>
				{children}
			</button>
		),
		BookshelfIcon: () => <span>shelf</span>,
		BookmarkToggleButton: ({
			enabled,
			onChange,
			ariaLabel,
		}: {
			enabled: boolean;
			onChange: (enabled: boolean) => void;
			ariaLabel?: string;
		}) => (
			<button
				type="button"
				onClick={() => onChange(!enabled)}
				aria-label={ariaLabel}
				aria-pressed={enabled}
			/>
		),
		DownloadDropdown: () => <div />,
		FirstPageButton: () => <div />,
		FullscreenButton: () => <div />,
		LastPageButton: () => <div />,
		MouseModeButton: () => (
			<button type="button" aria-label="בחירת טקסט עם העכבר" />
		),
		NextButton: () => <div />,
		PageIndicator: () => <div />,
		PrevButton: () => <div />,
		TocButton: () => <div />,
		Toolbar: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
	}),
	{ virtual: true },
);

jest.mock("html-flip-book-react/styles.css", () => ({}), { virtual: true });
jest.mock("@/app/929/[number]/components/sefer.css", () => ({}));
jest.mock(
	"@/app/929/[number]/components/sefer.module.css",
	() =>
		new Proxy(
			{},
			{
				get: (_t, prop) => (typeof prop === "string" ? prop : ""),
			},
		),
);

const mockDownloadSefer = jest.fn();
const mockDownloadPageRanges = jest.fn();
const mockGetPerekSummariesBatch = jest.fn().mockResolvedValue({});
jest.mock("@/app/929/[number]/actions", () => ({
	getPerekSummariesBatch: (...args: unknown[]) =>
		mockGetPerekSummariesBatch(...args),
	downloadSefer: (...args: unknown[]) => mockDownloadSefer(...args),
	downloadPageRanges: (...args: unknown[]) => mockDownloadPageRanges(...args),
}));

jest.mock("@/app/components/Bookshelf", () => ({
	BookshelfModal: ({
		isOpen,
		onClose,
	}: {
		isOpen: boolean;
		onClose: () => void;
	}) =>
		isOpen ? (
			<div data-testid="mock-modal">
				<button type="button" onClick={onClose} data-testid="close-modal">
					close
				</button>
			</div>
		) : null,
}));

jest.mock("@/data/db/tanah-view-types", () => ({
	isQriDifferentThanKtiv: (segment: { value: string }) =>
		segment.value === "בְּרֵאשִׁית",
}));

jest.mock("@/data/sefer-colors", () => ({
	getSeferColor: () => "hsl(30, 80%, 50%)",
}));

jest.mock("@/data/sefer-dto", () => ({
	getSeferByName: jest.fn().mockReturnValue({
		name: "בראשית",
		perakim: [
			{
				header: "בראשית א",
				pesukim: [
					{
						segments: [
							{
								type: "qri" as const,
								value: "בְּרֵאשִׁית",
								recordingTimeFrame: { start: 0, end: 1 },
							},
							{ type: "ktiv" as const, value: "בראשית" },
							{ type: "ptuha" as const },
							{ type: "stuma" as const },
							{
								type: "qri" as const,
								value: "הָאָ֖רֶץ",
								recordingTimeFrame: { start: 2, end: 3 },
							},
						],
					},
				],
			},
		],
	}),
	getPerekIdsForSefer: jest.fn().mockReturnValue([1]),
}));

jest.mock("@/util/hebdates-util", () => ({
	constructTsetAwareHDate: () => ({
		toTraditionalHebrewString: () => 'כ"ג אדר תשפ"ו',
	}),
}));

jest.mock("@/app/929/[number]/components/SeferPanel", () => ({
	SeferPanel: () => <div data-testid="blank-page" />,
}));

jest.mock("@/app/929/[number]/components/Ptuha", () => ({
	Ptuah: () => <span />,
}));

jest.mock("@/app/929/[number]/components/Stuma", () => ({
	Stuma: () => <span />,
}));

import type { ComponentProps } from "react";
import SeferContents from "@/app/929/[number]/components/Sefer";
import { setSeferOpenPerush } from "@/app/929/[number]/components/sefer-pasuk-navigation";
import type { QriSegment } from "@/data/db/tanah-view-types";
import type { PerekObj } from "@/data/perek-dto";
import { getSeferByName } from "@/data/sefer-dto";
import {
	DEFAULT_SEFER_BOOKMARK_SETTINGS,
	getSeferBookmarkSettings,
	saveSeferBookmarkSettings,
} from "@/lib/sefer-bookmark-settings";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";

function timeframe(from: string, to: string): QriSegment["recordingTimeFrame"] {
	return { from, to } as unknown as QriSegment["recordingTimeFrame"];
}

const minimalPerek: PerekObj = {
	perekId: 1,
	perekHeb: "א",
	header: "בראשית א",
	helek: "תורה",
	sefer: "בראשית",
	source: "mechon-mamre" as const,
	pesukim: [
		{
			segments: [
				{
					type: "qri" as const,
					value: "בְּרֵאשִׁית",
					recordingTimeFrame: timeframe("00:00:00", "00:00:01"),
					ktivOffset: 1,
				},
				{ type: "ktiv" as const, value: "בראשית", qriOffset: -1 },
				{ type: "ptuha" as const },
				{ type: "stuma" as const },
				{
					type: "qri" as const,
					value: "הָאָ֖רֶץ",
					recordingTimeFrame: timeframe("00:00:02", "00:00:03"),
				},
			],
		},
	],
};

// Keep existing view fixtures while book loading is tested independently.
const Sefer = (props: Omit<ComponentProps<typeof SeferContents>, "sefer">) => (
	<SeferContents {...props} sefer={getSeferByName(props.perekObj.sefer)} />
);

describe("Sefer component", () => {
	it("builds scripture only when its page enters the mounted book window", async () => {
		const summaries = Promise.resolve({});
		mockGetPerekSummariesBatch.mockReturnValueOnce(summaries);
		const original = getSeferByName(minimalPerek.sefer);
		const chapter =
			"perakim" in original
				? original.perakim[0]
				: original.additionals[0].perakim[0];
		const sefer = {
			...original,
			perakim: [
				chapter,
				{
					...chapter,
					pesukim: [
						{
							segments: [
								{
									type: "qri" as const,
									value: "בהמשך הספר",
									recordingTimeFrame: timeframe("00:00:00", "00:00:01"),
								},
							],
						},
					],
				},
			],
		};
		const props = {
			perekObj: minimalPerek,
			articles: [],
			perushim: [],
			perekIds: [1, 2],
			sefer,
		};
		mockVisiblePageIndices = [];
		jest.mocked(renderPasukWithEntityRefs).mockClear();
		const { rerender } = render(<SeferContents {...props} />);
		await act(async () => {
			await summaries;
		});
		expect(renderPasukWithEntityRefs).not.toHaveBeenCalled();
		mockVisiblePageIndices = [3];
		rerender(<SeferContents {...props} />);
		expect(renderPasukWithEntityRefs).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("בהמשך הספר")).not.toBeInTheDocument();
		mockVisiblePageIndices = [5];
		rerender(<SeferContents {...props} />);
		expect(renderPasukWithEntityRefs).toHaveBeenCalledTimes(2);
		expect(screen.getByText("בהמשך הספר")).toBeInTheDocument();
	});
	it("does not rebuild scripture when background summaries arrive", async () => {
		let finish!: (value: unknown) => void;
		mockGetPerekSummariesBatch.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1, 2]}
			/>,
		);
		const renders = jest.mocked(renderPasukWithEntityRefs).mock.calls.length;
		await act(async () => finish({ "2": { articles: [], perushim: [] } }));
		expect(renderPasukWithEntityRefs).toHaveBeenCalledTimes(renders);
	});
	it("updates commentary selection without rebuilding scripture", () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		const panel = () =>
			(
				capturedFlipBookProps.pages as React.ReactElement<{
					children: React.ReactElement<{
						initialSlug?: string;
						onNavigate: (slug?: string) => void;
					}>;
				}>[]
			)[4].props.children.props;
		const renders = jest.mocked(renderPasukWithEntityRefs).mock.calls.length;
		act(() => panel().onNavigate('רש"י'));
		expect(panel().initialSlug).toBe('רש"י');
		act(() => panel().onNavigate());
		expect(panel().initialSlug).toBeUndefined();
		expect(renderPasukWithEntityRefs).toHaveBeenCalledTimes(renders);
	});
	it("refreshes scripture when the book corpus changes", () => {
		const props = { perekObj: minimalPerek, articles: [], perushim: [] };
		const sefer = getSeferByName(minimalPerek.sefer);
		const { rerender } = render(<SeferContents {...props} sefer={sefer} />);
		const renders = jest.mocked(renderPasukWithEntityRefs).mock.calls.length;
		const chapter =
			"perakim" in sefer ? sefer.perakim[0] : sefer.additionals[0].perakim[0];
		const changed = {
			...sefer,
			perakim: [
				{
					...chapter,
					pesukim: [
						{
							segments: [
								{
									type: "qri" as const,
									value: "חדש",
									recordingTimeFrame: timeframe("00:00:00", "00:00:01"),
								},
							],
						},
					],
				},
			],
		};
		rerender(<SeferContents {...props} sefer={changed} />);
		expect(
			jest.mocked(renderPasukWithEntityRefs).mock.calls.length,
		).toBeGreaterThan(renders);
		expect(screen.getByText("חדש")).toBeInTheDocument();
	});

	beforeEach(() => {
		mockVisiblePageIndices = undefined;
		capturedFlipBookProps = {};
		capturedTocProps = {};
		mockDownloadSefer.mockReset();
		mockDownloadPageRanges.mockReset();
		mockRestorePage.mockReset();
		mockJumpToPage.mockReset();
		mockGetCurrentPageIndex.mockReset().mockReturnValue(3);
		document.title = "";
		mockPathname = "/929/1";
		delete document.documentElement.dataset.seferView;
	});

	it("opens content on the requested chapter and clears it after a page flip", async () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
				initialSlug="42"
			/>,
		);
		const blankProps = () => {
			const pages = capturedFlipBookProps.pages as React.ReactElement<{
				children: React.ReactElement<{
					initialSlug?: string;
					onNavigate: (slug?: string) => void;
				}>;
			}>[];
			return pages[4].props.children.props;
		};
		expect(blankProps().initialSlug).toBe("42");
		act(() => blankProps().onNavigate('רש"י'));
		expect(blankProps().initialSlug).toBe('רש"י');
		act(() => blankProps().onNavigate());
		expect(blankProps().initialSlug).toBeUndefined();
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		await act(async () => handlers.onPageFlipped());
		await act(async () => {
			handlers.onPageFlipped();
			history.replaceState(history.state, "", "/929/2?book");
		});
		expect(blankProps().initialSlug).toBeUndefined();
	});

	it("keeps entity links on the correct chapter when other chapters have no references", async () => {
		const reference: PerekEntityReference = {
			entityId: "creation",
			entityName: "בריאה",
			entityType: "OBJECT",
			entryUniqueName: "בריאה",
			pasukNumber: 1,
			segmentStart: 0,
			segmentEnd: 0,
		};
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1, 2, 3]}
				entityRefsByPerek={{ 1: [reference], 2: [] }}
			/>,
		);
		await act(async () => {});
		expect(screen.getByRole("link", { name: /בְּרֵאשִׁית/ })).toHaveAttribute(
			"href",
			expect.stringContaining("/pedia/"),
		);
	});

	it("logs a failed batch with the book and requested chapters", async () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		mockGetPerekSummariesBatch.mockRejectedValueOnce(
			new Error("summaries unavailable"),
		);
		try {
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1, 2]}
				/>,
			);
			await act(async () => {});
			expect(error).toHaveBeenCalledWith(
				"Failed to load book summaries",
				expect.objectContaining({ sefer: "בראשית", perekIds: [2] }),
			);
		} finally {
			error.mockRestore();
		}
	});

	it("locks outer document scrolling only while the reader is shown (issue #2178)", () => {
		const props = { perekObj: minimalPerek, articles: [], perushim: [] };
		const { rerender, unmount } = render(<Sefer {...props} />);
		expect(document.documentElement).toHaveAttribute("data-sefer-view");
		// The perek overlay keeps the reader mounted after the book closes; a
		// hidden reader must hand scrolling back to the flat page.
		rerender(<Sefer {...props} isVisible={false} />);
		expect(document.documentElement).not.toHaveAttribute("data-sefer-view");
		rerender(<Sefer {...props} isVisible={true} />);
		expect(document.documentElement).toHaveAttribute("data-sefer-view");
		unmount();
		expect(document.documentElement).not.toHaveAttribute("data-sefer-view");
	});

	it("synchronizes the document title with the committed book page", async () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		mockGetCurrentPageIndex.mockReturnValue(0);
		await act(async () => handlers.onPageFlipped());
		expect(document.title).toBe('ספר בראשית | תנ"ך על הפרק');
		mockGetCurrentPageIndex.mockReturnValue(3);
		await act(async () => handlers.onPageFlipped());
		expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
	});

	it("restores the flat page title while hidden and re-applies the book title on show", async () => {
		const props = {
			perekObj: minimalPerek,
			articles: [],
			perushim: [],
			perekIds: [1],
		};
		const { rerender } = render(<Sefer {...props} />);
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		await act(async () => handlers.onPageFlipped());
		expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
		rerender(<Sefer {...props} isVisible={false} />);
		expect(document.title).toBe('mechon-mamre | תנ"ך על הפרק');
		rerender(<Sefer {...props} isVisible={true} />);
		expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
	});

	it("restores the standalone article title when closing on an article route", async () => {
		mockPathname = "/929/1/42";
		const props = {
			perekObj: minimalPerek,
			articles: [
				{
					id: 42,
					perekId: 1,
					authorId: 7,
					abstract: null,
					name: "מאמר מבחן",
					priority: 1,
					authorName: "מחבר מבחן",
					authorImageUrl: "",
				},
			],
			perushim: [],
			perekIds: [1],
		};
		const { rerender } = render(<Sefer {...props} />);
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		await act(async () => handlers.onPageFlipped());
		expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
		rerender(<Sefer {...props} isVisible={false} />);
		expect(document.title).toBe('מאמר מבחן | מחבר מבחן | תנ"ך על הפרק');
	});

	it("restores the standalone perush title when closing on a perush route", async () => {
		mockPathname = `/929/1/${encodeURIComponent('רש"י')}`;
		const props = {
			perekObj: minimalPerek,
			articles: [],
			perushim: [{ id: 5, name: 'רש"י', parshanName: 'רש"י', noteCount: 3 }],
			perekIds: [1],
		};
		const { rerender } = render(<Sefer {...props} />);
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		await act(async () => handlers.onPageFlipped());
		expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
		rerender(<Sefer {...props} isVisible={false} />);
		expect(document.title).toBe('רש"י על בראשית א | תנ"ך על הפרק');
	});

	it("restores the flat page title on unmount without clobbering a newer title", async () => {
		const { unmount } = render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		const handlers = capturedFlipBookProps.handlers as {
			onPageFlipped: () => void;
		};
		await act(async () => handlers.onPageFlipped());
		expect(document.title).toBe('בראשית א | תנ"ך על הפרק');
		unmount();
		expect(document.title).toBe('mechon-mamre | תנ"ך על הפרק');

		const { unmount: unmountStale } = render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		await act(async () =>
			(
				capturedFlipBookProps.handlers as { onPageFlipped: () => void }
			).onPageFlipped(),
		);
		document.title = "other page title";
		unmountStale();
		expect(document.title).toBe("other page title");
	});

	it("renders FlipBook and toolbar", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
		expect(screen.getByTestId("mock-toc")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "בחירת טקסט עם העכבר" }),
		).toBeInTheDocument();
		expect(capturedFlipBookProps.mouseModeStorageKey).toBe(
			"sefer-mouse-book-mode",
		);
	});

	describe("chapter tabs (#2543)", () => {
		const provider = () =>
			capturedFlipBookProps.bookmarkProvider as BookmarkProvider;

		beforeEach(() => {
			localStorage.clear();
			saveSeferBookmarkSettings(DEFAULT_SEFER_BOOKMARK_SETTINGS);
		});

		it("enables native bookmarks with one canonical tab per perek", () => {
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1]}
				/>,
			);
			expect(capturedFlipBookProps.enableBookmarks).toBe(true);
			const p = provider();
			expect(p.placement).toBe("sides");
			expect(p.orientation).toBe("perpendicular");
			expect(p.attachment).toBe("leaf");
			expect(p.order).toBe("page");
			expect(p.className).toBe("sefer-bookmarks");
			expect(
				p.getBookmarks({
					currentPageIndex: 0,
					currentLeafIndex: 0,
					direction: "rtl",
				}),
			).toEqual([
				expect.objectContaining({
					id: "perek-1",
					pageIndex: 3,
					label: "בראשית א - בראשית א",
				}),
			]);
		});

		it.each([
			{ name: "בראשית", additional: undefined, chapter: "יב" },
			{ name: "מלכים", additional: "א", chapter: "א יב" },
			{ name: "מלכים", additional: "ב", chapter: "ב יב" },
		])(
			"keeps the expanded chapter reference scoped to $name $chapter",
			({ name, additional, chapter }) => {
				const perakim = Array.from({ length: 12 }, () => ({
					header: "כותרת הפרק",
					date: [],
					star_rise: [],
					pesukim: [],
				}));
				const metadata = {
					name,
					helek: name === "בראשית" ? "תורה" : "נביאים",
					tanachUsName: name,
					pesukimCount: 0,
					perekFrom: 1,
					perekTo: perakim.length,
				};
				const sefer: ComponentProps<typeof SeferContents>["sefer"] = additional
					? {
							...metadata,
							perekTo: perakim.length * 2,
							additionals: [
								{ ...metadata, letter: "א", perakim },
								{
									...metadata,
									letter: "ב",
									perakim,
									perekFrom: perakim.length + 1,
									perekTo: perakim.length * 2,
								},
							],
						}
					: { ...metadata, perakim };
				render(
					<SeferContents
						perekObj={{ ...minimalPerek, sefer: name }}
						sefer={sefer}
						articles={[]}
						perushim={[]}
					/>,
				);
				const p = provider();
				const bookmark = p.getBookmarks({
					currentPageIndex: 0,
					currentLeafIndex: 0,
					direction: "rtl",
				})[additional === "ב" ? 23 : 11];
				const { container } = render(p.renderExpandedBookmark?.(bookmark));
				expect(
					container.querySelector(".sefer-bookmark-expanded-perek"),
				).toHaveTextContent(`פרק ${chapter}`);
				expect(
					container.querySelector(".sefer-bookmark-expanded-title"),
				).toHaveTextContent("כותרת הפרק");
				expect(container).not.toHaveTextContent(name);
				expect(
					container.querySelector(".sefer-bookmark-expanded-source"),
				).toBeNull();
				expect(bookmark.label).toBe(`${name} ${chapter} - כותרת הפרק`);
			},
		);

		it("hides the tabs when סימניות is disabled", () => {
			saveSeferBookmarkSettings({ enabled: false });
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1]}
				/>,
			);
			expect(capturedFlipBookProps.enableBookmarks).toBe(false);
		});

		it("toggles the tabs from the toolbar through the shared persisted state", () => {
			saveSeferBookmarkSettings({ placement: "top", upcomingOnly: true });
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1]}
				/>,
			);
			const hide = screen.getByRole("button", { name: "הסתרת סימניות" });
			expect(hide).toHaveAttribute("aria-pressed", "true");
			expect(capturedFlipBookProps.enableBookmarks).toBe(true);

			fireEvent.click(hide);
			// One persisted state drives the preference, the toolbar control and
			// the library flag — and the display options survive the toggle.
			expect(getSeferBookmarkSettings()).toMatchObject({
				enabled: false,
				placement: "top",
				upcomingOnly: true,
			});
			expect(capturedFlipBookProps.enableBookmarks).toBe(false);

			// The control stays reachable while tabs are hidden so they can be
			// shown again, now announcing the show action.
			const show = screen.getByRole("button", { name: "הצגת סימניות" });
			expect(show).toHaveAttribute("aria-pressed", "false");
			fireEvent.click(show);
			expect(getSeferBookmarkSettings().enabled).toBe(true);
			expect(capturedFlipBookProps.enableBookmarks).toBe(true);
		});

		it("mirrors an external סימניות preference change in the toolbar control", () => {
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1]}
				/>,
			);
			expect(
				screen.getByRole("button", { name: "הסתרת סימניות" }),
			).toBeInTheDocument();
			act(() => saveSeferBookmarkSettings({ enabled: false }));
			expect(
				screen.getByRole("button", { name: "הצגת סימניות" }),
			).toHaveAttribute("aria-pressed", "false");
			expect(capturedFlipBookProps.enableBookmarks).toBe(false);
		});

		it("applies stored display preferences to the provider", () => {
			saveSeferBookmarkSettings({
				placement: "top",
				orientation: "parallel",
				attachment: "pinned",
				order: "title",
				upcomingOnly: true,
			});
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1]}
				/>,
			);
			const p = provider();
			expect(p.placement).toBe("top");
			expect(p.orientation).toBe("parallel");
			expect(p.attachment).toBe("pinned");
			expect(typeof p.order).toBe("function");
			// upcomingOnly filters out tabs before the current page; the perek
			// sits at page 3 so it is still listed from the book's front cover.
			expect(
				p.getBookmarks({
					currentPageIndex: 3,
					currentLeafIndex: 1,
					direction: "rtl",
				}),
			).toHaveLength(1);
		});
	});

	it("opens and closes bookshelf modal via toolbar button", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		expect(screen.queryByTestId("mock-modal")).toBeNull();

		fireEvent.click(screen.getByLabelText('ספרי התנ"ך'));
		expect(screen.getByTestId("mock-modal")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("close-modal"));
		expect(screen.queryByTestId("mock-modal")).toBeNull();
	});

	it("onNavigate calls jumpToPage on flipBookRef", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const onNavigate = capturedTocProps.onNavigate as (idx: number) => void;
		expect(onNavigate).toBeDefined();
		onNavigate(5);
		expect(mockJumpToPage).toHaveBeenCalledWith(5);
	});

	it("restores a router-selected cover in place without remounting", () => {
		const originalUrl = window.location.href;
		window.history.replaceState(null, "", "/929/בראשית/תוכן?book");
		mockGetCurrentPageIndex.mockReturnValue(1);
		try {
			const props = {
				perekObj: minimalPerek,
				articles: [],
				perushim: [],
				perekIds: [1],
			};
			const { rerender } = render(<Sefer {...props} initialBookPage="toc" />);
			expect(mockRestorePage).not.toHaveBeenCalled();
			window.history.replaceState(null, "", "/929/בראשית/כריכה?book");
			rerender(<Sefer {...props} initialBookPage="front" />);
			expect(mockRestorePage).toHaveBeenCalledWith(0);
		} finally {
			window.history.replaceState(null, "", originalUrl);
		}
	});

	it("keeps the flipped chapter when unchanged router data gets fresh references", async () => {
		const perek = { ...minimalPerek, perekId: 2 };
		mockGetCurrentPageIndex.mockReturnValue(5);
		const { rerender } = render(
			<Sefer perekObj={perek} articles={[]} perushim={[]} perekIds={[1, 2]} />,
		);
		await act(async () => {});
		mockRestorePage.mockClear();
		// The user has turned back to chapter 1 while a same-route router refresh finishes.
		mockGetCurrentPageIndex.mockReturnValue(3);
		await act(async () =>
			rerender(
				<Sefer
					perekObj={{ ...perek }}
					articles={[]}
					perushim={[]}
					perekIds={[1, 2]}
				/>,
			),
		);
		expect(mockRestorePage).not.toHaveBeenCalled();
		// A genuinely different router destination must still restore its chapter.
		mockGetCurrentPageIndex.mockReturnValue(5);
		await act(async () =>
			rerender(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={[1, 2]}
				/>,
			),
		);
		expect(mockRestorePage).toHaveBeenCalledWith(3);
	});

	it.each(["42", 'רש"י'])(
		"opens content %s in a book with parts without undoing the page turn",
		async (slug) => {
			const { getSeferByName } = jest.requireMock("@/data/sefer-dto") as {
				getSeferByName: jest.Mock;
			};
			const originalSefer = getSeferByName();
			getSeferByName.mockReturnValue({
				additionals: [
					{ perakim: originalSefer.perakim },
					{ perakim: originalSefer.perakim },
				],
			});
			try {
				mockGetCurrentPageIndex.mockReturnValue(5);
				const { unmount } = render(
					<Sefer
						perekObj={{ ...minimalPerek, perekId: 2 }}
						articles={[]}
						perushim={[]}
						perekIds={[1, 2]}
					/>,
				);
				await act(async () => {});
				mockRestorePage.mockClear();
				mockGetCurrentPageIndex.mockReturnValue(3);
				const handlers = capturedFlipBookProps.handlers as {
					onPageFlipped: () => void;
				};
				await act(async () => {
					handlers.onPageFlipped();
					history.replaceState(history.state, "", "/929/1?book");
				});
				const blankProps = () => {
					const pages = capturedFlipBookProps.pages as React.ReactElement<{
						children: React.ReactElement<{
							initialSlug?: string;
							onNavigate: (slug?: string) => void;
						}>;
					}>[];
					return pages[4].props.children.props;
				};
				act(() => blankProps().onNavigate(slug));
				expect(blankProps().initialSlug).toBe(slug);
				expect(mockRestorePage).not.toHaveBeenCalled();
				expect(decodeURIComponent(location.pathname)).toBe(`/929/1/${slug}`);
				act(() => blankProps().onNavigate());
				expect(blankProps().initialSlug).toBeUndefined();
				expect(mockRestorePage).not.toHaveBeenCalled();
				unmount();
			} finally {
				getSeferByName.mockReturnValue(originalSefer);
			}
		},
	);

	it("TocPage filter excludes cover pages and empty titles", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const filter = capturedTocProps.filter as (entry: {
			pageIndex: number;
			title: string;
		}) => boolean;
		expect(filter).toBeDefined();
		expect(filter({ pageIndex: 0, title: "cover" })).toBe(false);
		expect(filter({ pageIndex: 5, title: "" })).toBe(false);
		expect(filter({ pageIndex: 5, title: "פרק א" })).toBe(true);
	});

	it("gives TOC entries the same chapter routes used by book history", () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		const getHref = capturedTocProps.getHref as (entry: {
			pageIndex: number;
			semanticName: string;
			title: string;
		}) => string | null;
		expect(getHref({ pageIndex: 0, semanticName: "", title: "" })).toBe(
			"/929/בראשית/כריכה?book",
		);
		expect(
			getHref({ pageIndex: 3, semanticName: "א", title: "בראשית א" }),
		).toBe("/929/1?book");
	});

	it("opens a direct TOC route at the contents page", () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
				initialBookPage="toc"
			/>,
		);
		expect(capturedFlipBookProps.initialTurnedLeaves).toEqual([0]);
	});

	it("opens cover routes at the first and last leaf", () => {
		const { rerender } = render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
				initialBookPage="front"
			/>,
		);
		expect(capturedFlipBookProps.initialTurnedLeaves).toEqual([]);
		rerender(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
				initialBookPage="back"
			/>,
		);
		expect(capturedFlipBookProps.initialTurnedLeaves).toEqual([0, 1, 2]);
	});

	it("onDownloadSefer wraps result from server action", async () => {
		mockDownloadSefer.mockResolvedValue({ ext: "pdf", data: "base64data" });
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const config = capturedFlipBookProps.downloadConfig as {
			onDownloadSefer: () => Promise<unknown>;
			onDownloadPageRange: (...args: unknown[]) => Promise<unknown>;
		};
		const result = await config.onDownloadSefer();
		expect(result).toEqual({ ext: "pdf", data: "base64data" });
	});

	it("onDownloadSefer resolves to null when the export is unavailable, and renders no app-side alert", async () => {
		mockDownloadSefer.mockResolvedValue({ error: "not_implemented" });
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const config = capturedFlipBookProps.downloadConfig as {
			onDownloadSefer: () => Promise<unknown>;
		};
		await act(async () => {
			expect(await config.onDownloadSefer()).toBeNull();
		});
		// Errors surface inside the library's menu (role=alert on its own
		// element); the app no longer renders a duplicate alert of its own.
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it.each([undefined, [], [1, 2]])(
		"downloads the available chapters with IDs %s",
		async (perekIds) => {
			mockDownloadSefer.mockResolvedValue({ ext: "pdf", data: "chapters" });
			render(
				<Sefer
					perekObj={minimalPerek}
					articles={[]}
					perushim={[]}
					perekIds={perekIds}
				/>,
			);
			await act(async () => {});
			const config = capturedFlipBookProps.downloadConfig as {
				onDownloadSefer: () => Promise<unknown>;
			};
			await act(async () => {
				expect(await config.onDownloadSefer()).toEqual({
					ext: "pdf",
					data: "chapters",
				});
			});
			expect(mockDownloadSefer).toHaveBeenCalledWith({
				seferName: minimalPerek.sefer,
				perekIds: perekIds?.length ? perekIds : [minimalPerek.perekId],
				divineNameMasking: expect.objectContaining({ enabled: true }),
			});
		},
	);

	it("rejects a failed range export so the menu can show its error and retry", async () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const config = () =>
			capturedFlipBookProps.downloadConfig as {
				onDownloadPageRange: (...args: unknown[]) => Promise<unknown>;
				onDownloadError: (error: unknown) => unknown;
			};
		mockDownloadPageRanges.mockResolvedValueOnce({
			error: "service_unavailable",
			message: "לא ניתן היה לטעון את האיור של בראשית ב",
		});
		let failure: unknown;
		await act(async () => {
			failure = await config()
				.onDownloadPageRange([3], [], { seferName: "בראשית" })
				.then(
					() => null,
					(e) => e,
				);
		});
		// The rejection carries the action's safe message; the library shows it
		// through onDownloadError inside the open menu with a retry path.
		expect(failure).toBeInstanceOf(Error);
		expect(config().onDownloadError(failure)).toBe(
			"לא ניתן היה לטעון את האיור של בראשית ב",
		);
		expect(config().onDownloadError(new Error("internal"))).toBe(
			"יצירת קובץ ה-PDF נכשלה. נסו להוריד שוב בעוד רגע.",
		);

		localStorage.setItem(
			"divineNameMasking",
			JSON.stringify({ enabled: true, yhwh: "dalet" }),
		);
		mockDownloadPageRanges.mockResolvedValueOnce({ ext: "pdf", data: "ok" });
		await act(async () => {
			expect(
				await config().onDownloadPageRange([3], [], { seferName: "בראשית" }),
			).toEqual({
				ext: "pdf",
				data: "ok",
			});
		});
		expect(mockDownloadPageRanges).toHaveBeenLastCalledWith([3], [], {
			seferName: "בראשית",
			divineNameMasking: expect.objectContaining({
				enabled: true,
				yhwh: "dalet",
			}),
		});
		localStorage.clear();
	});

	it("onDownloadPageRange wraps result from server action", async () => {
		mockDownloadPageRanges.mockResolvedValue({ ext: "zip", data: "zipdata" });
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		const config = capturedFlipBookProps.downloadConfig as {
			onDownloadPageRange: (...args: unknown[]) => Promise<unknown>;
		};
		const result = await config.onDownloadPageRange(
			[3, 4],
			[{ index: 3, name: "א" }],
			undefined,
		);
		expect(result).toEqual({ ext: "zip", data: "zipdata" });
	});

	it("renders without optional per-perek props (covers ?? fallbacks)", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		expect(screen.getByTestId("blank-page")).toBeInTheDocument();
	});

	it("does not attach chapter illustrations without the chapter-to-page ID mapping", () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				imagesByPerek={{ 1: [sampleImage] }}
			/>,
		);
		expect(screen.queryByRole("img", { name: sampleImage.alt })).toBeNull();
		expect(screen.getByTestId("mock-flipbook")).toBeVisible();
	});

	it("renders with perekIds and passes SSG data for current perek only", async () => {
		const secondImage = {
			...sampleImage,
			id: 18,
			alt: "איור שני",
			avifSrcSet: "",
			credit: "מאייר",
		};
		const { container } = render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
				imagesByPerek={{ 1: [sampleImage, secondImage] }}
			/>,
		);
		await act(async () => {});
		expect(screen.getByTestId("blank-page")).toBeInTheDocument();
		const source = container.querySelector('picture source[type="image/avif"]');
		expect(source).toHaveAttribute(
			"srcset",
			expect.stringContaining("sample-640.avif 640w"),
		);
		expect(screen.getByRole("img", { name: sampleImage.alt })).toHaveAttribute(
			"loading",
			"lazy",
		);
		expect(screen.getByText(sampleImage.caption)).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "איור שני" })).toBeInTheDocument();
		expect(container.querySelectorAll("picture source")).toHaveLength(1);
		expect(screen.getByText(/מאייר/)).toBeInTheDocument();
	});

	it("marks perek pages and pesukim for pasuk navigation", () => {
		const { container } = render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		expect(
			container.querySelector('[data-sefer-perek="1"] [data-sefer-pasuk="1"]'),
		).not.toBeNull();
	});

	it("navigates a pasuk number click to the open perush group", async () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				perushim={[]}
				perekIds={[1]}
			/>,
		);
		// Without an open perush the pasuk number keeps recitation behaviour only.
		expect(
			screen.queryByRole("button", { name: "מעבר לפירוש על פסוק א" }),
		).toBeNull();
		// The blank page mounts the panel while a perush is open.
		document.body.insertAdjacentHTML(
			"beforeend",
			`<div data-sefer-perush-perek="1" data-sefer-perush='רש"י'>
				<div data-perush-pasuk="1"><p>note</p></div>
			</div>
			<div data-sefer-perush-perek="2">
				<div data-perush-pasuk="1"><p>other perek note</p></div>
			</div>`,
		);
		const scrollIntoView = jest.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		try {
			act(() => setSeferOpenPerush(1, { name: 'רש"י', pesukim: new Set([1]) }));
			const group = document.querySelector(
				'[data-sefer-perush-perek="1"] [data-perush-pasuk="1"]',
			) as Element;
			fireEvent.click(
				screen.getByRole("button", { name: "מעבר לפירוש על פסוק א" }),
			);
			expect(scrollIntoView.mock.contexts[0]).toBe(group);
			expect(group).toHaveAttribute("data-pasuk-highlight", "");
			expect(group).toHaveAttribute("aria-current", "location");
			// Identical pasuk number in another perek's perush is not a target.
			expect(
				document.querySelector(
					'[data-sefer-perush-perek="2"] [data-perush-pasuk="1"]',
				),
			).not.toHaveAttribute("data-pasuk-highlight");
			// A perush that does not annotate this pasuk leaves it without
			// commentary navigation (recitation behaviour is kept).
			act(() =>
				setSeferOpenPerush(1, { name: "אבן עזרא", pesukim: new Set([2]) }),
			);
			expect(
				screen.queryByRole("button", { name: "מעבר לפירוש על פסוק א" }),
			).toBeNull();
			// Closing the perush restores the non-navigating pasuk number.
			act(() => setSeferOpenPerush(1, null));
			await act(async () => {});
			expect(
				screen.queryByRole("button", { name: "מעבר לפירוש על פסוק א" }),
			).toBeNull();
		} finally {
			act(() => setSeferOpenPerush(1, null));
			for (const el of document.querySelectorAll("[data-sefer-perush-perek]")) {
				el.remove();
			}
		}
	});

	it("renders maqaf-ending segments without trailing space", () => {
		const perekWithMaqaf: PerekObj = {
			...minimalPerek,
			pesukim: [
				{
					segments: [
						{
							type: "qri" as const,
							value: "מִן־",
							recordingTimeFrame: timeframe("00:00:00", "00:00:01"),
						},
						{
							type: "qri" as const,
							value: "הָאָ֖רֶץ",
							recordingTimeFrame: timeframe("00:00:01", "00:00:02"),
						},
					],
				},
			],
		};
		render(<Sefer perekObj={perekWithMaqaf} articles={[]} perushim={[]} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
	});

	it("renders sefer with additionals (uses flatMap branch)", () => {
		const { getSeferByName } = jest.requireMock("@/data/sefer-dto") as {
			getSeferByName: jest.Mock;
		};
		getSeferByName.mockReturnValueOnce({
			additionals: [
				{
					perakim: [
						{
							header: "שמואל א א",
							pesukim: [
								{
									segments: [
										{
											type: "qri" as const,
											value: "word",
											recordingTimeFrame: { start: 0, end: 1 },
										},
									],
								},
							],
						},
					],
				},
			],
		});

		render(<Sefer perekObj={minimalPerek} articles={[]} perushim={[]} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
	});
});
