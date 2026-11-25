import type { EntityChange } from "./index";

/**
 * Cross-consumer contract samples (#3710): one wire-shaped change per
 * kind, exercising every field the contract defines. The admin unit suite
 * asserts its typed-change builders emit exactly these shapes; the website
 * unit suite asserts `parseEntityChanges` accepts them — so a payload the
 * sender can build can never be rejected by the receiver's validator.
 * `satisfies` keeps each literal inside `EntityChange`, so a contract drift
 * fails typecheck before the suites even run.
 */
export const ENTITY_CHANGE_EXAMPLES = [
	{
		kind: "article",
		id: 12,
		perekIds: [5, 7],
		authorIds: [3, 4],
		coveringSpans: [{ perekId: 9, pasukFrom: 2, pasukTo: 4 }],
	},
	{
		kind: "author",
		id: 3,
		name: "רשי",
		oldName: "רבנו שלמה",
	},
	{
		kind: "pedia-entry",
		uniqueName: "משה",
		oldUniqueName: "משה רבנו",
		entityTypes: ["PERSON"],
		synonymNames: ["משה בן עמרם"],
		refPerekIds: [12],
	},
	{
		kind: "pedia-entity",
		entityId: "persons#abraham",
		entityType: "PERSON",
		entryUniqueNames: ["אברהם"],
		refPerekIds: [11],
	},
	{
		kind: "pedia-entries",
		uniqueNames: ["א", "ב"],
		entityTypes: ["NATION"],
		refPerekIds: [1],
	},
	{
		kind: "moed",
		id: 2,
		slug: "sukkot",
		oldSlug: "chag-haasif",
	},
	{
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
	},
] satisfies EntityChange[] as EntityChange[];
