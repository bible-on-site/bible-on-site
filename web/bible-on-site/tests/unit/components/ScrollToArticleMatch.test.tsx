/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToArticleMatch } from "@/app/929/[number]/[slug]/ScrollToArticleMatch";

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

describe("ScrollToArticleMatch", () => {
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

	it("marks the in-content match and scrolls to it", () => {
		const body = document.createElement("div");
		body.className = "articleBody";
		body.innerHTML = "<p>מאמר ארוך על בְּרֵאשִׁית בָּרָא אֱלֹהִים ועוד</p>";
		document.body.appendChild(body);
		window.history.replaceState(null, "", "/929/1/42?q=בראשית");

		render(<ScrollToArticleMatch />);
		jest.advanceTimersByTime(120);

		const mark = body.querySelector("mark.searchMatch") as HTMLElement | null;
		expect(mark).not.toBeNull();
		expect(mark?.textContent).toBe("בְּרֵאשִׁית");
		expect(scrollSpy).toHaveBeenCalledTimes(1);
		expect(scrollSpy.mock.contexts[0]).toBe(mark);
	});

	it("does nothing without a q param", () => {
		const body = document.createElement("div");
		body.className = "articleBody";
		body.innerHTML = "<p>תוכן על בראשית</p>";
		document.body.appendChild(body);
		window.history.replaceState(null, "", "/929/1/42");

		render(<ScrollToArticleMatch />);
		jest.advanceTimersByTime(120);

		expect(body.querySelector("mark")).toBeNull();
	});

	it("does nothing when the phrase is not in the article", () => {
		const body = document.createElement("div");
		body.className = "articleBody";
		body.innerHTML = "<p>תוכן אחר לגמרי</p>";
		document.body.appendChild(body);
		window.history.replaceState(null, "", "/929/1/42?q=נדיר");

		render(<ScrollToArticleMatch />);
		jest.advanceTimersByTime(120);

		expect(body.querySelector("mark")).toBeNull();
	});

	it("unwraps the marks on unmount", () => {
		const body = document.createElement("div");
		body.className = "articleBody";
		body.innerHTML = "<p>תוכן על בראשית כאן</p>";
		document.body.appendChild(body);
		window.history.replaceState(null, "", "/929/1/42?q=בראשית");

		const { unmount } = render(<ScrollToArticleMatch />);
		jest.advanceTimersByTime(120);
		expect(body.querySelector("mark.searchMatch")).not.toBeNull();

		unmount();
		expect(body.querySelector("mark")).toBeNull();
		expect(body.textContent).toContain("תוכן על בראשית כאן");
	});
});
