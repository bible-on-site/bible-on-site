/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TanahpediaLink } from "../../../src/app/929/[number]/components/TanahpediaLink";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		...rest
	}: {
		children: ReactNode;
		[key: string]: unknown;
	}) => <a {...rest}>{children}</a>,
}));

describe("TanahpediaLink", () => {
	it("links to the encoded entry and keeps the caller class", () => {
		const label = "Moshe";
		render(
			<TanahpediaLink entryUniqueName="moshe rabbeinu" className="entity-link">
				{label}
			</TanahpediaLink>,
		);

		const link = screen.getByRole("link", { name: "Moshe" });
		expect(link).toHaveAttribute("href", "/pedia/moshe%20rabbeinu");
		expect(link).toHaveClass("entity-link");
	});

	it("carries the data-tanahpedia-entry marker for the preview delegate", () => {
		const label = "Miriam";
		render(
			<TanahpediaLink entryUniqueName="miriam">{label}</TanahpediaLink>,
		);

		expect(screen.getByRole("link", { name: "Miriam" })).toHaveAttribute(
			"data-tanahpedia-entry",
			"miriam",
		);
	});
});
