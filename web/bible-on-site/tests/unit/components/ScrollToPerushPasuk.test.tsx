/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToPerushPasukNote } from "@/app/929/[number]/[slug]/ScrollToPerushPasuk";

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

describe("ScrollToPerushPasukNote", () => {
	let scrollSpy: jest.Mock;

	beforeEach(() => {
		jest.useFakeTimers();
		// jsdom lacks scrollIntoView; marks are created inside the effect, so
		// spy at the prototype level.
		scrollSpy = jest.fn();
		Object.defineProperty(Element.prototype, "scrollIntoView", {
			value: scrollSpy,
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		jest.useRealTimers();
		document.body.innerHTML = "";
		window.history.replaceState(null, "", "/");
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
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

	it("targets the exact note_idx fragment, not the pasuk's first note", () => {
		const first = document.createElement("div");
		first.id = "perush-pasuk-2";
		first.dataset.perushPasuk = "2";
		first.dataset.perushNote = "0";
		first.scrollIntoView = jest.fn();
		const second = document.createElement("div");
		second.dataset.perushPasuk = "2";
		second.dataset.perushNote = "1";
		second.scrollIntoView = jest.fn();
		document.body.append(first, second);
		window.history.replaceState(
			null,
			"",
			'/929/32/רש"י?pasuk=2&note=1&q=מונח',
		);

		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		// Only the hit fragment is highlighted and scrolled to (#2078).
		expect(second.className).toContain("noteHighlight");
		expect(first.className).not.toContain("noteHighlight");
		expect(second.scrollIntoView).toHaveBeenCalled();
		expect(first.scrollIntoView).not.toHaveBeenCalled();
	});

	it("falls back to the pasuk anchor when the note_idx is absent", () => {
		const anchor = document.createElement("div");
		anchor.id = "perush-pasuk-2";
		anchor.dataset.perushPasuk = "2";
		anchor.dataset.perushNote = "0";
		anchor.scrollIntoView = jest.fn();
		document.body.appendChild(anchor);
		window.history.replaceState(
			null,
			"",
			'/929/32/רש"י?pasuk=2&note=9',
		);

		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		expect(anchor.className).toContain("noteHighlight");
		expect(anchor.scrollIntoView).toHaveBeenCalled();
	});

	it("marks the in-content match inside the hit note and scrolls to it", () => {
		const note = document.createElement("div");
		note.id = "perush-pasuk-4";
		note.dataset.perushPasuk = "4";
		note.dataset.perushNote = "0";
		note.innerHTML = "<div>טקסט על בְּרֵאשִׁית ועוד</div>";
		document.body.appendChild(note);
		window.history.replaceState(
			null,
			"",
			'/929/32/רש"י?pasuk=4&note=0&q=בראשית',
		);

		render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);

		const mark = note.querySelector("mark.searchMatch") as HTMLElement | null;
		expect(mark).not.toBeNull();
		expect(mark?.textContent).toBe("בְּרֵאשִׁית");
		// The match mark scrolls, not the note element.
		expect(scrollSpy).toHaveBeenCalledTimes(1);
		expect(scrollSpy.mock.contexts[0]).toBe(mark);
	});

	it("unwraps the marks on unmount", () => {
		const note = document.createElement("div");
		note.id = "perush-pasuk-4";
		note.dataset.perushPasuk = "4";
		note.innerHTML = "<div>טקסט על בראשית</div>";
		document.body.appendChild(note);
		window.history.replaceState(
			null,
			"",
			'/929/32/רש"י?pasuk=4&q=בראשית',
		);

		const { unmount } = render(<ScrollToPerushPasukNote />);
		jest.advanceTimersByTime(120);
		expect(note.querySelector("mark.searchMatch")).not.toBeNull();

		unmount();
		expect(note.querySelector("mark")).toBeNull();
		expect(note.textContent).toContain("טקסט על בראשית");
	});
});
