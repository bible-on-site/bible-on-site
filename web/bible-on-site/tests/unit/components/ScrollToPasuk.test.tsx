/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToPasuk } from "@/app/929/[number]/components/ScrollToPasuk";

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

describe("ScrollToPasuk", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		document.body.innerHTML = "";
		window.history.replaceState(null, "", "/");
	});

	it("highlights and scrolls to a single pasuk", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "pasuk-23";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);
		window.history.replaceState(null, "", "/929/32?pasuk=כג");

		render(<ScrollToPasuk maxVerse={30} />);
		jest.advanceTimersByTime(120);

		expect(div.className).toContain("pasukHighlight");
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "center",
		});
	});

	it("highlights every pasuk in a range and scrolls to the first one", () => {
		const firstScroll = jest.fn();
		const secondScroll = jest.fn();
		const first = document.createElement("div");
		first.id = "pasuk-6";
		first.scrollIntoView = firstScroll;
		const second = document.createElement("div");
		second.id = "pasuk-7";
		second.scrollIntoView = secondScroll;
		const third = document.createElement("div");
		third.id = "pasuk-8";
		document.body.append(first, second, third);
		window.history.replaceState(null, "", "/929/32?pasuk=ו-ח");

		render(<ScrollToPasuk maxVerse={30} />);
		jest.advanceTimersByTime(120);

		expect(first.className).toContain("pasukHighlight");
		expect(second.className).toContain("pasukHighlight");
		expect(third.className).toContain("pasukHighlight");
		expect(firstScroll).toHaveBeenCalledWith({
			behavior: "instant",
			block: "center",
		});
		expect(secondScroll).not.toHaveBeenCalled();
	});

	it("does nothing when pasuk query param is missing", () => {
		render(<ScrollToPasuk maxVerse={30} />);
		jest.advanceTimersByTime(120);

		expect(jest.getTimerCount()).toBe(0);
	});

	it("does nothing when the pasuk slug is out of range", () => {
		window.history.replaceState(null, "", "/929/32?pasuk=לב");

		render(<ScrollToPasuk maxVerse={5} />);
		jest.advanceTimersByTime(120);

		expect(jest.getTimerCount()).toBe(0);
	});

	it("does nothing when the target element does not exist", () => {
		window.history.replaceState(null, "", "/929/32?pasuk=כג");

		render(<ScrollToPasuk maxVerse={30} />);
		jest.advanceTimersByTime(120);

		expect(document.getElementById("pasuk-23")).toBeNull();
	});

	it("clears stale highlights when the query changes", () => {
		const first = document.createElement("div");
		first.id = "pasuk-6";
		first.scrollIntoView = jest.fn();
		const second = document.createElement("div");
		second.id = "pasuk-7";
		second.scrollIntoView = jest.fn();
		document.body.append(first, second);
		window.history.replaceState(null, "", "/929/32?pasuk=ו");

		const { rerender } = render(<ScrollToPasuk maxVerse={30} />);
		window.history.replaceState(null, "", "/929/32?pasuk=ז");
		rerender(<ScrollToPasuk maxVerse={30} />);

		expect(first.className).not.toContain("pasukHighlight");
		expect(second.className).toContain("pasukHighlight");
	});

	it("clears the timer and highlights on unmount", () => {
		const div = document.createElement("div");
		div.id = "pasuk-23";
		div.scrollIntoView = jest.fn();
		document.body.appendChild(div);
		window.history.replaceState(null, "", "/929/32?pasuk=כג");

		const { unmount } = render(<ScrollToPasuk maxVerse={30} />);
		unmount();
		jest.advanceTimersByTime(120);

		expect(div.className).not.toContain("pasukHighlight");
		expect(div.scrollIntoView).not.toHaveBeenCalled();
	});
});
