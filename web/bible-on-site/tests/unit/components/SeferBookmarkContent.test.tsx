/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import { createSeferBookmarkContent } from "@/app/929/[number]/components/sefer-bookmark-content";

const bookmark = {
	id: "perek-1",
	pageIndex: 3,
	label: "בראשית א",
	data: {
		compact: "א",
		source: "בראשית א",
		title: undefined as string | undefined,
	},
};

it("updates changed references and titles while reusing unchanged visible content", () => {
	const content = createSeferBookmarkContent("#123456");
	const brief = content.renderBookmark(bookmark);
	const expanded = content.renderExpandedBookmark(bookmark);
	const { container, rerender } = render(expanded);
	expect(container.querySelector(".sefer-bookmark-expanded-title")).toBeNull();
	const titled = {
		...bookmark,
		data: { ...bookmark.data, title: "כותרת הפרק" },
	};
	expect(content.renderBookmark(titled)).toBe(brief);
	const withTitle = content.renderExpandedBookmark(titled);
	expect(withTitle).not.toBe(expanded);
	expect(
		content.renderExpandedBookmark({ ...titled, data: { ...titled.data } }),
	).toBe(withTitle);
	rerender(withTitle);
	expect(
		container.querySelector(".sefer-bookmark-expanded-perek"),
	).toHaveTextContent("פרק א");
	expect(
		container.querySelector(".sefer-bookmark-expanded-title"),
	).toHaveTextContent("כותרת הפרק");
	const next = { ...titled, data: { ...titled.data, compact: "ב" } };
	expect(content.renderBookmark(next)).not.toBe(brief);
	rerender(content.renderExpandedBookmark(next));
	expect(
		container.querySelector(".sefer-bookmark-expanded-perek"),
	).toHaveTextContent("פרק ב");
});

it("keeps cover colors scoped to the current provider", () => {
	const first = createSeferBookmarkContent("#123456");
	const second = createSeferBookmarkContent("#abcdef");
	const firstNode = first.renderExpandedBookmark(bookmark);
	const secondNode = second.renderExpandedBookmark(bookmark);
	expect(secondNode).not.toBe(firstNode);
	const { container, rerender } = render(firstNode);
	const color = () =>
		container
			.querySelector<HTMLElement>(".sefer-bookmark-expanded")
			?.style.getPropertyValue("--cover-color");
	expect(color()).toBe("#123456");
	rerender(secondNode);
	expect(color()).toBe("#abcdef");
	expect(first.renderExpandedBookmark(bookmark)).toBe(firstNode);
});
