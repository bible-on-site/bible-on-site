/**
 * Tests for ScrollToSlug / ScrollToArticle scroll-on-mount helpers.
 */

import { act, render } from "@testing-library/react";
import {
	ScrollToArticle,
	ScrollToSlug,
} from "../../../src/app/929/[number]/[slug]/ScrollToArticle";

describe("ScrollToSlug", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		document.body.innerHTML = "";
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	function stubTarget(id = "article-view") {
		const scrollIntoView = jest.fn();
		const el = document.createElement("div");
		el.id = id;
		document.body.appendChild(el);
		el.scrollIntoView = scrollIntoView;
		return scrollIntoView;
	}

	it("scrolls the target element into view after mount", () => {
		const scrollIntoView = stubTarget();

		render(<ScrollToSlug />);
		act(() => {
			jest.advanceTimersByTime(150);
		});
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
	});

	it("does nothing when the target element is missing", () => {
		document.body.innerHTML = "";
		render(<ScrollToSlug targetId="missing" />);
		expect(() => {
			act(() => {
				jest.advanceTimersByTime(150);
			});
		}).not.toThrow();
	});

	it("clears the pending timer on unmount", () => {
		const scrollIntoView = stubTarget();

		const { unmount } = render(<ScrollToArticle />);
		unmount();
		act(() => {
			jest.advanceTimersByTime(150);
		});
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
