import { beforeEach, expect, it, vi } from "vitest";
import type { ReviewedChange } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	one: vi.fn(),
	execute: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	txQuery: mocks.query,
	txQueryOne: mocks.one,
	txExecute: mocks.execute,
}));
vi.mock("~/server/tanahpedia/revisions", () => ({
	saveEntryTitleRevisioned: vi.fn(),
}));

import {
	applyContributionRecord,
	assertNoContributionDependents,
	loadContributionReference,
	structuredReferenceLabels,
	validateScriptureVerse,
} from "~/server/tanahpedia/contribution-records.server";
import {
	aliasReferenceLabels,
	applyAliasMapping,
	captureContributionSourceTarget,
	readAliasMapping,
	readContributionSourceFact,
	readSourceReference,
	sourceReferenceLabels,
	specialContributionTargets,
} from "~/server/tanahpedia/contribution-specials.server";

const conn = {} as never;
const id = "00000000-0000-4000-8000-000000000001";
const reviewed = (kind: string, before: unknown, after: unknown) =>
	({ kind, targetId: id, before, after, labels: {} }) as ReviewedChange;
const citation = {
	targetKind: "entity",
	targetId: id,
	sourceType: "other",
	sourceText: "Source",
	perekId: null,
	pasukNumber: null,
	perushId: null,
};
it("retains the first nonempty disambiguation label while accepting legacy null labels", async () => {
	mocks.one.mockResolvedValueOnce({ name: "Alias" });
	mocks.query
		.mockResolvedValueOnce([{ id, entryId: id }])
		.mockResolvedValueOnce([
			{ entryId: id, label: null },
			{ entryId: id, label: "First" },
			{ entryId: id, label: "Later" },
		]);
	await expect(readAliasMapping(conn, id)).resolves.toEqual({
		name: "Alias",
		targets: [{ entryId: id, label: "First" }],
	});
});
it("renders a source-backed relationship even when a legacy related-person label is unavailable", async () => {
	mocks.one
		.mockResolvedValueOnce({ parentId: id })
		.mockResolvedValueOnce(null)
		.mockResolvedValueOnce({ id });
	await expect(
		sourceReferenceLabels(conn, { ...citation, targetKind: "parent_child" }),
	).resolves.toEqual({ [`targetId:${id}`]: "parent_child" });
});
it("accepts chapter-level references without requiring a commentary", async () => {
	mocks.one
		.mockResolvedValueOnce({ id })
		.mockResolvedValueOnce({ name: "Target" })
		.mockResolvedValueOnce({
			id: 1,
			seferName: "בראשית",
			perekInContext: 1,
			additionalLetter: null,
		});
	const labels = await sourceReferenceLabels(conn, {
		...citation,
		sourceType: "tanah",
		perekId: 1,
	});
	expect(labels).not.toHaveProperty("perushId:null");
	expect(mocks.one).toHaveBeenCalledTimes(3);
});
beforeEach(() => {
	vi.resetAllMocks();
	mocks.query.mockResolvedValue([]);
	mocks.one.mockResolvedValue(null);
});
it("rejects unsupported or disappeared source facts and alias destinations", async () => {
	await expect(
		readContributionSourceFact(conn, "unregistered", id),
	).rejects.toThrow("Unsupported source fact");
	await expect(
		captureContributionSourceTarget(conn, {
			...citation,
			targetKind: "person_birth_date",
		}),
	).rejects.toThrow("no longer exists");
	await expect(
		aliasReferenceLabels(conn, {
			name: "Alias",
			targets: [{ entryId: id, label: "" }],
		}),
	).rejects.toThrow("target entry does not exist");
	await expect(
		sourceReferenceLabels(conn, { ...citation, targetKind: "unregistered" }),
	).rejects.toThrow("Unsupported source target");
	await expect(sourceReferenceLabels(conn, citation)).rejects.toThrow(
		"target does not exist",
	);
});
it("requires an existing scripture chapter and commentary for an attachment", async () => {
	mocks.one
		.mockResolvedValueOnce({ id })
		.mockResolvedValueOnce({ name: "Target" });
	await expect(
		sourceReferenceLabels(conn, {
			...citation,
			sourceType: "tanah",
			perekId: 1,
		}),
	).rejects.toThrow("Scripture chapter does not exist");
	mocks.one
		.mockResolvedValueOnce({ id })
		.mockResolvedValueOnce({ name: "Target" })
		.mockResolvedValueOnce({
			id: 1,
			seferName: "בראשית",
			perekInContext: 1,
			additionalLetter: null,
		});
	await expect(
		sourceReferenceLabels(conn, {
			...citation,
			sourceType: "tanah",
			perekId: 1,
			perushId: 1,
		}),
	).rejects.toThrow("Commentary does not exist");
});
it("retains an existing root attachment when an optional display label is missing", async () => {
	mocks.one.mockResolvedValueOnce({ id });
	await expect(sourceReferenceLabels(conn, citation)).resolves.toEqual({});
});
it("omits ambiguous source identifiers and unknown attachment kinds from the model catalogue", async () => {
	mocks.query
		.mockResolvedValueOnce([{ id, name: "Alias", entryId: id }])
		.mockResolvedValueOnce([
			{ name: "Missing alias", entryId: id, label: "Unknown" },
			{ name: "Alias", entryId: id, label: null },
			{ name: "Alias", entryId: id, label: "Retained" },
			{ name: "Alias", entryId: id, label: "Later duplicate" },
		])
		.mockResolvedValueOnce([
			{
				id: "ambiguous",
				targetTable: "tanahpedia_entity",
				targetId: id,
				perekId: 1,
			},
			{ id: "unknown", targetTable: "unregistered", targetId: id },
			{
				id: "chapter",
				targetTable: "tanahpedia_entity",
				targetId: id,
				perekId: 1,
				pasukNumber: null,
			},
		])
		.mockResolvedValueOnce([
			{
				id: "ambiguous",
				targetTable: "tanahpedia_entity",
				targetId: id,
				sourceText: "Other source",
			},
		]);
	const targets = await specialContributionTargets(conn);
	expect(targets.map((target) => target.id)).toEqual([id, "chapter"]);
	expect(targets[0].after).toEqual({
		name: "Alias",
		targets: [{ entryId: id, label: "Retained" }],
	});
	expect(targets[1].label).toBe("1 / ");
});
it("handles missing chapter references and refuses unknown reference contracts", async () => {
	await expect(loadContributionReference(conn, "perek", 1)).resolves.toBeNull();
	await expect(loadContributionReference(conn, "unknown", id)).rejects.toThrow(
		"Missing reference contract",
	);
	await expect(validateScriptureVerse(conn, 1, null)).resolves.toBeUndefined();
});
it("rejects absent referenced people and missing canonical lookup values before writing", async () => {
	await expect(
		structuredReferenceLabels(conn, "person_birth_date", { personId: id }),
	).rejects.toThrow("does not exist");
	mocks.one
		.mockResolvedValueOnce({ id, name: "Person" })
		.mockResolvedValueOnce(null);
	await expect(
		applyContributionRecord(
			conn,
			reviewed("person_name", null, {
				personId: id,
				name: "Name",
				nameType: "ADDITIONAL",
				altGroupId: null,
			}),
		),
	).rejects.toThrow("Missing canonical lookup value");
	expect(mocks.execute).not.toHaveBeenCalled();
});
it("refuses insertion through an operation whose contract permits existing rows only", async () => {
	await expect(
		applyContributionRecord(
			conn,
			reviewed("saying_date", null, { sayingDate: 57840101 }),
		),
	).rejects.toThrow("An existing target is required");
	expect(mocks.execute).not.toHaveBeenCalled();
});

