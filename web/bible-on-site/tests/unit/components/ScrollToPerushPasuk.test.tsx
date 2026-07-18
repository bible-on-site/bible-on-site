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
	});

	it("scrolls to the first perush note for the target pasuk", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "perush-pasuk-23";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);

		render(<ScrollToPerushPasukNote pasuk={23} />);
		jest.advanceTimersByTime(120);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "center",
		});
	});

	it("does nothing when pasuk is null", () => {
		render(<ScrollToPerushPasukNote pasuk={null} />);
		jest.advanceTimersByTime(120);

		expect(jest.getTimerCount()).toBe(0);
	});

	it("does nothing when pasuk is less than one", () => {
		render(<ScrollToPerushPasukNote pasuk={0} />);
		jest.advanceTimersByTime(120);

		expect(document.getElementById("perush-pasuk-0")).toBeNull();
	});

	it("does nothing when target element does not exist", () => {
		render(<ScrollToPerushPasukNote pasuk={23} />);
		jest.advanceTimersByTime(120);

		expect(document.getElementById("perush-pasuk-23")).toBeNull();
	});
});
