/**
 * Tests for the ScrollToSlug scroll-on-mount helper.
 */

import { act, render } from "@testing-library/react";
import { ScrollToSlug } from "../../../src/app/929/[number]/[slug]/ScrollToArticle";

describe("ScrollToSlug", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		document.body.innerHTML = "";
	});

	afterEach(() => {
		jest.useRealTimers();
		history.scrollRestoration = "auto";
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

	it("takes over scroll restoration so the one-shot scroll wins the race", () => {
		stubTarget();

		render(<ScrollToSlug />);

		// The browser re-applies the restored scroll position as late-arriving
		// content grows the page — after the 100ms one-shot scroll has already
		// fired — so the entry must be on manual restoration.
		expect(history.scrollRestoration).toBe("manual");
	});

	it("hands normal restoration back to history entries created later", () => {
		stubTarget();
		render(<ScrollToSlug />);
		expect(history.scrollRestoration).toBe("manual");

		// New entries inherit the current entry's restoration mode, so the
		// component resets it to "auto" before letting pushState create one —
		// otherwise Back on the pushed page (e.g. the author list) could never
		// restore its saved scroll position.
		history.pushState({}, "", "/");
		expect(history.scrollRestoration).toBe("auto");
		history.scrollRestoration = "manual";
		history.replaceState({}, "", "/");
		expect(history.scrollRestoration).toBe("auto");
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

		const { unmount } = render(<ScrollToSlug />);
		unmount();
		act(() => {
			jest.advanceTimersByTime(150);
		});
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
