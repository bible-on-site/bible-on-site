/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToPerushPasukNote } from "@/app/929/[number]/[slug]/ScrollToPerushPasuk";

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

describe("ScrollToPerushPasukNote", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		document.body.innerHTML = "";
		window.history.replaceState(null, "", "/");
	});

	it("scrolls to the first perush note for the target pasuk", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "perush-pasuk-23";
		div.dataset.perushPasuk = "23";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);
		const second = document.createElement("div");
		second.dataset.perushPasuk = "23";
		document.body.appendChild(second);
		window.history.replaceState(null, "", '/929/32/רש"י?pasuk=23');

		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		expect(div.className).toContain("noteHighlight");
		expect(second.className).toContain("noteHighlight");
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "center",
		});
	});

	it("does nothing when pasuk is null", () => {
		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		expect(jest.getTimerCount()).toBe(0);
	});

	it("does nothing when pasuk is less than one", () => {
		window.history.replaceState(null, "", '/929/32/רש"י?pasuk=0');
		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		expect(document.getElementById("perush-pasuk-0")).toBeNull();
	});

	it("does nothing when target element does not exist", () => {
		window.history.replaceState(null, "", '/929/32/רש"י?pasuk=23');
		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		expect(document.getElementById("perush-pasuk-23")).toBeNull();
	});

	it("moves the highlight when navigation changes the selected pasuk", () => {
		const notes = [3, 23].map((pasuk) => {
			const note = document.createElement("div");
			note.id = `perush-pasuk-${pasuk}`;
			note.dataset.perushPasuk = String(pasuk);
			note.scrollIntoView = jest.fn();
			document.body.appendChild(note);
			return note;
		});
		window.history.replaceState(null, "", "/929/32/perush?pasuk=23");
		const { rerender, unmount } = render(<ScrollToPerushPasukNote />);
		window.history.pushState(null, "", "/929/32/perush?pasuk=3");
		rerender(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);
		expect(notes[1]).not.toHaveClass("noteHighlight");
		expect(notes[1].scrollIntoView).not.toHaveBeenCalled();
		expect(notes[0]).toHaveClass("noteHighlight");
		expect(notes[0].scrollIntoView).toHaveBeenCalled();
		unmount();
		expect(notes[0]).not.toHaveClass("noteHighlight");
	});

	it("rejects a partially numeric pasuk", () => {
		window.history.replaceState(null, "", "/929/32/perush?pasuk=23abc");
		render(<ScrollToPerushPasukNote />);
		expect(jest.getTimerCount()).toBe(0);
	});
});
