import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	type ContributionCatalogue,
	ContributionComposer,
} from "~/components/tanahpedia/ContributionComposer";
import { ContributionDiff } from "~/components/tanahpedia/ContributionDiff";
import { CONTRIBUTION_RECORDS } from "~/lib/tanahpedia/contribution-records";

const ID = "00000000-0000-4000-8000-000000000001",
	OTHER = "00000000-0000-4000-8000-000000000002";
const catalogue: ContributionCatalogue = {
	people: [{ id: ID, name: "אברהם" }],
	places: [],
	entities: [],
	references: {
		person: [{ id: ID, name: "אברהם" }],
		prophecy: [{ id: OTHER, name: "נבואת בדיקה" }],
		event: [{ id: ID, name: "אירוע בדיקה" }],
		entry: [
			{ id: ID, name: "אברהם" },
			{ id: OTHER, name: "יצחק" },
		],
		entity: [{ id: ID, name: "אברהם" }],
		perek: [{ id: 1, name: "בראשית א" }],
		perush: [{ id: 1, name: "פירוש" }],
	},
	targets: [],
};
function change(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function setup(kind: string) {
	const submit = vi.fn().mockResolvedValue(undefined);
	render(
		<ContributionComposer
			kind="pr"
			catalogue={catalogue}
			busy={false}
			onSubmit={submit}
			onCancel={() => {}}
		/>,
	);
	change("כותרת", "שינוי לבדיקה");
	change("תיאור", "מקור והסבר לבדיקה");
	change("סוג שינוי", kind);
	return submit;
}
async function submitted(submit: ReturnType<typeof vi.fn>) {
	fireEvent.submit(screen.getByRole("form"));
	await waitFor(() => expect(submit).toHaveBeenCalled());
	return submit.mock.calls[0][0].changes[0];
}
describe("category forms and domain diffs", () => {
	it("offers every approved record type in category groups", () => {
		setup("person_birth_date");
		const select = screen.getByLabelText("סוג שינוי");
		for (const kind of Object.keys(CONTRIBUTION_RECORDS))
			expect(select.querySelector(`option[value="${kind}"]`)).not.toBeNull();
		expect(select.querySelectorAll("optgroup").length).toBeGreaterThan(10);
	});
	it("submits a Hebrew date using named year, month and day controls", async () => {
		const submit = setup("person_birth_date");
		change("איש", ID);
		change("שנה - תאריך לידה", "5784");
		change("חודש - תאריך לידה", "1");
		change("יום - תאריך לידה", "2");
		expect(await submitted(submit)).toMatchObject({
			kind: "person_birth_date",
			after: { personId: ID, birthDate: 57840102, altGroupId: null },
		});
	});
	it("retains the not-yet death sentinel", async () => {
		const submit = setup("person_death_date");
		change("איש", ID);
		fireEvent.click(screen.getByLabelText("טרם נפטר"));
		expect(await submitted(submit)).toMatchObject({ after: { deathDate: -1 } });
	});
	it("submits adverse prophecy as a boolean rather than a truthy string", async () => {
		const submit = setup("prophecy_quality");
		change("נבואה", OTHER);
		change("נבואת טובה", "false");
		expect(await submitted(submit)).toMatchObject({
			after: { prophecyId: OTHER, isGood: false },
		});
	});
	it("edits disambiguation targets without exposing an operation JSON editor", async () => {
		const submit = setup("alias_mapping");
		change("כינוי", "שם משותף");
		fireEvent.click(screen.getByRole("button", { name: "הוספת יעד לכינוי" }));
		change("ערך יעד 1", ID);
		change("תווית יעד 1", "האב");
		fireEvent.click(screen.getByRole("button", { name: "הוספת יעד לכינוי" }));
		change("ערך יעד 2", OTHER);
		change("תווית יעד 2", "הבן");
		expect(await submitted(submit)).toMatchObject({
			after: {
				name: "שם משותף",
				targets: [
					{ entryId: ID, label: "האב" },
					{ entryId: OTHER, label: "הבן" },
				],
			},
		});
	});
	it("clears incompatible citation fields when switching to a bibliographic source", async () => {
		const submit = setup("source_reference");
		change("הטענה או היישות", ID);
		change("פרק", "1");
		change("פסוק", "2");
		change("פירוש", "1");
		change("סוג מקור", "other");
		change("הפניה ביבליוגרפית", "מקור בדיקה");
		expect(await submitted(submit)).toMatchObject({
			kind: "source_reference",
			after: {
				targetKind: "entity",
				targetId: ID,
				sourceType: "other",
				sourceText: "מקור בדיקה",
				perekId: null,
				pasukNumber: null,
				perushId: null,
			},
		});
	});
	it("shows category labels, Hebrew dates, booleans and alias destinations in a readable diff", () => {
		render(
			<ContributionDiff
				changes={[
					{
						kind: "person_birth_date",
						targetId: ID,
						before: null,
						after: { personId: OTHER, birthDate: 57840102 },
						labels: { [`personId:${OTHER}`]: "יצחק" },
					},
					{
						kind: "prophecy_quality",
						targetId: OTHER,
						before: { isGood: true },
						after: { isGood: false },
						labels: {},
					},
					{
						kind: "alias_mapping",
						targetId: "alias",
						before: null,
						after: {
							name: "שם",
							targets: [
								{ entryId: ID, label: "האב" },
								{ entryId: OTHER, label: "הבן" },
							],
						},
						labels: { [ID]: "אברהם", [OTHER]: "יצחק" },
					},
					{
						kind: "source_reference",
						targetId: "source",
						before: null,
						after: {
							targetKind: "person_birth_date",
							targetId: ID,
							sourceType: "tanah",
							perekId: 1,
							perushId: 1,
							pasukNumber: 2,
						},
						labels: {
							[`targetId:${ID}`]: "תאריך לידה",
							"perekId:1": "בראשית א",
							"perushId:1": "פירוש",
						},
					},
				]}
			/>,
		);
		expect(screen.getByText("2 תשרי 5784")).toBeInTheDocument();
		expect(screen.getByText("פורענות")).toBeInTheDocument();
		expect(screen.getByText("אברהם (האב); יצחק (הבן)")).toBeInTheDocument();
		expect(screen.getByText("בראשית א")).toBeInTheDocument();
		expect(screen.getByRole("cell", { name: "פירוש" })).toBeInTheDocument();
		expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
	});
});
