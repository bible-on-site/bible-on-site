import { describe, expect, it } from "vitest";
import { contributionRecordId } from "~/lib/tanahpedia/contribution-identifiers";
import {
	CONTRIBUTION_RECORDS,
	isContributionRecordKind,
	validateContributionField,
	validateContributionRecord,
} from "~/lib/tanahpedia/contribution-records";
import { validateChange } from "~/lib/tanahpedia/contributions";

const ID = "00000000-0000-4000-8000-000000000001",
	OTHER = "00000000-0000-4000-8000-000000000002";
describe("category contribution contract", () => {
	it("accepts stored prefixed identifiers without weakening discussion UUIDs", () => {
		const id = "p1000000-0000-4000-8000-000000000001";
		expect(contributionRecordId(id, "person")).toBe(id);
		expect(() => contributionRecordId("bad", "person")).toThrow("identifier");
		expect(
			validateChange({
				kind: "person_sex",
				after: { personId: id, sex: "MALE" },
			}),
		).toMatchObject({ after: { personId: id } });
	});
	it.each([
		"constructor",
		"toString",
		"__proto__",
		"DROP TABLE person",
		null,
		12,
	])("rejects unregistered kind %s", (kind) =>
		expect(isContributionRecordKind(kind)).toBe(false),
	);
	it("normalizes known fields without accepting SQL identifiers or prose columns", () => {
		expect(
			validateChange({
				kind: "person_name",
				after: {
					personId: ID.toUpperCase(),
					name: "  כינוי  ",
					nameType: "NICKNAME",
				},
			}),
		).toEqual({
			kind: "person_name",
			targetId: undefined,
			after: {
				personId: ID,
				name: "כינוי",
				nameType: "NICKNAME",
				altGroupId: null,
			},
		});
		expect(() =>
			validateChange({
				kind: "saying_date",
				targetId: ID,
				after: { sayingDate: 57840101, content: "unreviewed prose" },
			}),
		).toThrow("Unsupported field");
		expect(() =>
			validateChange({
				kind: "animal_kind",
				after: { animalId: ID, kind: "invented" },
			}),
		).toThrow("invalid option");
	});
	it.each([
		null,
		[],
		"text",
		{},
		{ kind: "person_sex", after: [] },
		{ kind: "person_sex", after: { personId: "bad", sex: "MALE" } },
		{ kind: "person_sex", targetId: "bad", after: null },
		{ kind: "person_sex", after: null },
	])("rejects malformed operations %j", (value) =>
		expect(() => validateChange(value)).toThrow(),
	);
	it("requires existing targets for date-only edits and forbids deleting a saying", () => {
		expect(() =>
			validateContributionRecord({
				kind: "saying_date",
				after: { sayingDate: 0 },
			}),
		).toThrow("existing");
		expect(() =>
			validateChange({ kind: "saying_date", targetId: ID, after: null }),
		).toThrow("deletion");
		expect(
			validateChange({
				kind: "saying_date",
				targetId: ID,
				after: { sayingDate: null },
			}),
		).toMatchObject({ after: { sayingDate: null } });
		expect(() =>
			validateContributionRecord({ kind: "bad", after: {} }),
		).toThrow("Unsupported");
	});
	const birth = CONTRIBUTION_RECORDS.person_birth_date.fields.birthDate;
	it.each([0, 57840000, 57840100, 57840101, 101, 99991229])(
		"accepts partial Hebrew date %s",
		(date) => expect(validateContributionField(date, birth)).toBe(date),
	);
	it.each([
		-1,
		-10,
		57841501,
		57840131,
		57840001,
		100000000,
		1.2,
		Infinity,
		"57840101",
	])("rejects malformed birth date %s", (date) =>
		expect(() => validateContributionField(date, birth)).toThrow(),
	);
	it("limits the not-yet sentinel to death dates", () =>
		expect(
			validateContributionField(
				-1,
				CONTRIBUTION_RECORDS.person_death_date.fields.deathDate,
			),
		).toBe(-1));
	it.each([
		"../model.glb",
		"models/../model.glb",
		"/model.glb",
		"https://example.com/x.glb",
		"models\\x.glb",
		"%2e%2e/model.glb",
		"model%00.glb",
		"model%7f.glb",
		"%broken",
	])("rejects unsafe model key %s", (key) =>
		expect(() =>
			validateContributionField(
				key,
				CONTRIBUTION_RECORDS.model_3d.fields.blobKey,
			),
		).toThrow(),
	);
	it("accepts a stored asset reference without fetching or changing access", () =>
		expect(
			validateContributionField(
				"models/מזבח.glb",
				CONTRIBUTION_RECORDS.model_3d.fields.blobKey,
			),
		).toBe("models/מזבח.glb"));
	it("validates booleans, identifiers, integer bounds and required text strictly", () => {
		expect(() =>
			validateContributionField(
				1,
				CONTRIBUTION_RECORDS.prophecy_quality.fields.isGood,
			),
		).toThrow("boolean");
		expect(() =>
			validateContributionField(
				"1",
				CONTRIBUTION_RECORDS.book_identification.fields.tanahSeferId,
			),
		).toThrow("identifier");
		expect(() =>
			validateContributionField(
				0,
				CONTRIBUTION_RECORDS.book_identification.fields.tanahSeferId,
			),
		).toThrow("identifier");
		expect(() =>
			validateContributionField(
				7,
				CONTRIBUTION_RECORDS.plant_creation.fields.creationDay,
			),
		).toThrow("integer");
		expect(() =>
			validateContributionField(
				null,
				CONTRIBUTION_RECORDS.person_name.fields.name,
			),
		).toThrow("required");
		expect(() =>
			validateContributionField(
				"x".repeat(256),
				CONTRIBUTION_RECORDS.person_name.fields.name,
			),
		).toThrow("text");
		expect(
			validateContributionField(
				false,
				CONTRIBUTION_RECORDS.prophecy_quality.fields.isGood,
			),
		).toBe(false);
	});
	it("rejects circular origins and half-specified verse segments", () => {
		expect(() =>
			validateChange({
				kind: "nation_origin",
				after: { nationId: ID, sourceNationId: ID },
			}),
		).toThrow("itself");
		const after = {
			entityId: ID,
			perekId: 1,
			pasukNumber: 1,
			segmentStart: 0,
			segmentEnd: null,
		};
		expect(() => validateChange({ kind: "entity_source", after })).toThrow(
			"segment",
		);
		expect(() =>
			validateChange({
				kind: "entity_source",
				after: { ...after, segmentStart: 2, segmentEnd: 1 },
			}),
		).toThrow("segment");
	});
	it("validates aliases as complete, sorted target sets with disambiguation labels", () => {
		const targets = [
			{ entryId: OTHER, label: "אחר" },
			{ entryId: ID, label: "ראשון" },
		];
		expect(
			validateChange({
				kind: "alias_mapping",
				after: { name: " שם ", targets },
			}),
		).toMatchObject({
			after: { name: "שם", targets: [targets[1], targets[0]] },
		});
		for (const after of [
			{ name: "אישים", targets },
			{ name: "a/b", targets },
			{ name: "שם", targets: [] },
			{ name: "שם", targets: [targets[0], targets[0]] },
			{ name: "שם", targets: [targets[0], { entryId: ID, label: "" }] },
			{
				name: "שם",
				targets: [{ entryId: ID, label: "", content: "forbidden" }],
			},
		])
			expect(() => validateChange({ kind: "alias_mapping", after })).toThrow();
	});
	const source = {
		targetKind: "person_birth_date",
		targetId: ID,
		sourceType: "tanah",
		perekId: 1,
		pasukNumber: 2,
		perushId: null,
		sourceText: null,
	};
	it("attaches sources to existing typed facts and rejects mixed citation shapes", () => {
		expect(
			validateChange({ kind: "source_reference", after: source }),
		).toMatchObject({ after: source });
		expect(
			validateChange({
				kind: "source_reference",
				after: {
					...source,
					sourceType: "other",
					perekId: null,
					pasukNumber: null,
					sourceText: "מקור חיצוני",
				},
			}),
		).toMatchObject({ after: { sourceText: "מקור חיצוני" } });
		for (const after of [
			{ ...source, targetKind: "constructor" },
			{ ...source, targetKind: "saying_date" },
			{ ...source, sourceType: "invented" },
			{ ...source, perekId: null },
			{ ...source, pasukNumber: 177 },
			{ ...source, perushId: 0 },
			{ ...source, sourceText: "mixed" },
			{ ...source, sourceType: "other" },
			{ ...source, content: "forbidden" },
		])
			expect(() =>
				validateChange({ kind: "source_reference", after }),
			).toThrow();
		expect(() =>
			validateChange({ kind: "source_reference", after: null }),
		).toThrow("target");
		expect(
			validateChange({ kind: "source_reference", targetId: ID, after: null }),
		).toMatchObject({ after: null });
	});
});
