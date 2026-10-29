/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
	usePathname: () => mockPathname,
}));

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

import { TopNav } from "@/app/components/TopNav";

const searchLink = () => screen.queryByRole("link", { name: "חיפוש" });

describe("TopNav", () => {
	beforeEach(() => {
		mockPathname = "/";
	});

	it("links the logo home and exposes an icon-only labelled search button", () => {
		render(<TopNav />);

		const nav = screen.getByRole("navigation", { name: "ניווט עליון" });
		expect(nav).toHaveClass("top-nav");

		// The mocked image keeps its alt off the DOM, so locate the logo
		// link by href (same pattern as NavBar.test.tsx).
		const logoLink = nav.querySelector('a[href="/"]');
		expect(logoLink).toBeInTheDocument();
		expect(nav.querySelector('[data-alt=\'תנ"ך על הפרק\']')).toBeTruthy();

		// Icon-only: the accessible name comes from aria-label, and the
		// button renders no visible text (#2154).
		const search = screen.getByRole("link", { name: "חיפוש" });
		expect(search).toHaveAttribute("href", "/search");
		expect(search).toHaveAttribute("aria-label", "חיפוש");
		expect(search).toHaveClass("top-nav-search");
		expect(search).not.toHaveTextContent(/\S/);
	});

	it("renders exactly the logo and search entries, in that order", () => {
		render(<TopNav />);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute("href", "/");
		expect(links[1]).toHaveAttribute("href", "/search");
	});

	it("shows the search button outside reader sections", () => {
		// The מסורה/פרשה landing roots hold no settings button — the
		// collision only exists inside their unit routes.
		for (const pathname of [
			"/",
			"/search",
			"/tos",
			"/מסורה",
			"/masora",
			"/פרשה",
			"/parasha",
		]) {
			mockPathname = pathname;
			const { unmount } = render(<TopNav />);
			expect(searchLink()).toBeInTheDocument();
			unmount();
		}
	});

	it.each([
		// על הפרק — the whole /929 tree (#2274)
		"/929",
		"/929/11",
		"/929/11/2",
		"/929/authors",
		"/929/rabbis",
		// Masora/Parasha unit readers share the settings corner —
		// public Hebrew paths and internal ASCII route dirs alike.
		"/מסורה/1",
		"/masora/1",
		"/%D7%9E%D7%A1%D7%95%D7%A8%D7%94/1",
		"/פרשה/לך-לך",
		"/parasha/לך-לך",
		"/%D7%A4%D7%A8%D7%A9%D7%94/%D7%9C%D7%9A-%D7%9C%D7%9A",
	])(
		"omits the search button entirely on reader pages (%s)",
		(pathname) => {
			mockPathname = pathname;
			render(<TopNav />);

			// #2274: no link, no invisible .top-nav-search hit area and no
			// keyboard-focusable remnant — nothing is rendered at all.
			expect(searchLink()).not.toBeInTheDocument();
			expect(document.querySelector(".top-nav-search")).toBeNull();
			expect(screen.getAllByRole("link")).toHaveLength(1);
		},
	);
});
