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
	describe("dedication changes", () => {
		it("preserves every old and new scope in one validated event", () => {
			const change = {
				kind: "dedication",
				id: 7,
				perekRanges: [
					{ low: 49, high: 51 },
					{ low: 929, high: 929 },
				],
				seferIds: [1, 2],
				helekIds: [1, 3],
				parashaIds: [4],
				articleIds: [12],
				entryIds: ["persons#abraham"],
				masora: true,
			};
			expect(parseEntityChanges({ changes: [change] })).toEqual([change]);
		});

		it.each([undefined, null])(
			"accepts absent optional scopes (%s)",
			(value) => {
				const [change] = parseEntityChanges({
					changes: [
						{
							kind: "dedication",
							id: 1,
							perekRanges: value,
							seferIds: value,
							helekIds: value,
							parashaIds: value,
							articleIds: value,
							entryIds: value,
							masora: value,
						},
					],
				});
				expect(change).toEqual({
					kind: "dedication",
					id: 1,
					perekRanges: undefined,
					seferIds: undefined,
					helekIds: undefined,
					parashaIds: undefined,
					articleIds: undefined,
					entryIds: undefined,
					masora: undefined,
				});
			},
		);

		it("accepts empty scope lists and an explicit false masora flag", () => {
			const change = {
				kind: "dedication",
				id: 1,
				perekRanges: [],
				seferIds: [],
				helekIds: [],
				parashaIds: [],
				articleIds: [],
				entryIds: [],
				masora: false,
			};
			expect(parseEntityChanges({ changes: [change] })).toEqual([change]);
		});

		it("accepts the maximum range-list size", () => {
			const perekRanges = Array.from({ length: 512 }, (_, i) => ({
				low: i + 1,
				high: i + 1,
			}));
			expect(
				parseEntityChanges({
					changes: [{ kind: "dedication", id: 1, perekRanges }],
				})[0],
			).toMatchObject({ perekRanges });
		});

		it("accepts the full canonical corpus without changing legacy range semantics", () => {
			const change = {
				kind: "dedication",
				id: 1,
				perekRanges: [{ low: 1, high: 929 }],
			};
			expect(parseEntityChanges({ changes: [change] })).toEqual([
				expect.objectContaining(change),
			]);
		});

		it.each([
			[{ low: 930, high: 930 }, "low"],
			[{ low: 1, high: 930 }, "high"],
			[{ low: 1, high: 1_000_000_000 }, "high"],
			[{ low: Number.MAX_SAFE_INTEGER, high: Number.MAX_SAFE_INTEGER }, "low"],
		])(
			"rejects an out-of-corpus range %j before expanding its members",
			(range, field) => {
				expect(() =>
					parseEntityChanges({
						changes: [{ kind: "dedication", id: 1, perekRanges: [range] }],
					}),
				).toThrow(
					`changes[0].perekRanges[0].${field}: expected perek id 1..929`,
				);
			},
		);

		it.each([
			["id", 0, "changes[0].id: expected positive integer"],
			["perekRanges", {}, "changes[0].perekRanges: expected an array"],
			[
				"perekRanges",
				Array.from({ length: 513 }, () => ({ low: 1, high: 1 })),
				"changes[0].perekRanges: expected an array",
			],
			["perekRanges", [null], "changes[0].perekRanges[0]: expected object"],
			[
				"perekRanges",
				[{ low: 0, high: 1 }],
				"changes[0].perekRanges[0].low: expected positive integer",
			],
			[
				"perekRanges",
				[{ low: 1, high: 1.5 }],
				"changes[0].perekRanges[0].high: expected positive integer",
			],
			[
				"perekRanges",
				[{ low: 3, high: 2 }],
				"changes[0].perekRanges[0]: high before low",
			],
			["seferIds", ["1"], "changes[0].seferIds[0]: expected positive integer"],
			["helekIds", [-1], "changes[0].helekIds[0]: expected positive integer"],
			["parashaIds", false, "changes[0].parashaIds: expected an array"],
			[
				"articleIds",
				[null],
				"changes[0].articleIds[0]: expected positive integer",
			],
			["entryIds", [""], "changes[0].entryIds[0]: expected non-empty string"],
			["masora", "true", "changes[0].masora: expected boolean"],
		])("rejects invalid %s with its payload path", (field, value, message) => {
			expect(() =>
				parseEntityChanges({
					changes: [
						{ kind: "dedication", id: 1, [field as string]: value },
						{ kind: "dedication", id: 2, masora: true },
					],
				}),
			).toThrow(message as string);
		});
	});

	it("rejects non-object bodies", () => {
		for (const body of [null, 42, "x", []]) {
			expect(() => parseEntityChanges(body)).toThrow(ChangeValidationError);
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
		const changes = Array.from({ length: MAX_CHANGES_PER_REQUEST + 1 }, () => ({
			kind: "author",
			id: 1,
			name: "x",
		}));
		expect(() => parseEntityChanges({ changes })).toThrow(
			ChangeValidationError,
		);
	});

	it("rejects an unknown change kind", () => {
		expect(() => parseEntityChanges({ changes: [{ kind: "bogus" }] })).toThrow(
			ChangeValidationError,
		);
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
						coveringSpans: [{ perekId: 9, pasukFrom: 2, pasukTo: 4 }],
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
						coveringSpans: [{ perekId: 9, pasukFrom: 5, pasukTo: 2 }],
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

	it("rejects non-array optional lists", () => {
		expect(() =>
			parseEntityChanges({
				changes: [
					{
						kind: "pedia-entry",
						uniqueName: "x",
						entityTypes: "PERSON",
					},
				],
			}),
		).toThrow(ChangeValidationError);
		expect(() =>
			parseEntityChanges({
				changes: [
					{
						kind: "article",
						id: 1,
						perekIds: [1],
						coveringSpans: "x",
					},
				],
			}),
		).toThrow(ChangeValidationError);
	});

	it("rejects oversized string and span lists", () => {
		expect(() =>
			parseEntityChanges({
				changes: [
					{
						kind: "pedia-entry",
						uniqueName: "x",
						entityTypes: Array.from({ length: 513 }, () => "y"),
					},
				],
			}),
		).toThrow(ChangeValidationError);
		expect(() =>
			parseEntityChanges({
				changes: [
					{
						kind: "article",
						id: 1,
						perekIds: [1],
						coveringSpans: Array.from({ length: 513 }, () => ({
							perekId: 1,
							pasukFrom: 1,
							pasukTo: 1,
						})),
					},
				],
			}),
		).toThrow(ChangeValidationError);
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
			expect(() => parseEntityChanges({ changes: [change] })).toThrow(
				ChangeValidationError,
			);
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
