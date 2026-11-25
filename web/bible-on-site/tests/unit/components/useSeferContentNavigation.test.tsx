import { act, renderHook } from "@testing-library/react";
import {
	seferContentFromRoute,
	useSeferContentNavigation,
	writeSeferContentHistory,
} from "@/app/929/[number]/components/useSeferContentNavigation";

describe("Sefer content navigation", () => {
	beforeEach(() => {
		history.replaceState(
			{ __NA: true, __flipBookOwner: "book", tree: "router" },
			"",
			"/929/1?book",
		);
	});

	it.each([
		["/929/1/42?book", { perekId: 1, slug: "42", further: false }],
		[
			"/929/1/%D7%A8%D7%A9%22%D7%99?book",
			{ perekId: 1, slug: 'רש"י', further: false },
		],
		["/929/1?book", null],
		["/929/בראשית/תוכן?book", null],
		["/929/1/42", null],
		["/929/1/42/extra?book", null],
		// לקריאה נוספת (#3752): the secondary selection rides a `further`
		// parameter on the browsed chapter — the recommended article's own
		// perek differs, so the path-slug form would 404 on reload.
		["/929/2?book&further=1", { perekId: 2, slug: "1", further: true }],
		["/929/2?book&further=", null],
		["/929/2?further=1", null],
	])("reads content from %s", (route, expected) => {
		expect(seferContentFromRoute(route)).toEqual(expected);
	});

	it("preserves book ownership and router state and replaces the prior route", () => {
		writeSeferContentHistory(1, 'רש"י');
		expect(history.state).toEqual({
			__NA: true,
			__flipBookOwner: "book",
			tree: "router",
			route: "/929/1/%D7%A8%D7%A9%22%D7%99?book",
		});
		writeSeferContentHistory(1);
		expect(history.state.route).toBe("/929/1?book");
	});

	it("writes a secondary-coverage selection on the browsed chapter (#3752)", () => {
		// Article 1 belongs to perek 1; selecting it from perek 2's book panel
		// must not produce /929/2/1?book — that standalone route 404s on reload.
		writeSeferContentHistory(2, "1", false, true);
		expect(history.state.route).toBe("/929/2?book&further=1");
		expect(seferContentFromRoute(location.pathname + location.search))
			.toEqual({ perekId: 2, slug: "1", further: true });
	});

	it("restores content before the book stops popstate propagation", () => {
		const { result, unmount } = renderHook(() => useSeferContentNavigation(1));
		const bookListener = (event: PopStateEvent) =>
			event.stopImmediatePropagation();
		window.addEventListener("popstate", bookListener, true);
		try {
			act(() => result.current.navigate(1, "42"));
			expect(result.current.content).toEqual({
				perekId: 1,
				slug: "42",
				further: false,
			});
			act(() => {
				history.replaceState(history.state, "", "/929/1?book");
				window.dispatchEvent(
					new PopStateEvent("popstate", { state: history.state }),
				);
			});
			expect(result.current.content).toBeNull();
			act(() => {
				history.replaceState(history.state, "", "/929/1/42?book");
				window.dispatchEvent(
					new PopStateEvent("popstate", { state: history.state }),
				);
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
		const { result, rerender, unmount } = renderHook(
			({ slug }) => useSeferContentNavigation(1, slug),
			{
				initialProps: { slug: "42" as string | undefined },
			},
		);
		rerender({ slug: 'רש"י' });
		expect(result.current.content?.slug).toBe('רש"י');
		rerender({ slug: undefined });
		expect(result.current.content).toBeNull();
		const route = location.href;
		await act(async () => {
			result.current.onPageFlipped();
			unmount();
		});
		expect(location.href).toBe(route);
	});

	it("keeps a selection made during a TOC turn when that chapter commits", async () => {
		const { result } = renderHook(() => useSeferContentNavigation(2));
		await act(async () => result.current.onPageFlipped());
		act(() => result.current.navigate(1, 'רש"י'));
		const entries = history.length;
		await act(async () => {
			result.current.onPageFlipped();
			// The book finishes the already-visible chapter turn after selection.
			history.replaceState(history.state, "", "/929/1?book");
		});
		expect(result.current.content).toEqual({
			perekId: 1,
			slug: 'רש"י',
			further: false,
		});
		expect(decodeURIComponent(location.pathname)).toBe('/929/1/רש"י');
		expect(history.length).toBe(entries);
		expect(history.state.__flipBookOwner).toBe("book");
	});

	it("clears a selected item when a turn commits a different chapter or the TOC", async () => {
		const { result } = renderHook(() => useSeferContentNavigation(1));
		await act(async () => result.current.onPageFlipped());
		for (const route of ["/929/2?book", "/929/בראשית/תוכן?book"]) {
			act(() => result.current.navigate(1, "42"));
			await act(async () => {
				result.current.onPageFlipped();
				history.replaceState(history.state, "", route);
			});
			expect(result.current.content).toBeNull();
			expect(decodeURIComponent(location.pathname + location.search)).toBe(
				route,
			);
		}
	});

	it("respects a newer deep link instead of replacing it with the prior selection", async () => {
		const { result } = renderHook(() => useSeferContentNavigation(1));
		await act(async () => result.current.onPageFlipped());
		act(() => result.current.navigate(1, "42"));
		await act(async () => {
			result.current.onPageFlipped();
			result.current.navigate(1, 'רש"י');
		});
		expect(result.current.content).toEqual({
			perekId: 1,
			slug: 'רש"י',
			further: false,
		});
	});
});
