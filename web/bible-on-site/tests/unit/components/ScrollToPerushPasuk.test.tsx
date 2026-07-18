/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToPerushPasukNote } from "@/app/929/[number]/[slug]/ScrollToPerushPasuk";

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
});
