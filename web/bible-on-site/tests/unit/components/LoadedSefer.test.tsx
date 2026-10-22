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
		sefer: perekId < 51 ? "בראשית" : "שמות",
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
it.each([new Error("network"), new BookRequestError(503)])("retries a failed book load with visible feedback and a contextual diagnostic (%s)", async (failure) => {
	const diagnostic = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		mockLoad.mockRejectedValueOnce(failure).mockResolvedValueOnce(seferFixture(perek()));
		render(<LoadedSefer {...props()} />);
		expect(await screen.findByRole("alert")).toHaveTextContent("לא ניתן לטעון את הספר.");
		expect(diagnostic).toHaveBeenCalledTimes(1);
		expect(diagnostic).toHaveBeenCalledWith("Failed to load reader book", {
			file: expect.stringMatching(/^\/generated\/sefarim\/1\..+\.json$/),
			error: failure,
		});
		fireEvent.click(screen.getByRole("button", { name: "נסה שוב" }));
		expect(await screen.findByTestId("loaded-book")).toHaveTextContent("בראשית/1");
		expect(mockLoad).toHaveBeenCalledTimes(2);
	} finally {
		diagnostic.mockRestore();
	}
});
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

it("reports an unavailable chapter instead of leaving an endless loading indicator", () => {
	render(<LoadedSefer {...props(0)} />);
	expect(screen.getByRole("alert")).toHaveTextContent("לא ניתן לטעון את הספר.");
	expect(mockLoad).not.toHaveBeenCalled();
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
		await screen.findByRole("alert");
		expect(screen.getByRole("link", { name: "רענן את הדף" })).toHaveAttribute("href", "/929/1?book&bookPage=5");
		expect(screen.queryByRole("button", { name: "נסה שוב" })).not.toBeInTheDocument();
		expect(diagnostic).toHaveBeenCalledTimes(1);
	} finally {
		diagnostic.mockRestore();
		history.replaceState(null, "", previousUrl);
	}
});
