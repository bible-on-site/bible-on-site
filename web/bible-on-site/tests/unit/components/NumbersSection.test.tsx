/**
 * @jest-environment jsdom
 */
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));
jest.mock("next/server", () => ({ connection: jest.fn() }));

import { render, screen, within } from "@testing-library/react";
import { NumbersSection } from "@/app/components/NumbersSection";
import { query } from "../../../src/lib/api-client";

const mockQuery = query as jest.MockedFunction<typeof query>;

const respond =
	(articles: number, entries: number, illustrations = 0) =>
	(sql: string) => {
		if (sql.includes("tanahpedia_entry"))
			return Promise.resolve([{ c: entries }]);
		if (sql.includes("tanah_perek_image"))
			return Promise.resolve([{ c: illustrations }]);
		return Promise.resolve([{ c: articles }]);
	};

describe("NumbersSection", () => {
	it("renders the מספרים על הפרק heading and all six labeled counters", async () => {
		mockQuery.mockImplementation(respond(4, 1250, 37) as never);
		render(await NumbersSection());
		expect(
			screen.getByRole("heading", { name: "מספרים על הפרק" }),
		).toBeInTheDocument();
		const expected: [string, RegExp][] = [
			["רבנים כותבים על הפרק", /^עשרות$/],
			["מאמרים על הפרק", /^4$/],
			["ערכים על הפרק בתנכפדיה", /^1,250$/],
			["איורים על הפרק", /^37$/],
			["פרקים מוקלטים", /^\d[\d,]*$/],
			["שנים שהתוכנית רצה", /^\d+$/],
		];
		for (const [label, value] of expected) {
			// biome-ignore lint/style/noNonNullAssertion: label rendered by the component
			const stat = screen.getByText(label).closest("div")!;
			expect(within(stat).getAllByText(value).length).toBeGreaterThan(0);
		}
	});

	it("renders the section with id numbers for section navigation", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		render(await NumbersSection());
		expect(document.getElementById("numbers")).toBeInTheDocument();
	});

	it("renders a real bottom divider element for the counters→app boundary", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		const { container } = render(await NumbersSection());
		expect(
			container.querySelector("#numbers > div:last-child"),
		).toBeInTheDocument();
	});

	it("links only the counters that have a real public destination", async () => {
		mockQuery.mockImplementation(respond(0, 0) as never);
		render(await NumbersSection());
		const expected: [RegExp, string][] = [
			[/^רבנים כותבים על הפרק: עשרות$/, "/929/authors"],
			[/^ערכים על הפרק בתנכפדיה: 0$/, "/pedia"],
			[/^שנים שהתוכנית רצה: \d+$/, "/calendar"],
		];
		for (const [name, href] of expected) {
			expect(screen.getByRole("link", { name })).toHaveAttribute(
				"href",
				href,
			);
		}
		// מאמרים (no collection route), איורים and פרקים מוקלטים (no
		// gallery/recording browse) must stay ordinary text (#2397).
		expect(screen.getAllByRole("link").length).toBe(expected.length);
	});
});
