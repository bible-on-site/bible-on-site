/**
 * Tests for the tanahpedia breadcrumb navigation component.
 */

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

jest.mock(
	"../../../src/app/929/[number]/components/breadcrumb.module.css",
	() => new Proxy({}, { get: (_, key) => String(key) }),
);

import { render, screen } from "@testing-library/react";
import { TanahpediaBreadcrumb } from "../../../src/app/pedia/components/TanahpediaBreadcrumb";

describe("TanahpediaBreadcrumb", () => {
	it("renders root links without a category", () => {
		render(<TanahpediaBreadcrumb />);
		expect(screen.getByTestId("tanahpedia-breadcrumb")).toBeInTheDocument();
		expect(screen.getByText('תנ"ך על הפרק')).toBeInTheDocument();
		expect(screen.getByText("תנכפדיה")).toBeInTheDocument();
	});

	it("renders the category dropdown with sub-categories", () => {
		render(<TanahpediaBreadcrumb currentCategory="PERSON" />);
		expect(screen.getAllByText("אישים").length).toBeGreaterThan(0);
	});

	it("renders sibling entries and marks the current one", () => {
		render(
			<TanahpediaBreadcrumb
				currentCategory="PERSON"
				currentEntryTitle="אברהם"
				currentEntryUniqueName="abraham"
				siblingEntries={[
					{ uniqueName: "abraham", title: "אברהם" },
					{ uniqueName: "moses", title: "משה" },
				]}
			/>,
		);
		const current = screen.getByRole("link", { name: "אברהם" });
		expect(current).toHaveAttribute("aria-current", "page");
		expect(current).toHaveAttribute("href", "/pedia/abraham");
		expect(screen.getByRole("link", { name: "משה" })).toHaveAttribute(
			"href",
			"/pedia/moses",
		);
	});

	it("renders the entry title as plain text when there are no siblings", () => {
		render(<TanahpediaBreadcrumb currentEntryTitle="אברהם" />);
		const item = screen.getByText("אברהם");
		expect(item.tagName).toBe("LI");
		expect(item).toHaveAttribute("aria-current", "page");
	});
});
