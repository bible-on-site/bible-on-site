/**
 * @jest-environment jsdom
 *
 * UnitBreadcrumb falls back to a plain sefer name when the division has
 * no first unit for that sefer. Real data covers all five Torah
 * sefarim, so the mock returns only בראשית — the other names render
 * unlinked.
 */
import { render, screen } from "@testing-library/react";

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

jest.mock("@/data/parasha/parasha-units", () => {
	const actual = jest.requireActual("@/data/parasha/parasha-units");
	const bereshit = actual.getParashaUnitById(1);
	return {
		...actual,
		getParashaFirstUnitBySefer: () => [bereshit],
		getParashaUnitsForSefer: () => [bereshit],
	};
});

import { UnitBreadcrumb } from "@/app/parasha/[unit]/components/UnitBreadcrumb";
import { getParashaUnitById } from "@/data/parasha/parasha-units";

describe("UnitBreadcrumb — sefer without a first unit", () => {
	it("renders the name unlinked when the division lacks that sefer", () => {
		render(<UnitBreadcrumb unit={getParashaUnitById(1)} />);
		// בראשית still links to its first unit in both pickers.
		const bereshitLinks = screen.getAllByRole("link", { name: "בראשית" });
		expect(bereshitLinks.length).toBeGreaterThan(0);
		for (const name of ["שמות", "ויקרא", "במדבר", "דברים"]) {
			for (const el of screen.getAllByText(name)) {
				expect(el.closest("a")).toBeNull();
				expect(el.closest("li")).not.toBeNull();
			}
		}
	});
});
