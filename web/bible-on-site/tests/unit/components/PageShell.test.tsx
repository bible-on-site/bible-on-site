/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import {
	PAGE_HEADER_POLICIES,
	PageShell,
	pageHeader,
} from "@/app/components/PageShell";

describe("PageShell", () => {
	it.each(PAGE_HEADER_POLICIES)(
		"declares the %s policy on the shared shell element",
		(header) => {
			const { container } = render(
				<PageShell header={header}>
					<div data-testid="content" />
				</PageShell>,
			);
			const shell = container.firstElementChild;
			expect(shell).toHaveAttribute("data-page-header", header);
			expect(shell).toHaveClass("page-shell");
		},
	);

	it("merges the family class name with the shared shell class", () => {
		const { container } = render(
			<PageShell header="solid" className="moadim-layout extra">
				<div />
			</PageShell>,
		);
		const shell = container.firstElementChild;
		expect(shell).toHaveClass("page-shell");
		expect(shell).toHaveClass("moadim-layout");
		expect(shell).toHaveClass("extra");
	});

	it("omits the dangling space when no family class is given", () => {
		const { container } = render(
			<PageShell header="none">
				<div />
			</PageShell>,
		);
		expect(container.firstElementChild?.getAttribute("class")).toBe(
			"page-shell",
		);
	});
});

describe("pageHeader", () => {
	it("spreads the declaration as a data attribute object", () => {
		expect(pageHeader("overlay")).toEqual({
			"data-page-header": "overlay",
		});
	});
});