it.each([
	{ tableName: "users; DROP TABLE users", columnName: "owner_id" },
	{ tableName: "tanahpedia_fact", columnName: "id` OR 1=1" },
])(
	"refuses unsafe dependent-schema identifiers before issuing dynamic SQL: %j",
	async (key) => {
		mocks.query.mockResolvedValue([key]);
		await expect(
			assertNoContributionDependents(conn, "tanahpedia_entity", id),
		).rejects.toThrow("Unsupported dependent table");
		expect(mocks.one).not.toHaveBeenCalled();
		expect(mocks.execute).not.toHaveBeenCalled();
	},
);

it.each([
	["unknown", null, { name: "value" }, "Unsupported structured operation"],
	["entry_title", { title: "Before" }, null, "An entry title is required"],
	[
		"entry_title",
		{ title: "Before" },
		{ title: 42 },
		"An entry title is required",
	],
	["king_role", { personId: "before" }, { personId: "after" }, "owner"],
])(
	"rejects invalid %s operations before writes",
	async (kind, before, after, message) => {
		await expect(
			applyContributionRecord(conn, reviewed(String(kind), before, after)),
		).rejects.toThrow(String(message));
		expect(mocks.execute).not.toHaveBeenCalled();
	},
);

it.each([
	[null, null, "Missing alias name"],
	[
		{ name: "old", targets: [] },
		{ name: "new", targets: [] },
		"separate alias",
	],
])(
	"refuses ambiguous alias mutations before deleting routes",
	async (before, after, message) => {
		await expect(
			applyAliasMapping(conn, reviewed("alias_mapping", before, after)),
		).rejects.toThrow(String(message));
		expect(mocks.execute).not.toHaveBeenCalled();
	},
);

it("requires manual repair for IDs shared by both citation tables", async () => {
	mocks.one.mockResolvedValue({
		targetTable: "tanahpedia_entity",
		targetId: id,
	});
	await expect(readSourceReference(conn, id)).rejects.toThrow(
		"Ambiguous source ID",
	);
});

it("refuses unsupported source targets and reads a missing citation as absent", async () => {
	mocks.one.mockResolvedValueOnce({
		targetTable: "unregistered_table",
		targetId: id,
	});
	await expect(readSourceReference(conn, id)).rejects.toThrow(
		"Unsupported existing source attachment target",
	);
	await expect(readSourceReference(conn, id)).resolves.toBeNull();
});
