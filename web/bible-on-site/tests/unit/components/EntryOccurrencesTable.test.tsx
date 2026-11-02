import { act, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { EntryOccurrencesTable } from "../../../src/app/pedia/components/EntryOccurrencesTable";
import { DEFAULT_DIVINE_NAME_MASKING } from "../../../src/lib/divine-name-masking";
import {
	normalizeDivineNameMasking,
	saveDivineNameMaskingSettings,
	subscribeDivineNameMasking,
} from "../../../src/lib/divine-name-settings";
import type { EntryTanahOccurrence } from "../../../src/lib/tanahpedia/service";

jest.mock("../../../src/lib/divine-name-settings", () => {
	const actual = jest.requireActual<
		typeof import("../../../src/lib/divine-name-settings")
	>("../../../src/lib/divine-name-settings");
	return {
		...actual,
		subscribeDivineNameMasking: jest.fn(actual.subscribeDivineNameMasking),
	};
});

const subscribe = jest.mocked(subscribeDivineNameMasking);

beforeEach(() => {
	localStorage.clear();
	saveDivineNameMaskingSettings(DEFAULT_DIVINE_NAME_MASKING);
	subscribe.mockClear();
});

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
				segments:
					perekId === 1
						? [
								{ type: "qri", value: "בָּא־" },
								{ type: "qri", value: "אָב יְהוָה" },
								{ type: "ktiv", value: "שדי", qriOffset: 1 },
								{ type: "qri", value: "שַׁדַּי", ktivOffset: -1 },
							]
						: [
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
	expect(subscribe).not.toHaveBeenCalled();
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

it("keeps name preferences reactive without subscribing ordinary citation words", () => {
	saveDivineNameMaskingSettings(normalizeDivineNameMasking({ enabled: false }));
	const { container } = render(
		<EntryOccurrencesTable occurrences={[{ ...reference(1), perekId: 1 }]} />,
	);
	const citation = container.querySelector(".citation");
	expect(citation).toHaveTextContent("בָּא־אָב יְהוָה שדי (שַׁדַּי)");
	expect(subscribe).toHaveBeenCalledTimes(3);
	act(() =>
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({
				enabled: true,
				yhwh: "custom",
				yhwhCustom: "שם",
				shaddai: "hyphen",
			}),
		),
	);
	expect(container.querySelector(".citation")).toBe(citation);
	expect(citation).toHaveTextContent("בָּא־אָב שם שד-י (שד-י)");
	expect(container.querySelector("strong")).toHaveTextContent("אָב שם");
	expect(subscribe).toHaveBeenCalledTimes(3);
});
