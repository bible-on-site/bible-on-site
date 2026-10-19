/**
 * @jest-environment jsdom
 */
jest.mock("../../../src/lib/api-client", () => ({
	query: jest.fn(),
}));

import { render, screen, within } from "@testing-library/react";
import { NumbersSection } from "@/app/components/NumbersSection";
import { query } from "../../../src/lib/api-client";

const mockQuery = query as jest.MockedFunction<typeof query>;

const respond =
	(rabbis: number, articles: number, entries: number) => (sql: string) => {
		if (sql.includes("DISTINCT author_id"))
			return Promise.resolve([{ c: rabbis }]);
		if (sql.includes("tanahpedia_entry"))
			return Promise.resolve([{ c: entries }]);
		return Promise.resolve([{ c: articles }]);
	};

describe("NumbersSection", () => {
	it("renders the מספרים על הפרק heading and all three labeled counters", async () => {
		mockQuery.mockImplementation(respond(3, 4, 1250) as never);
		render(await NumbersSection());
		expect(
			screen.getByRole("heading", { name: "מספרים על הפרק" }),
		).toBeInTheDocument();
		const expected: [string, string][] = [
			["רבנים כותבים על הפרק", "3"],
			["מאמרים על הפרק", "4"],
			["ערכים על הפרק בתנכפדיה", "1,250"],
		];
		for (const [label, value] of expected) {
			// biome-ignore lint/style/noNonNullAssertion: label rendered by the component
			const stat = screen.getByText(label).closest("div")!;
			expect(within(stat).getAllByText(value).length).toBeGreaterThan(0);
		}
	});

	it("renders the section with id numbers for section navigation", async () => {
		mockQuery.mockImplementation(respond(0, 0, 0) as never);
		render(await NumbersSection());
		expect(document.getElementById("numbers")).toBeInTheDocument();
	});
});
