import { act, renderHook } from "@testing-library/react";
import {
	seferContentFromRoute,
	useSeferContentNavigation,
	writeSeferContentHistory,
} from "@/app/929/[number]/components/useSeferContentNavigation";

describe("Sefer content navigation", () => {
	beforeEach(() => {
		history.replaceState({ __NA: true, __flipBookOwner: "book", tree: "router" }, "", "/929/1?book");
	});

	it.each([
		["/929/1/42?book", { perekId: 1, slug: "42" }],
		['/929/1/%D7%A8%D7%A9%22%D7%99?book', { perekId: 1, slug: 'רש"י' }],
		["/929/1?book", null],
		["/929/בראשית/תוכן?book", null],
		["/929/1/42", null],
		["/929/1/42/extra?book", null],
	])("reads content from %s", (route, expected) => {
		expect(seferContentFromRoute(route)).toEqual(expected);
	});

	it("preserves book ownership and router state and replaces the prior route", () => {
		writeSeferContentHistory(1, 'רש"י');
		expect(history.state).toEqual({
			__NA: true, __flipBookOwner: "book", tree: "router",
			route: '/929/1/%D7%A8%D7%A9%22%D7%99?book',
		});
		writeSeferContentHistory(1);
		expect(history.state.route).toBe("/929/1?book");
	});

	it("restores content before the book stops popstate propagation", () => {
		const { result, unmount } = renderHook(() => useSeferContentNavigation(1));
		const bookListener = (event: PopStateEvent) => event.stopImmediatePropagation();
		window.addEventListener("popstate", bookListener, true);
		try {
			act(() => result.current.navigate(1, "42"));
			expect(result.current.content).toEqual({ perekId: 1, slug: "42" });
			act(() => {
				history.replaceState(history.state, "", "/929/1?book");
				window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
			});
			expect(result.current.content).toBeNull();
			act(() => {
				history.replaceState(history.state, "", "/929/1/42?book");
				window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
			});
			expect(result.current.content?.slug).toBe("42");
		} finally {
			window.removeEventListener("popstate", bookListener, true);
			unmount();
		}
	});

	it("retains a deep link during initialization, then clears it when paging", async () => {
		const { result } = renderHook(() => useSeferContentNavigation(1, "42"));
		const entries = history.length;
		await act(async () => result.current.onPageFlipped());
		expect(location.pathname).toBe("/929/1/42");
		expect(history.length).toBe(entries);
		await act(async () => {
			result.current.onPageFlipped();
			history.pushState(history.state, "", "/929/2?book");
		});
		expect(result.current.content).toBeNull();
	});

	it("responds to router slug updates and avoids updates after unmount", async () => {
		const { result, rerender, unmount } = renderHook(({ slug }) => useSeferContentNavigation(1, slug), {
			initialProps: { slug: "42" as string | undefined },
		});
		rerender({ slug: 'רש"י' });
		expect(result.current.content?.slug).toBe('רש"י');
		rerender({ slug: undefined });
		expect(result.current.content).toBeNull();
		const route = location.href;
		await act(async () => { result.current.onPageFlipped(); unmount(); });
		expect(location.href).toBe(route);
	});
});
