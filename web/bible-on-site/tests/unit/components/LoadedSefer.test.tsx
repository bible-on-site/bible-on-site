/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PerekObj } from "@/data/perek-dto";
import { seferFixture } from "../../util/sefer-fixture";

jest.mock("@/data/load-sefer", () => ({
	...jest.requireActual("@/data/load-sefer"),
	loadSefer: jest.fn(),
}));
jest.mock("@/app/929/[number]/components/Sefer", () => ({
	__esModule: true,
	default: ({
		sefer,
		perekObj,
	}: {
		sefer: { name: string };
		perekObj: PerekObj;
	}) => (
		<div data-testid="loaded-book">
			{sefer.name}/{perekObj.perekId}
		</div>
	),
}));

import LoadedSefer from "@/app/929/[number]/components/LoadedSefer";
import { BookRequestError, loadSefer } from "@/data/load-sefer";

const mockLoad = jest.mocked(loadSefer);
function perek(perekId = 1): PerekObj {
	return {
		perekId,
		sefer: perekId < 51 ? "בראשית" : perekId < 91 ? "שמות" : "תהילים",
		helek: "תורה",
		perekHeb: "א",
		header: "",
		source: "mechon-mamre",
		pesukim: [],
	};
}
const props = (perekId = 1) => ({
	perekObj: perek(perekId),
	articles: [],
	perushim: [],
});
beforeEach(() => {
	mockLoad.mockReset();
	localStorage.clear();
});

it("shows loading feedback before displaying the selected book", async () => {
	let resolve!: (value: ReturnType<typeof seferFixture>) => void;
	mockLoad.mockReturnValue(
		new Promise((done) => {
			resolve = done;
		}),
	);
	render(<LoadedSefer {...props()} />);
	expect(screen.getByLabelText("טוען תצוגת ספר...")).toBeInTheDocument();
	await act(async () => {
		resolve(seferFixture(perek()));
	});
	expect(screen.getByTestId("loaded-book")).toHaveTextContent("בראשית/1");
});

it.each([new Error("network"), new BookRequestError(503)])(
	"surfaces a persistent failure with a contextual diagnostic, refresh and a flat-view escape (%s)",
	async (failure) => {
		const previousUrl = window.location.href;
		const diagnostic = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		try {
			history.replaceState(null, "", "/929/693/2215?book=");
			localStorage.setItem("perekViewMode", "book");
			mockLoad.mockRejectedValue(failure);
			render(<LoadedSefer {...props(693)} />);
			expect(await screen.findByRole("alert")).toHaveTextContent(
				"לא ניתן לטעון את הספר.",
			);
			expect(mockLoad).toHaveBeenCalledTimes(1);
			expect(diagnostic).toHaveBeenCalledWith("Failed to load reader book", {
				file: expect.stringMatching(/^\/generated\/sefarim\/568\..+\.json$/),
				error: failure,
			});
			// A manual retry stays available for a later transient, refresh picks
			// up a redeployed bundle, and the escape returns to the same flat article.
			expect(
				screen.getByRole("button", { name: "נסה שוב" }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("link", { name: "רענן את הדף" }),
			).toHaveAttribute("href", "/929/693/2215?book=");
			expect(
				screen.getByRole("link", { name: "חזרה לתצוגת הפרק" }),
			).toHaveAttribute("href", "/929/693/2215");
			// The escape also clears the stored book preference — otherwise the
			// flat page's composite would restore ?book and reopen the failure.
			fireEvent.click(screen.getByRole("link", { name: "חזרה לתצוגת הפרק" }));
			expect(localStorage.getItem("perekViewMode")).toBe("seo");
			// A manual retry issues exactly one new request per click.
			mockLoad.mockResolvedValueOnce(seferFixture(perek(693)));
			fireEvent.click(screen.getByRole("button", { name: "נסה שוב" }));
			expect(mockLoad).toHaveBeenCalledTimes(2);
			await act(async () => {});
			expect(screen.getByTestId("loaded-book")).toBeInTheDocument();
		} finally {
			diagnostic.mockRestore();
			history.replaceState(null, "", previousUrl);
		}
	},
);

it("does not replace a new book with an earlier request's late result", async () => {
	let first!: (value: ReturnType<typeof seferFixture>) => void;
	let second!: (value: ReturnType<typeof seferFixture>) => void;
	mockLoad
		.mockReturnValueOnce(
			new Promise((done) => {
				first = done;
			}),
		)
		.mockReturnValueOnce(
			new Promise((done) => {
				second = done;
			}),
		);
	const view = render(<LoadedSefer {...props()} />);
	view.rerender(<LoadedSefer {...props(51)} />);
	await act(async () => {
		second(seferFixture(perek(51)));
	});
	await act(async () => {
		first(seferFixture(perek()));
	});
	expect(screen.getByTestId("loaded-book")).toHaveTextContent("שמות/51");
});
it("keeps the selected book across chapter navigation without fetching again", async () => {
	mockLoad.mockResolvedValue(seferFixture(perek()));
	const view = render(<LoadedSefer {...props()} />);
	await screen.findByTestId("loaded-book");
	view.rerender(<LoadedSefer {...props(2)} />);
	expect(screen.getByTestId("loaded-book")).toHaveTextContent("בראשית/2");
	expect(mockLoad).toHaveBeenCalledTimes(1);
});

it("reports an unavailable chapter honestly with refresh and escape, not a dead retry (#3095)", () => {
	const previousUrl = window.location.href;
	const diagnostic = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		history.replaceState(null, "", "/929/693/2215?book=");
		render(<LoadedSefer {...props(0)} />);
		expect(screen.getByRole("alert")).toHaveTextContent("לא ניתן לטעון את הספר.");
		expect(mockLoad).not.toHaveBeenCalled();
		// No catalog mapping means there is nothing to re-fetch — the old
		// dead "נסה שוב" is replaced by reload and a flat-view escape.
		expect(
			screen.queryByRole("button", { name: "נסה שוב" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "רענן את הדף" }),
		).toHaveAttribute("href", "/929/693/2215?book=");
		expect(
			screen.getByRole("link", { name: "חזרה לתצוגת הפרק" }),
		).toHaveAttribute("href", "/929/693/2215");
		expect(diagnostic).toHaveBeenCalledWith("Reader book missing from catalog", {
			perekId: 0,
		});
	} finally {
		diagnostic.mockRestore();
		history.replaceState(null, "", previousUrl);
	}
});

