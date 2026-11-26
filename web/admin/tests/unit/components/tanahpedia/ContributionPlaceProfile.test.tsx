import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	ContributionPlaceProfileDiff,
	ContributionPlaceProfileFields,
	type PlaceProfileDraft,
	placeProfileDraft,
	placeProfileDraftValue,
} from "~/components/tanahpedia/ContributionPlaceProfile";
import type { PlaceProfileChange } from "~/lib/tanahpedia/contribution-place-profile";

const savedPlace = "saved-place";
const catalogue = [
	{ id: "uncatalogued-entry", name: "מקום ללא ערך", hasEntry: 0 },
];

function Editor({
	draft,
	savedTarget,
	onChange,
}: {
	draft: PlaceProfileDraft;
	savedTarget: string;
	onChange: (value: PlaceProfileChange, targetId: string) => void;
}) {
	const [value, setValue] = useState(draft);
	const [targetId, setTargetId] = useState(savedTarget);
	return (
		<ContributionPlaceProfileFields
			value={value}
			targetId={targetId}
			places={catalogue}
			onChange={(nextValue, nextTargetId) => {
				setValue(nextValue);
				setTargetId(nextTargetId);
				onChange(placeProfileDraftValue(nextValue), nextTargetId);
			}}
		/>
	);
}

function renderEditor(draft: PlaceProfileDraft, savedTarget = "") {
	const onChange =
		vi.fn<(value: PlaceProfileChange, targetId: string) => void>();
	render(
		<Editor draft={draft} savedTarget={savedTarget} onChange={onChange} />,
	);
	return onChange;
}

describe("place profile editor", () => {
	it("keeps the saved destination available and lets the editor enter a different new place", () => {
		const onChange = renderEditor(
			placeProfileDraft(
				{ entry: null, occurrences: [], identification: null },
				{ place: "פיתום" },
			),
			savedPlace,
		);
		const selector = screen.getByLabelText("מקום קיים");
		expect(selector).toHaveValue(savedPlace);
		expect(
			within(selector).getByRole("option", { name: "פיתום", selected: true }),
		).toBeInTheDocument();
		expect(
			within(selector).getByRole("option", {
				name: "מקום ללא ערך (ללא ערך לקישור)",
			}),
		).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("יעד ההצעה"), {
			target: { value: "new" },
		});
		for (const [label, value] of [
			["כותרת הערך", "פתם"],
			["כתובת הערך", "פתם-מצרים"],
			["שם המקום", "פיתום"],
		]) {
			fireEvent.change(screen.getByLabelText(label), { target: { value } });
		}
		expect(onChange).toHaveBeenLastCalledWith(
			{
				entry: { title: "פתם", uniqueName: "פתם-מצרים", displayName: "פיתום" },
				identification: null,
				occurrences: [],
			},
			"",
		);
	});

	it("uses distinct citation fields for a proposed point and can remove the point", () => {
		const onChange = renderEditor(placeProfileDraft());
		const enable = screen.getByLabelText("הצעת זיהוי עם נקודה במפה");
		fireEvent.click(enable);
		const basis = screen.getByLabelText("בסיס הזיהוי");
		expect(basis).toHaveValue("consensus");
		fireEvent.change(basis, { target: { value: "commentary" } });
		for (const [label, value] of [
			["שם האתר המזוהה", "טאניס"],
			["קו רוחב", "30.9"],
			["קו אורך", "31.8"],
			["מקור לזיהוי", "תרגום ירושלמי שמות א יא"],
			["מקור לקואורדינטות", "מפת מדידה"],
		]) {
			fireEvent.change(screen.getByLabelText(label), { target: { value } });
		}
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				identification: {
					modernName: "טאניס",
					latitude: 30.9,
					longitude: 31.8,
					basis: "commentary",
					citation: "תרגום ירושלמי שמות א יא",
					coordinateCitation: "מפת מדידה",
				},
			}),
			"",
		);
		fireEvent.change(basis, { target: { value: "consensus" } });
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				identification: expect.objectContaining({ basis: "consensus" }),
			}),
			"",
		);
		fireEvent.click(enable);
		expect(
			screen.queryByLabelText("מקור לקואורדינטות"),
		).not.toBeInTheDocument();
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ identification: null }),
			"",
		);
	});

	it("opens a word added on the next page and preserves earlier occurrences when editing it", () => {
		const occurrences = Array.from({ length: 40 }, (_, index) => ({
			perekId: 51,
			pasukNumber: 11,
			segmentStart: index,
			segmentEnd: index,
			text: `מופע ${index + 1}`,
		}));
		const onChange = renderEditor(
			placeProfileDraft({ entry: null, identification: null, occurrences }),
			savedPlace,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ הוספת מופע" }));
		expect(screen.getByText("2 מתוך 2")).toBeVisible();
		expect(screen.queryByText(/^40\. מופע 40/)).not.toBeInTheDocument();
		for (const [label, value] of [
			["מזהה פרק", "51"],
			["מספר פסוק", "11"],
			["קטע ראשון", "40"],
			["קטע אחרון", "40"],
			["מילה או צירוף מהמקרא", "פִּתֹ֖ם"],
		]) {
			fireEvent.change(screen.getByLabelText(label), { target: { value } });
		}
		expect(onChange).toHaveBeenLastCalledWith(
			{
				entry: null,
				identification: null,
				occurrences: [
					...occurrences,
					{
						perekId: 51,
						pasukNumber: 11,
						segmentStart: 40,
						segmentEnd: 40,
						text: "פִּתֹ֖ם",
					},
				],
			},
			savedPlace,
		);
		fireEvent.click(screen.getByRole("button", { name: "הסרת מופע 41" }));
		expect(screen.getByText(/^40\. מופע 40/)).toBeVisible();
		expect(
			screen.queryByRole("navigation", { name: "עמודי מופעים" }),
		).not.toBeInTheDocument();
	});
});

