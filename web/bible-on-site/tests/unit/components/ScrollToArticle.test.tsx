/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { ScrollToArticle } from "@/app/929/[number]/[slug]/ScrollToArticle";

describe("ScrollToArticle", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("scrolls to article-view element after delay", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "article-view";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);

		render(<ScrollToArticle />);
		jest.advanceTimersByTime(100);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "smooth",
			block: "start",
		});

		document.body.removeChild(div);
	});

	it("does nothing when article-view element does not exist", () => {
		// No element with id="article-view" in the DOM
		render(<ScrollToArticle />);
		jest.advanceTimersByTime(100);

		// No error thrown — the component gracefully handles missing element
		expect(document.getElementById("article-view")).toBeNull();
	});
});
