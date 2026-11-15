import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { ContributionCatalogue } from "~/components/tanahpedia/ContributionComposer";
import {
	ContributionRecordFields,
	draftField,
	HebrewDateField,
	recordFieldValue,
} from "~/components/tanahpedia/ContributionRecordFields";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
it.each(["alias_mapping", "source_reference", "person_birth_date"])(
	"renders an incomplete %s draft when catalogue references are not available",
	(kind) => {
		render(
			<ContributionRecordFields
				kind={kind as Parameters<typeof ContributionRecordFields>[0]["kind"]}
				fields={
					kind === "source_reference"
						? { sourceType: "tanah", targetKind: "entity" }
						: {}
				}
				catalogue={{ people: [], places: [], entities: [], targets: [] }}
				onChange={vi.fn()}
			/>,
		);
		if (kind === "alias_mapping")
			expect(
				screen.getByRole("button", { name: "הוספת יעד לכינוי" }),
			).toBeEnabled();
		else expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
	},
);
it.each([
	["alias_mapping", "targets", "", []],
	[
		"alias_mapping",
		"targets",
		JSON.stringify([{ entryId: id, label: "Person", key: "ui-only" }]),
		[{ entryId: id, label: "Person" }],
	],
	["prophecy_quality", "isGood", "false", false],
	["prophecy_quality", "isGood", "true", true],
	["person_birth_date", "birthDate", "", null],
	["person_birth_date", "birthDate", "57840102", 57840102],
	["source_reference", "pasukNumber", "", null],
	["source_reference", "pasukNumber", "2", 2],
	["metadata", "displayName", "Name", "Name"],
])("retains typed field semantics for %s.%s", (kind, key, value, expected) => {
	expect(
		recordFieldValue(
			kind as Parameters<typeof recordFieldValue>[0],
			String(key),
			String(value),
		),
	).toEqual(expected);
});
it.each([
	[null, ""],
	[false, "false"],
	[0, "0"],
	[[{ entryId: id, label: "" }], JSON.stringify([{ entryId: id, label: "" }])],
])(
	"retains empty, false, zero and array values in editable drafts: %j",
	(value, expected) => expect(draftField(value)).toBe(expected),
);

it("clears the day when a Hebrew month becomes unknown and can clear or restore the death sentinel", () => {
	const changed = vi.fn();
	render(<DateEditor changed={changed} />);
	fireEvent.change(screen.getByLabelText("חודש - Date"), {
		target: { value: "0" },
	});
	expect(changed).toHaveBeenLastCalledWith("57840000");
	expect(screen.getByLabelText("יום - Date")).toHaveValue(0);
	fireEvent.click(screen.getByRole("button", { name: "ניקוי תאריך" }));
	expect(screen.getByLabelText("שנה - Date")).toHaveValue(null);
	fireEvent.click(screen.getByLabelText("טרם נפטר"));
	expect(changed).toHaveBeenLastCalledWith("-1");
	fireEvent.click(screen.getByLabelText("טרם נפטר"));
	expect(changed).toHaveBeenLastCalledWith("0");
});

const catalogue: ContributionCatalogue = {
	people: [],
	places: [],
	entities: [],
	references: {
		entry: [
			{ id, name: "First" },
			{ id: other, name: "Second" },
		],
		perek: [{ id: 1, name: "בראשית א" }],
		perush: [{ id: 2, name: "Commentary" }],
	},
	targets: [
		{
			kind: "parent_child",
			id,
			label: "Parent and child",
			after: { parentId: id, childId: other },
		},
	],
};

it("removes one alias destination while retaining the other destination and its edited label", () => {
	const changed = vi.fn();
	render(<AliasEditor changed={changed} />);
	fireEvent.change(screen.getByLabelText("תווית יעד 2"), {
		target: { value: "Retained" },
	});
	fireEvent.click(screen.getByRole("button", { name: "הסרת יעד 1" }));
	expect(JSON.parse(changed.mock.calls.at(-1)?.[0].targets)).toEqual([
		{ entryId: other, label: "Retained" },
	]);
	expect(screen.getByLabelText("ערך יעד 1")).toHaveValue(other);
});

it("uses structured-fact choices and clears stale fields when changing the citation type", () => {
	const changed = vi.fn();
	render(<SourceEditor changed={changed} />);
	expect(screen.getByRole("option", { name: "Parent and child" })).toHaveValue(
		id,
	);
	fireEvent.change(screen.getByLabelText("פרק"), { target: { value: "" } });
	fireEvent.change(screen.getByLabelText("פרק"), { target: { value: "1" } });
	fireEvent.change(screen.getByLabelText("פסוק"), { target: { value: "3" } });
	fireEvent.change(screen.getByLabelText("פירוש"), { target: { value: "" } });
	fireEvent.change(screen.getByLabelText("סוג הטענה"), {
		target: { value: "entity" },
	});
	expect(changed.mock.calls.at(-1)?.[0].targetId).toBe("");
	fireEvent.change(screen.getByLabelText("סוג מקור"), {
		target: { value: "other" },
	});
	fireEvent.change(screen.getByLabelText("הפניה ביבליוגרפית"), {
		target: { value: "Bibliography" },
	});
	expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
		sourceText: "Bibliography",
		perekId: "",
		pasukNumber: "",
		perushId: "",
	});
});

it("creates a stable alternative-group identifier without interpreting it as a display value", () => {
	const changed = vi.fn();
	render(
		<ContributionRecordFields
			kind="person_birth_date"
			fields={{ personId: id, birthDate: "", altGroupId: "" }}
			catalogue={catalogue}
			onChange={changed}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "קבוצת דעות חדשה" }));
	expect(changed.mock.calls[0][0].altGroupId).toMatch(/^[0-9a-f-]{36}$/);
});

function DateEditor({ changed }: { changed: (value: string) => void }) {
	const [value, setValue] = useState("57840102");
	return (
		<HebrewDateField
			label="Date"
			value={value}
			allowFuture
			onChange={(next) => {
				changed(next);
				setValue(next);
			}}
		/>
	);
}

function AliasEditor({
	changed,
}: {
	changed: (fields: Record<string, string>) => void;
}) {
	const [fields, setFields] = useState({
		name: "Alias",
		targets: JSON.stringify([
			{ entryId: id, label: "First" },
			{ entryId: other, label: "Second" },
		]),
	});
	return (
		<ContributionRecordFields
			kind="alias_mapping"
			fields={fields}
			catalogue={catalogue}
			onChange={(next) => {
				changed(next);
				setFields(next as typeof fields);
			}}
		/>
	);
}

function SourceEditor({
	changed,
}: {
	changed: (fields: Record<string, string>) => void;
}) {
	const [fields, setFields] = useState<Record<string, string>>({
		targetKind: "parent_child",
		targetId: id,
		sourceType: "tanah",
		perekId: "1",
		pasukNumber: "2",
		perushId: "2",
		sourceText: "",
	});
	return (
		<ContributionRecordFields
			kind="source_reference"
			fields={fields}
			catalogue={catalogue}
			onChange={(next) => {
				changed(next);
				setFields(next);
			}}
		/>
	);
}
