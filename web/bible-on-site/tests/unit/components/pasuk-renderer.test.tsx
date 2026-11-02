/** @jest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
	renderPasukWithEntityRefs,
	renderSegmentRange,
} from "@/app/929/[number]/components/pasuk-renderer";
import type { Segment } from "@/data/db/tanah-view-types";
import { DEFAULT_DIVINE_NAME_MASKING } from "@/lib/divine-name-masking";
import {
	normalizeDivineNameMasking,
	saveDivineNameMaskingSettings,
	subscribeDivineNameMasking,
} from "@/lib/divine-name-settings";
import { buildEntityRefLookup } from "@/lib/tanahpedia/entity-ref-lookup";

jest.mock("@/lib/divine-name-settings", () => {
	const actual = jest.requireActual<
		typeof import("@/lib/divine-name-settings")
	>("@/lib/divine-name-settings");
	return {
		...actual,
		subscribeDivineNameMasking: jest.fn(actual.subscribeDivineNameMasking),
	};
});

const subscribe = jest.mocked(subscribeDivineNameMasking);
const qri = (value: string, ktivOffset?: number): Segment => ({
	type: "qri",
	value,
	recordingTimeFrame: { from: "00:00:00", to: "00:00:01" },
	...(ktivOffset === undefined ? {} : { ktivOffset }),
});

function Verse({ segments }: { segments: Segment[] }) {
	const { content } = renderSegmentRange(
		segments,
		0,
		segments.length - 1,
		0,
		() => <i data-testid="ptuha" />,
		() => <i data-testid="stuma" />,
		"qri",
	);
	return <p data-testid="verse">{content}</p>;
}

beforeEach(() => {
	localStorage.clear();
	saveDivineNameMaskingSettings(DEFAULT_DIVINE_NAME_MASKING);
	subscribe.mockClear();
});

it("renders ordinary and pointed non-name words without masking subscriptions", () => {
	const values = ["בְּרֵאשִׁית", "שְׂדֵי", "אֶל", "אֵלֶּה", "שמואל"];
	render(
		<Verse
			segments={[
				...values.map((value) => qri(value)),
				{ type: "ktiv", value: "ירושלם", qriOffset: 0 },
			]}
		/>,
	);
	expect(screen.getByTestId("verse")).toHaveTextContent(
		[...values, "ירושלם"].join(" "),
	);
	expect(subscribe).not.toHaveBeenCalled();
});

it.each([false, true])(
	"keeps names reactive from unmasked choices (enabled: %s)",
	(enabled) => {
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled, elohim: "asis", shaddai: "asis" }),
		);
		const ordinary = "בְּרֵאשִׁית";
		const elohim = "אֱלֹהִים";
		const shaddai = "שַׁדַּי";
		render(<Verse segments={[qri(ordinary), qri(elohim), qri(shaddai)]} />);
		const verse = screen.getByTestId("verse");
		expect(verse).toHaveTextContent(`${ordinary} ${elohim} ${shaddai}`);
		expect(subscribe).toHaveBeenCalledTimes(2);
		act(() =>
			saveDivineNameMaskingSettings(
				normalizeDivineNameMasking({
					enabled: true,
					elohim: "custom",
					elohimCustom: "שם",
					shaddai: "hyphen",
				}),
			),
		);
		expect(screen.getByTestId("verse")).toBe(verse);
		// Custom text replaces the stem; the canonical final mem suffix remains.
		expect(verse).toHaveTextContent(`${ordinary} שםם שד-י`);
		expect(subscribe).toHaveBeenCalledTimes(2);
	},
);

it("preserves multi-word qri, maqaf spacing, ktiv and recitation wrapper coordinates", () => {
	const segments: Segment[] = [
		qri("בָּא־"),
		{ type: "ktiv", value: "אלהים", qriOffset: 1 },
		qri("אֱלֹהִים יְהוָה", -1),
		{ type: "ptuha" },
		{ type: "stuma" },
	];
	const wrapped = jest.fn((pasuk: number, segment: number, text: ReactNode) => (
		<b data-word={`${pasuk}:${segment}`}>{text}</b>
	));
	const { content } = renderSegmentRange(
		segments,
		0,
		segments.length - 1,
		4,
		() => <i data-testid="ptuha" />,
		() => <i data-testid="stuma" />,
		"qri",
		wrapped,
	);
	const { container } = render(<p>{content}</p>);
	expect(container.textContent).toBe("בָּא־א-להים (א-להים ה')  ");
	expect(container.querySelector(".qri")).toHaveTextContent("(א-להים ה')");
	expect(container.querySelector(".qri label")).toBeInTheDocument();
	expect(
		wrapped.mock.calls.map(([pasuk, segment]) => [pasuk, segment]),
	).toEqual([
		[5, 1],
		[5, 3],
	]);
	expect(container.querySelector('[data-word="5:3"]')).toHaveTextContent(
		"א-להים ה'",
	);
	expect(screen.getByTestId("ptuha")).toBeInTheDocument();
	expect(screen.getByTestId("stuma")).toBeInTheDocument();
	expect(subscribe).toHaveBeenCalledTimes(2);
});

it("preserves linked segment ranges and word coordinates across preference changes", () => {
	const content = renderPasukWithEntityRefs(
		[qri("בָּא־"), qri("יְהוָה"), qri("שָׁם")],
		2,
		buildEntityRefLookup([
			{
				entityId: "place",
				entityName: "מקום",
				entityType: "PLACE",
				entryUniqueName: "test-place",
				pasukNumber: 3,
				segmentStart: 0,
				segmentEnd: 1,
			},
		]),
		() => null,
		() => null,
		"qri",
		(entry, children, key) => (
			<a key={key} href={`/pedia/${entry}`}>
				{children}
			</a>
		),
		(pasuk, segment, text) => <b data-word={`${pasuk}:${segment}`}>{text}</b>,
	);
	const { container } = render(<p>{content}</p>);
	const link = screen.getByRole("link");
	expect(link).toHaveAttribute("href", "/pedia/test-place");
	expect(link).toHaveTextContent("בָּא־ה'");
	expect(container.textContent).toBe("בָּא־ה' שָׁם");
	expect(
		[...container.querySelectorAll("[data-word]")].map((word) =>
			word.getAttribute("data-word"),
		),
	).toEqual(["3:1", "3:2", "3:3"]);
	expect(subscribe).toHaveBeenCalledTimes(1);
	act(() =>
		saveDivineNameMaskingSettings(
			normalizeDivineNameMasking({ enabled: false }),
		),
	);
	expect(screen.getByRole("link")).toBe(link);
	expect(link).toHaveTextContent("בָּא־יְהוָה");
	expect(container.textContent).toBe("בָּא־יְהוָה שָׁם");
	expect(subscribe).toHaveBeenCalledTimes(1);
});