it("does not replace a newer book with an earlier request's late failure", async () => {
	let reject!: (error: Error) => void;
	mockLoad.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }))
		.mockResolvedValueOnce(seferFixture(perek(51)));
	const view = render(<LoadedSefer {...props()} />);
	view.rerender(<LoadedSefer {...props(51)} />);
	await screen.findByTestId("loaded-book");
	await act(async () => { reject(new Error("old request")); });
	expect(screen.getByTestId("loaded-book")).toHaveTextContent("שמות/51");
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("offers a full page refresh for a missing asset while preserving the reader route", async () => {
	const previousUrl = window.location.href;
	const diagnostic = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		history.replaceState(null, "", "/929/1?book&bookPage=5#pasuk-1");
		mockLoad.mockRejectedValueOnce(new BookRequestError(404));
		render(<LoadedSefer {...props()} />);
		// A missing asset cannot self-heal on a client retry — only a fresh
		// page load can pick up a consistent bundle/deployment pair.
		expect(await screen.findByRole("alert")).toBeInTheDocument();
		expect(mockLoad).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("link", { name: "רענן את הדף" })).toHaveAttribute("href", "/929/1?book&bookPage=5");
		expect(screen.queryByRole("button", { name: "נסה שוב" })).not.toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "חזרה לתצוגת הפרק" }),
		).toHaveAttribute("href", "/929/1");
		expect(diagnostic).toHaveBeenCalledTimes(1);
	} finally {
		diagnostic.mockRestore();
		history.replaceState(null, "", previousUrl);
	}
});

it("escapes a book-chrome URL to the plain perek page rather than re-entering the reader", async () => {
	const previousUrl = window.location.href;
	const diagnostic = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		history.replaceState(null, "", "/929/בראשית/תוכן?book");
		mockLoad.mockRejectedValueOnce(new BookRequestError(404));
		render(<LoadedSefer {...props()} />);
		await screen.findByRole("alert");
		expect(
			screen.getByRole("link", { name: "חזרה לתצוגת הפרק" }),
		).toHaveAttribute("href", "/929/1");
	} finally {
		diagnostic.mockRestore();
		history.replaceState(null, "", previousUrl);
	}
});
