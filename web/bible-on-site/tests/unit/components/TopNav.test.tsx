/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

import { TopNav } from "@/app/components/TopNav";

describe("TopNav", () => {
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
		const searchLink = screen.getByRole("link", { name: "חיפוש" });
		expect(searchLink).toHaveAttribute("href", "/search");
		expect(searchLink).toHaveAttribute("aria-label", "חיפוש");
		expect(searchLink).toHaveClass("top-nav-search");
		expect(searchLink).not.toHaveTextContent(/\S/);
	});

	it("renders exactly the logo and search entries, in that order", () => {
		render(<TopNav />);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute("href", "/");
		expect(links[1]).toHaveAttribute("href", "/search");
	});
});
