import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { EntryOccurrencesTable } from "../../../src/app/pedia/components/EntryOccurrencesTable";
import type { EntryTanahOccurrence } from "../../../src/lib/tanahpedia/service";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

jest.mock("../../../src/data/perek-dto", () => ({
	getPerekByPerekId: (perekId: number) => ({
		perekId,
		source: "שמואל ב ה",
		pesukim: [
			{
				segments: [
					{ type: "qri", value: "בָּא־" },
					{ type: "qri", value: "לִירוּשָׁלִַם" },
					{ type: "qri", value: "וְשָׁב" },
					{ type: "ktiv", value: "ירושלם", qriOffset: 1 },
					{ type: "qri", value: "יְרוּשָׁלַיִם", ktivOffset: -1 },
					{ type: "stuma" },
					{ type: "ptuha" },
				],
			},
		],
	}),
}));

const reference = (
	segmentStart: number | null,
	segmentEnd = segmentStart,
): EntryTanahOccurrence => ({
	perekId: 268,
	pasukNumber: 1,
	segmentStart,
	segmentEnd,
});

it("groups repeated mentions in one verse and highlights only their recorded ranges", () => {
	const { container } = render(
		<EntryOccurrencesTable occurrences={[reference(1), reference(3, 4)]} />,
	);
	expect(screen.getAllByRole("row")).toHaveLength(2);
	expect(
		screen.getByRole("heading", { name: 'מופעים בתנ"ך' }),
	).toBeInTheDocument();
	expect(screen.getByRole("link", { name: "שמואל ב ה א" })).toHaveAttribute(
		"href",
		"/929/268#pasuk-1",
	);
	const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
	expect(cells).toHaveLength(2);
	expect(cells[1]).toHaveClass("citation");
	expect(cells[1].textContent).toBe("בָּא־לִירוּשָׁלִַם וְשָׁב ירושלם (יְרוּשָׁלַיִם)");
	expect(
		[...container.querySelectorAll("strong")].map((match) => match.textContent),
	).toEqual(["לִירוּשָׁלִַם", "ירושלם", "(יְרוּשָׁלַיִם)"]);
	for (const match of container.querySelectorAll("strong"))
		expect(match).toHaveClass("occurrence");
});

it("highlights the full text for whole-verse sources", () => {
	const { container } = render(
		<EntryOccurrencesTable occurrences={[reference(null)]} />,
	);
	expect(container.querySelectorAll("strong")).toHaveLength(5);
});

it("ignores invalid verse references and omits an empty table", () => {
	const { container } = render(
		<EntryOccurrencesTable
			occurrences={[
				{ ...reference(0), perekId: 930 },
				{ ...reference(0), pasukNumber: 2 },
				{ ...reference(0), pasukNumber: 1.5 },
			]}
		/>,
	);
	expect(container).toBeEmptyDOMElement();
});
