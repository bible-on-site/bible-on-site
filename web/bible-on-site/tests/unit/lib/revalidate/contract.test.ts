/**
 * @jest-environment node
 *
 * The entity-change contract is the trust boundary between the admin
 * server and the revalidate endpoint: it must fail closed — any malformed
 * item rejects the whole request before a single invalidation side effect
 * runs.
 */
import {
	ChangeValidationError,
	MAX_CHANGES_PER_REQUEST,
	parseEntityChanges,
} from "../../../../src/lib/revalidate/contract";

describe("parseEntityChanges", () => {
	it("rejects non-object bodies", () => {
		for (const body of [null, 42, "x", []]) {
			expect(() => parseEntityChanges(body)).toThrow(
				ChangeValidationError,
			);
		}
	});

	it("rejects a missing or non-array changes field", () => {
		expect(() => parseEntityChanges({})).toThrow(ChangeValidationError);
		expect(() => parseEntityChanges({ changes: "x" })).toThrow(
			ChangeValidationError,
		);
	});

	it("rejects an empty or oversized change list", () => {
		expect(() => parseEntityChanges({ changes: [] })).toThrow(
			ChangeValidationError,
		);
		const changes = Array.from(
			{ length: MAX_CHANGES_PER_REQUEST + 1 },
			() => ({ kind: "author", id: 1, name: "x" }),
		);
		expect(() => parseEntityChanges({ changes })).toThrow(
			ChangeValidationError,
		);
	});

	it("rejects an unknown change kind", () => {
		expect(() =>
			parseEntityChanges({ changes: [{ kind: "bogus" }] }),
		).toThrow(ChangeValidationError);
	});

	it("parses an article change with covering spans", () => {
		expect(
			parseEntityChanges({
				changes: [
					{
						kind: "article",
						id: 12,
						perekIds: [5, 7],
						authorIds: [3],
						coveringSpans: [
							{ perekId: 9, pasukFrom: 2, pasukTo: 4 },
						],
					},
				],
			}),
		).toEqual([
			{
				kind: "article",
				id: 12,
				perekIds: [5, 7],
				authorIds: [3],
				coveringSpans: [{ perekId: 9, pasukFrom: 2, pasukTo: 4 }],
			},
		]);
	});

	it("rejects malformed article fields", () => {
		expect(() =>
			parseEntityChanges({
				changes: [{ kind: "article", id: "x", perekIds: [1] }],
			}),
		).toThrow(ChangeValidationError);
		expect(() =>
			parseEntityChanges({
				changes: [{ kind: "article", id: 1, perekIds: ["x"] }],
			}),
		).toThrow(ChangeValidationError);
		expect(() =>
			parseEntityChanges({
				changes: [{ kind: "article", id: 1, perekIds: [0] }],
			}),
		).toThrow(ChangeValidationError);
	});

	it("rejects a reversed covering span", () => {
		expect(() =>
			parseEntityChanges({
				changes: [
					{
						kind: "article",
						id: 1,
						perekIds: [1],
						coveringSpans: [
							{ perekId: 9, pasukFrom: 5, pasukTo: 2 },
						],
					},
				],
			}),
		).toThrow(ChangeValidationError);
	});

	it("parses author, pedia-entry, pedia-entity and pedia-entries", () => {
		const changes = parseEntityChanges({
			changes: [
				{ kind: "author", id: 3, name: "רשי", oldName: "ישן" },
				{
					kind: "pedia-entry",
					uniqueName: "משה",
					oldUniqueName: "ישן",
					entityTypes: ["PERSON"],
					synonymNames: ["משה רבנו"],
					refPerekIds: [12],
				},
				{
					kind: "pedia-entity",
					entityId: "e-1",
					entityType: "PLACE",
					entryUniqueNames: ["ירושלים"],
					refPerekIds: [5],
				},
				{
					kind: "pedia-entries",
					uniqueNames: ["א", "ב"],
					entityTypes: ["NATION"],
					refPerekIds: [1],
				},
			],
		});
		expect(changes).toHaveLength(4);
		expect(changes[0].kind).toBe("author");
		expect(changes[1].kind).toBe("pedia-entry");
		expect(changes[2].kind).toBe("pedia-entity");
		expect(changes[3].kind).toBe("pedia-entries");
	});

	it("rejects invalid fields inside each kind", () => {
		const bad = [
			{ kind: "author", id: 1, name: "" },
			{ kind: "author", id: 1, name: "x", oldName: 5 },
			{ kind: "pedia-entry", uniqueName: "" },
			{ kind: "pedia-entry", uniqueName: "x", refPerekIds: ["a"] },
			{ kind: "pedia-entity", entityId: "" },
			{ kind: "pedia-entity", entityId: "e", entryUniqueNames: [1] },
			{ kind: "pedia-entries", uniqueNames: [""] },
		];
		for (const change of bad) {
			expect(() =>
				parseEntityChanges({ changes: [change] }),
			).toThrow(ChangeValidationError);
		}
	});

	it("bounds strings and lists", () => {
		expect(() =>
			parseEntityChanges({
				changes: [{ kind: "author", id: 1, name: "x".repeat(257) }],
			}),
		).toThrow(ChangeValidationError);
		expect(() =>
			parseEntityChanges({
				changes: [
					{
						kind: "article",
						id: 1,
						perekIds: Array.from({ length: 513 }, (_, i) => i + 1),
					},
				],
			}),
		).toThrow(ChangeValidationError);
	});
});