describe("place profile comparison", () => {
	it.each([
		{ existingCitations: null, status: "זיהוי מוצע", addedSources: [] },
		{
			existingCitations: ["מפת מדידה"],
			status: "זיהוי שכבר קיים",
			addedSources: ["תרגום ירושלמי שמות א יא · מקור להוספה"],
		},
	])(
		"shows $status without counting the map citation as a new source",
		({ existingCitations, status, addedSources }) => {
			render(
				<ContributionPlaceProfileDiff
					change={{
						kind: "place_profile",
						targetId: savedPlace,
						before: {
							entryAddresses: ["פיתום"],
							occurrences: [],
							identification: existingCitations
								? { id: "stored-point", citations: existingCitations }
								: null,
						},
						after: {
							entry: null,
							occurrences: [],
							identification: {
								modernName: "טאניס",
								latitude: 30.9,
								longitude: 31.8,
								basis: "commentary",
								citation: "תרגום ירושלמי שמות א יא",
								coordinateCitation: "מפת מדידה",
							},
						},
						labels: {},
					}}
				/>,
			);
			expect(screen.getByText(savedPlace)).toBeVisible();
			const point = within(
				screen.getByRole("region", { name: "זיהוי וקואורדינטות" }),
			);
			expect(point.getByRole("heading", { name: status })).toBeVisible();
			expect(point.getByText("מפת מדידה")).toBeVisible();
			expect(
				point
					.queryAllByText(/מקור להוספה/)
					.map((marker) => marker.parentElement?.textContent),
			).toEqual(addedSources);
		},
	);

	it("renders no comparison when the reviewed sequence has no after snapshot", () => {
		const { container } = render(
			<ContributionPlaceProfileDiff
				change={{
					kind: "place_profile",
					targetId: savedPlace,
					before: null,
					after: null,
					labels: {},
				}}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
