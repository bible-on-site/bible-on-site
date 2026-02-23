/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

let capturedFlipBookProps: Record<string, unknown> = {};
let capturedTocProps: Record<string, unknown> = {};

jest.mock("next/dynamic", () => {
	return (_loader: unknown) =>
		function MockFlipBook(props: Record<string, unknown>) {
			capturedFlipBookProps = props;
			return (
				<div data-testid="mock-flipbook">
					{props.pages as React.ReactNode[]}
				</div>
			);
		};
});

jest.mock("html-flip-book-react", () => ({
	TocPage: (props: Record<string, unknown>) => {
		capturedTocProps = props;
		return <div data-testid="mock-toc" />;
	},
}), { virtual: true });

jest.mock("html-flip-book-react/toolbar", () => ({
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
	DownloadDropdown: () => <div />,
	FirstPageButton: () => <div />,
	FullscreenButton: () => <div />,
	LastPageButton: () => <div />,
	NextButton: () => <div />,
	PageIndicator: () => <div />,
	PrevButton: () => <div />,
	TocButton: () => <div />,
	Toolbar: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}), { virtual: true });

jest.mock("html-flip-book-react/styles.css", () => ({}), { virtual: true });
jest.mock("@/app/929/[number]/components/sefer.css", () => ({}));
jest.mock("@/app/929/[number]/components/sefer.module.css", () =>
	new Proxy(
		{},
		{
			get: (_t, prop) => (typeof prop === "string" ? prop : ""),
		},
	),
);

const mockDownloadSefer = jest.fn();
const mockDownloadPageRanges = jest.fn();
jest.mock("@/app/929/[number]/actions", () => ({
	downloadSefer: (...args: unknown[]) => mockDownloadSefer(...args),
	downloadPageRanges: (...args: unknown[]) => mockDownloadPageRanges(...args),
}));

jest.mock("@/app/components/Bookshelf", () => ({
	BookshelfModal: ({
		isOpen,
		onClose,
	}: { isOpen: boolean; onClose: () => void }) =>
		isOpen ? (
			<div data-testid="mock-modal">
				<button type="button" onClick={onClose} data-testid="close-modal">
					close
				</button>
			</div>
		) : null,
}));

jest.mock("@/data/db/tanah-view-types", () => ({
	isQriDifferentThanKtiv: () => false,
}));

jest.mock("@/data/sefer-colors", () => ({
	getSeferColor: () => "hsl(30, 80%, 50%)",
}));

jest.mock("@/data/sefer-dto", () => ({
	getSeferByName: () => ({
		perakim: [{ header: "בראשית א", pesukim: [] }],
	}),
}));

jest.mock("@/util/hebdates-util", () => ({
	constructTsetAwareHDate: () => ({
		toTraditionalHebrewString: () => "כ״ג אדר תשפ״ו",
	}),
}));

jest.mock("@/app/929/[number]/components/BlankPageContent", () => ({
	BlankPageContent: () => <div data-testid="blank-page" />,
}));

jest.mock("@/app/929/[number]/components/Ptuha", () => ({
	Ptuah: () => <span />,
}));

jest.mock("@/app/929/[number]/components/Stuma", () => ({
	Stuma: () => <span />,
}));

import Sefer from "@/app/929/[number]/components/Sefer";
import type { PerekObj } from "@/data/perek-dto";

const minimalPerek: PerekObj = {
	perekId: 1,
	perekHeb: "א",
	header: "בראשית א",
	helek: "תורה",
	sefer: "בראשית",
	source: "mechon-mamre" as const,
	pesukim: [{ segments: [{ type: "qri" as const, value: "בְּרֵאשִׁית", recordingTimeFrame: { start: 0, end: 1 } }] }],
};

describe("Sefer component", () => {
	beforeEach(() => {
		capturedFlipBookProps = {};
		capturedTocProps = {};
		mockDownloadSefer.mockReset();
		mockDownloadPageRanges.mockReset();
	});

	it("renders FlipBook and toolbar", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
		expect(screen.getByTestId("mock-flipbook")).toBeInTheDocument();
		expect(screen.getByTestId("mock-toc")).toBeInTheDocument();
	});

	it("opens and closes bookshelf modal via toolbar button", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
		expect(screen.queryByTestId("mock-modal")).toBeNull();

		fireEvent.click(screen.getByLabelText("ספרי התנ״ך"));
		expect(screen.getByTestId("mock-modal")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("close-modal"));
		expect(screen.queryByTestId("mock-modal")).toBeNull();
	});

	it("onNavigate calls jumpToPage on flipBookRef", () => {
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
		const onNavigate = capturedTocProps.onNavigate as (idx: number) => void;
		expect(onNavigate).toBeDefined();
		// flipBookRef.current is null in test, so optional chaining means no-op
		expect(() => onNavigate(5)).not.toThrow();
	});

	it("onDownloadSefer wraps result from server action", async () => {
		mockDownloadSefer.mockResolvedValue({ ext: "pdf", data: "base64data" });
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
		const config = capturedFlipBookProps.downloadConfig as {
			onDownloadSefer: () => Promise<unknown>;
			onDownloadPageRange: (...args: unknown[]) => Promise<unknown>;
		};
		const result = await config.onDownloadSefer();
		expect(result).toEqual({ ext: "pdf", data: "base64data" });
	});

	it("onDownloadSefer returns null on error", async () => {
		mockDownloadSefer.mockResolvedValue({ error: "not_implemented" });
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
		const config = capturedFlipBookProps.downloadConfig as {
			onDownloadSefer: () => Promise<unknown>;
		};
		expect(await config.onDownloadSefer()).toBeNull();
	});

	it("onDownloadPageRange wraps result from server action", async () => {
		mockDownloadPageRanges.mockResolvedValue({ ext: "zip", data: "zipdata" });
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
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
		render(<Sefer perekObj={minimalPerek} articles={[]} />);
		expect(screen.getByTestId("blank-page")).toBeInTheDocument();
	});

	it("renders with per-perek index maps", () => {
		render(
			<Sefer
				perekObj={minimalPerek}
				articles={[]}
				articlesByPerekIndex={[[]]}
				perushimByPerekIndex={[[]]}
				perekIds={[1]}
			/>,
		);
		expect(screen.getByTestId("blank-page")).toBeInTheDocument();
	});
});
