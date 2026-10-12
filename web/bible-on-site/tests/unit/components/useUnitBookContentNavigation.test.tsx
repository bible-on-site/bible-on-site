/**
 * In-book content navigation hook for the alternative-division sefer
 * books (issue #2191): the unit counterpart of
 * useSeferContentNavigation — selections live in the unit's own book
 * URL (with a `haftara` spread param for auxiliary scopes), browser
 * Back/Forward restores an open perush/article, and a deep link
 * survives the flipbook's first URL normalization.
 */
import { act, renderHook } from "@testing-library/react";
import { useUnitBookContentNavigation } from "../../../src/app/components/reading/useUnitBookContentNavigation";

const ROOT = "/מסורה";
const ALIASES = ["/masora"] as const;

function startLocation() {
	history.replaceState(
		{ __NA: true, __flipBookOwner: "book", tree: "router" },
		"",
		"/מסורה/8?book",
	);
}

describe("useUnitBookContentNavigation", () => {
	beforeEach(() => {
		startLocation();
	});

	it("starts empty without an initial deep link", () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8),
		);
		expect(result.current.content).toBeNull();
	});

	it.each([
		[
			{ scope: "torah", kind: "perush", slug: 'רש"י' },
			{ unitId: 8, haftara: false, perush: 'רש"י' },
		],
		[
			{ scope: "torah", kind: "article", slug: "12" },
			{ unitId: 8, haftara: false, article: "12" },
		],
		[
			{ scope: "haftara", kind: "perush", slug: 'רש"י' },
			{ unitId: 8, haftara: true, haftaraPerush: 'רש"י' },
		],
		[
			{ scope: "haftara", kind: "article", slug: "12" },
			{ unitId: 8, haftara: true, haftaraArticle: "12" },
		],
	] as const)(
		"seeds %s into the matching content param",
		(initialContent, expected) => {
			const { result } = renderHook(() =>
				useUnitBookContentNavigation(ROOT, ALIASES, 8, initialContent),
			);
			expect(result.current.content).toEqual(expected);
		},
	);

	it("writes a book-scoped history entry on navigate", () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8),
		);

		act(() => result.current.navigate(8, "torah", "perush", 'רש"י'));

		expect(decodeURIComponent(location.pathname)).toBe("/מסורה/8");
		expect(location.search).toContain("book=");
		expect(location.search).toContain("perush=");
		expect(result.current.content).toEqual({
			unitId: 8,
			haftara: false,
			perush: 'רש"י',
		});
		// The flipbook/router state is preserved and the route recorded.
		expect(history.state).toMatchObject({
			__NA: true,
			__flipBookOwner: "book",
			tree: "router",
		});
		expect(decodeURIComponent(history.state.route)).toContain("perush=");
	});

	it("names the haftara spread on an auxiliary-scope selection", () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8),
		);

		act(() => result.current.navigate(8, "haftara", "perush", 'רש"י'));

		expect(location.search).toContain("haftaraPerush=");
		expect(location.search).toContain("haftara=");
		expect(result.current.content).toMatchObject({
			unitId: 8,
			haftara: true,
			haftaraPerush: 'רש"י',
		});
	});

	it("clears only the navigated scope's params when closing", () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8),
		);
		act(() => result.current.navigate(8, "torah", "perush", 'רש"י'));
		act(() => result.current.navigate(8, "haftara", "article", "5"));

		act(() => result.current.navigate(8, "torah"));

		expect(location.search).not.toContain("perush=");
		// The haftara selection param survives a torah-scope close even
		// though the route lands back on the torah spread.
		expect(location.search).toContain("haftaraArticle=5");
		expect(result.current.content).toEqual({
			unitId: 8,
			haftara: false,
			haftaraArticle: "5",
		});
	});

	it("restores content on popstate before the book stops propagation", () => {
		const { result, unmount } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8),
		);
		const bookListener = (event: PopStateEvent) =>
			event.stopImmediatePropagation();
		window.addEventListener("popstate", bookListener, true);
		try {
			act(() => result.current.navigate(8, "torah", "article", "9"));
			expect(result.current.content?.article).toBe("9");

			act(() => {
				history.replaceState(history.state, "", "/מסורה/8?book");
				window.dispatchEvent(
					new PopStateEvent("popstate", { state: history.state }),
				);
			});
			expect(result.current.content).toEqual({
				unitId: 8,
				haftara: false,
			});

			act(() => {
				history.replaceState(
					history.state,
					"",
					`/מסורה/8?book=&article=${encodeURIComponent("9")}`,
				);
				window.dispatchEvent(
					new PopStateEvent("popstate", { state: history.state }),
				);
			});
			expect(result.current.content?.article).toBe("9");
		} finally {
			window.removeEventListener("popstate", bookListener, true);
			unmount();
		}
	});

	it("restores content parsed from an ASCII alias route", () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8),
		);
		act(() => {
			history.replaceState(
				history.state,
				"",
				"/masora/8?book=&article=9",
			);
			window.dispatchEvent(
				new PopStateEvent("popstate", { state: history.state }),
			);
		});
		expect(result.current.content).toMatchObject({ unitId: 8, article: "9" });
	});

	it("retains a deep link through the first flip, then follows the URL", async () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8, {
				scope: "torah",
				kind: "perush",
				slug: 'רש"י',
			}),
		);
		// The flipbook's initialization normalizes the spread URL, dropping
		// the content params — the first onPageFlipped restores them by
		// replacing the entry.
		history.replaceState(history.state, "", "/מסורה/8?book");
		await act(async () => result.current.onPageFlipped());
		expect(location.search).toContain("perush=");
		expect(result.current.content?.perush).toBe('רש"י');

		// Later flips follow whatever the book wrote — no deep link retained.
		await act(async () => {
			result.current.onPageFlipped();
			history.pushState(history.state, "", "/מסורה/9?book");
		});
		expect(result.current.content).toEqual({ unitId: 9, haftara: false });
	});

	it("retains a haftara deep link through the first flip", async () => {
		const { result } = renderHook(() =>
			useUnitBookContentNavigation(ROOT, ALIASES, 8, {
				scope: "haftara",
				kind: "article",
				slug: "12",
			}),
		);
		history.replaceState(history.state, "", "/מסורה/8?book&haftara");
		await act(async () => result.current.onPageFlipped());
		// The restored entry names the Haftarah scope's own param.
		expect(location.search).toContain("haftaraArticle=12");
		expect(location.search).toContain("haftara=");
		expect(result.current.content?.haftaraArticle).toBe("12");
	});

	it("responds to initialContent updates and stops after unmount", async () => {
		const { result, rerender, unmount } = renderHook(
			({ content }) =>
				useUnitBookContentNavigation(ROOT, ALIASES, 8, content),
			{
				initialProps: {
					content: null as {
						scope: "torah";
						kind: "perush";
						slug: string;
					} | null,
				},
			},
		);
		rerender({
			content: { scope: "torah", kind: "perush", slug: 'רש"י' },
		});
		expect(result.current.content?.perush).toBe('רש"י');
		rerender({ content: null });
		expect(result.current.content).toBeNull();

		const route = location.href;
		await act(async () => {
			result.current.onPageFlipped();
			unmount();
		});
		expect(location.href).toBe(route);
	});
});
