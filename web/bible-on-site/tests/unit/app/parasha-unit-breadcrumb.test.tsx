/**
 * @jest-environment jsdom
 *
 * Regression for issue #3166: the פרשה על הפרק breadcrumb must not
 * render a redundant תורה level — the division covers only the five
 * Torah sefarim, so the sefer picker lists them directly.
 */
import { render, screen, within } from "@testing-library/react";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import { UnitBreadcrumb } from "@/app/parasha/[unit]/components/UnitBreadcrumb";
import { getParashaUnitById } from "@/data/parasha/parasha-units";

describe("UnitBreadcrumb — פרשה על הפרק levels", () => {
	it("renders exactly the four levels with no תורה node (#3166)", () => {
		// פרשת פינחס — the issue's example: תנ"ך על הפרק > פרשה על הפרק >
		// במדבר > פרשת פינחס.
		render(<UnitBreadcrumb unit={getParashaUnitById(41)} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });

		// Four levels — the CSS separator lives on li:not(:last-child),
		// so an exact four means three separators and no blank/duplicate
		// separator targets at any width.
		const levels = nav.querySelectorAll("ol > li");
		expect(levels).toHaveLength(4);
		for (const level of levels) {
			expect(level.textContent?.trim()).not.toBe("");
		}

		// Level 1: site root; level 2: division root.
		expect(
			within(levels[0] as HTMLElement).getByRole("link", {
				name: 'תנ"ך על הפרק',
			}),
		).toHaveAttribute("href", "/");
		expect(
			within(levels[1] as HTMLElement).getByRole("link", {
				name: "פרשה על הפרק",
			}),
		).toHaveAttribute("href", "/פרשה");

		// Level 3: sefer picker; level 4: current parasha picker.
		expect(
			within(levels[2] as HTMLElement).getByRole("button", {
				name: "ספר נוכחי: במדבר. לחץ לבחירת ספר אחר",
			}),
		).toBeInTheDocument();
		expect(
			within(levels[3] as HTMLElement).getByRole("button", {
				name: "פרשה נוכחית: פינחס. לחץ לבחירת פרשה אחרת",
			}),
		).toBeInTheDocument();
		expect(levels[3]).toHaveAttribute("aria-current", "page");

		// No תורה node, its menu, or its חלק aria-label anywhere in the
		// breadcrumb — removed completely, not hidden.
		expect(within(nav).queryByText("תורה")).toBeNull();
		expect(
			within(nav).queryByRole("button", { name: /חלק נוכחי/ }),
		).toBeNull();
	});

	it("keeps the sefer picker navigating among all five Torah books", () => {
		render(<UnitBreadcrumb unit={getParashaUnitById(41)} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		const seferButton = within(nav).getByRole("button", {
			name: "ספר נוכחי: במדבר. לחץ לבחירת ספר אחר",
		});
		const seferDrop = seferButton.nextElementSibling as HTMLElement;
		for (const sefer of ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"]) {
			expect(
				within(seferDrop).getByRole("link", { name: sefer }),
			).toHaveAttribute("href", `/פרשה/${sefer}`);
		}
		// תורה is only a filter fact — no prophetic sefarim leak in.
		expect(within(seferDrop).queryByRole("link", { name: "יהושע" })).toBeNull();
	});

	it("keeps the parasha picker on name-based links within the sefer", () => {
		render(<UnitBreadcrumb unit={getParashaUnitById(41)} />);
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		const parashaButton = within(nav).getByRole("button", {
			name: "פרשה נוכחית: פינחס. לחץ לבחירת פרשה אחרת",
		});
		const parashaDrop = parashaButton.nextElementSibling as HTMLElement;
		// All ten במדבר parashot, each by canonical name slug.
		const links = within(parashaDrop).getAllByRole("link");
		expect(links).toHaveLength(10);
		expect(
			within(parashaDrop).getByRole("link", { name: "פרשת פינחס" }),
		).toHaveAttribute("href", "/פרשה/פינחס");
		expect(
			within(parashaDrop).getByRole("link", { name: "פרשת מטות" }),
		).toHaveAttribute("href", "/פרשה/מטות");
		for (const link of links) {
			expect(link.getAttribute("href")).toMatch(/^\/פרשה\/[א-ת-]+$/);
		}
	});
});
