import { describe, expect, it } from "vitest";
import {
	type ArticleLinkCommand,
	type ArticleLinkState,
	articleLinksHaveEffect,
	contributionArticleId,
	projectArticleLinks,
	validateArticleLinkChange,
	validateArticleLinkState,
} from "~/lib/tanahpedia/contribution-article-links";

const coordinate = (perekId: number, pasuk: number) => ({ perekId, pasuk });
const base = (): ArticleLinkState => ({
	contentHash: "a".repeat(32),
	sourceHash: "b".repeat(64),
	perekId: 1,
	authorId: 7,
	coverageVerified: true,
	coveringSources: [coordinate(1, 1)],
	dedicationAssignments: [
		{ dedicationId: 9, expiresAt: "2027-01-01 12:00:00" },
	],
	moedIds: [2],
});
const change = (commands: unknown[]) => ({
	kind: "article_links",
	targetId: "123",
	after: { commands },
});
const covering = (
	action: "add" | "remove" | "replace" | "clear",
	pasukCoordinates = [coordinate(1, 2)],
	coverageVerified?: boolean,
): ArticleLinkCommand => ({
	relationshipKey: "coveringSources",
	action,
	target: {
		pasukCoordinates,
		...(coverageVerified === undefined ? {} : { coverageVerified }),
	},
});
const dedication = (
	action: "add" | "remove" | "replace",
	dedicationId = 9,
	expiresAt: string | null = null,
): ArticleLinkCommand => ({
	relationshipKey: "dedicationAssignments",
	action,
	target: { dedicationId, expiresAt },
});
const moadim = (
	action: "add" | "remove" | "replace" | "clear",
	moedIds: number[],
): ArticleLinkCommand => ({
	relationshipKey: "moadim",
	action,
	target: { moedIds },
});

describe("article-link operation boundary", () => {
	it.each([
		["coveringSources", ["remove"], { pasukCoordinates: [] }],
		[
			"coveringSources",
			["clear"],
			{ pasukCoordinates: [coordinate(1, 1)], coverageVerified: true },
		],
		["moadim", ["remove"], { moedIds: [] }],
		["moadim", ["clear"], { moedIds: [2] }],
		["dedicationAssignments", ["remove"], { dedicationId: 9, expiresAt: null }],
		[
			"dedicationAssignments",
			["replace"],
			{ dedicationId: 9, expiresAt: null },
		],
		["coveringSources", null, { pasukCoordinates: [] }],
		["moadim", {}, { moedIds: [] }],
		["dedicationAssignments", true, { dedicationId: 9, expiresAt: null }],
	])(
		"rejects a non-string %s action before projection",
		(relationshipKey, action, target) => {
			expect(() =>
				validateArticleLinkChange(
					change([{ relationshipKey, action, target }]),
				),
			).toThrow(/Unsupported .*action/);
		},
	);
	it("keeps unrelated coordinates when a valid string remove is projected", () => {
		const current = {
			...base(),
			coveringSources: [coordinate(1, 1), coordinate(1, 2)],
		};
		const parsed = validateArticleLinkChange(
			change([covering("remove", [coordinate(1, 1)])]),
		);
		expect(projectArticleLinks(current, parsed.after).coveringSources).toEqual([
			coordinate(1, 2),
		]);
	});
	it.each(["1", "123", "2147483647"])(
		"accepts canonical native article ID %s",
		(id) => expect(contributionArticleId(id)).toBe(id),
	);
	it.each([
		null,
		undefined,
		1,
		"",
		"0",
		"01",
		" 1",
		"1 ",
		"+1",
		"1.5",
		"1e2",
		"2147483648",
		"99999999999",
		"00000000-0000-4000-8000-000000000001",
	])("rejects an invalid article identity %j", (id) =>
		expect(() => contributionArticleId(id)).toThrow(),
	);
	it("normalizes catalogue sets while retaining a separate current-state contract", () => {
		const input = change([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 3 },
			},
			covering("add", [coordinate(2, 4), coordinate(1, 3)], false),
			dedication("add", 8),
			moadim("add", [5, 3]),
		]);
		const parsed = validateArticleLinkChange(input);
		expect(parsed.after.commands[1]).toEqual(
			covering("add", [coordinate(1, 3), coordinate(2, 4)], false),
		);
		expect(parsed.after.commands[3]).toEqual(moadim("add", [3, 5]));
		expect(input.after.commands[3]).toEqual(moadim("add", [5, 3]));
	});
	it.each([
		null,
		[],
		{ ...change([moadim("clear", [])]), kind: "metadata" },
		{ ...change([moadim("clear", [])]), prose: "forbidden" },
		{ ...change([moadim("clear", [])]), after: null },
		{
			...change([moadim("clear", [])]),
			after: { commands: [], content: "forbidden" },
		},
		change([]),
		change(Array.from({ length: 41 }, (_, n) => moadim("add", [n + 1]))),
		change([null]),
		change([
			{ relationshipKey: "author", action: "replace", target: { authorId: 1 } },
		]),
		change([
			{ relationshipKey: "mentionAnnotations", action: "replace", target: {} },
		]),
		change([
			{
				relationshipKey: "primaryPerek",
				action: "clear",
				target: { perekId: 1 },
			},
		]),
		change([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: "1" },
			},
		]),
		change([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 1, authorId: 2 },
			},
		]),
		change([
			{ relationshipKey: "moadim", action: "execute", target: { moedIds: [] } },
		]),
		change([
			{
				relationshipKey: "moadim",
				action: "add",
				target: { moedIds: [1], sql: "forbidden" },
			},
		]),
		change([moadim("add", [])]),
		change([moadim("remove", [])]),
		change([moadim("clear", [1])]),
		change([moadim("replace", [1, 1])]),
		change([covering("add", [])]),
		change([covering("remove", [])]),
		change([covering("clear", [coordinate(1, 1)])]),
		change([covering("clear", [], true)]),
		change([covering("add", [coordinate(1, 1), coordinate(1, 1)])]),
		change([
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: {
					pasukCoordinates: [{ perekId: 1, pasuk: 1, text: "forbidden" }],
				},
			},
		]),
		change([
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: { pasukCoordinates: [coordinate(1, 0)] },
			},
		]),
		change([
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: {
					pasukCoordinates: [coordinate(1, 1)],
					coverageVerified: "true",
				},
			},
		]),
		change([
			{
				relationshipKey: "dedicationAssignments",
				action: "clear",
				target: { dedicationId: 1 },
			},
		]),
		change([dedication("add", 1, "2027-02-30 12:00:00")]),
		change([dedication("add", 1, "2027-01-01 24:00:00")]),
		change([dedication("add", 1, "2027-01-01T12:00:00Z")]),
		change([moadim("add", [1]), moadim("add", [1])]),
		change([dedication("add"), dedication("remove")]),
		change([
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 1 },
			},
			{
				relationshipKey: "primaryPerek",
				action: "replace",
				target: { perekId: 2 },
			},
		]),
	])("rejects unsupported, malformed or ambiguous commands %j", (input) =>
		expect(() => validateArticleLinkChange(input)).toThrow(),
	);
	it("accepts each explicit covering and moed intent, including empty replacement sets", () => {
		for (const action of ["add", "remove", "replace", "clear"] as const) {
			expect(
				validateArticleLinkChange(
					change([
						covering(action, action === "clear" ? [] : [coordinate(1, 2)]),
					]),
				).after.commands[0].action,
			).toBe(action);
			expect(
				validateArticleLinkChange(
					change([moadim(action, action === "clear" ? [] : [3])]),
				).after.commands[0].action,
			).toBe(action);
		}
		expect(
			validateArticleLinkChange(
				change([covering("replace", []), moadim("replace", [])]),
			),
		).toBeDefined();
		expect(
			validateArticleLinkChange(
				change([dedication("replace", 1, "2028-02-29 12:00:00")]),
			),
		).toBeDefined();
	});
});

describe("reviewed article snapshot", () => {
	it("retains content/source identity, metadata and canonical complete sets", () => {
		const input = {
			...base(),
			coveringSources: [coordinate(2, 1), coordinate(1, 1)],
			dedicationAssignments: [
				{ dedicationId: 10, expiresAt: null },
				...base().dedicationAssignments,
			],
			moedIds: [5, 2],
		};
		const parsed = validateArticleLinkState(input);
		expect(parsed).toEqual({
			...base(),
			coveringSources: [coordinate(1, 1), coordinate(2, 1)],
			dedicationAssignments: [
				...base().dedicationAssignments,
				{ dedicationId: 10, expiresAt: null },
			],
			moedIds: [2, 5],
		});
		expect(input.moedIds).toEqual([5, 2]);
	});
	it.each([
		null,
		{ ...base(), contentHash: "" },
		{ ...base(), contentHash: "A".repeat(32) },
		{ ...base(), sourceHash: "bad" },
		{ ...base(), content: "not an editable field" },
		{ ...base(), coverageVerified: "true" },
		{ ...base(), coveringSources: [] },
		{ ...base(), perekId: 0 },
		{ ...base(), authorId: 0 },
		{
			...base(),
			dedicationAssignments: [
				dedication("add").target,
				dedication("add", 9, "2027-02-01 00:00:00").target,
			],
		},
		{ ...base(), moedIds: [1, 1] },
		{
			...base(),
			coveringSources: Array.from({ length: 1001 }, (_, n) =>
				coordinate(1, n + 1),
			),
		},
	])("rejects an invalid or unrelated snapshot %j", (input) =>
		expect(() => validateArticleLinkState(input)).toThrow(),
	);
	it("allows unknown coverage only with an explicit false flag", () =>
		expect(
			validateArticleLinkState({
				...base(),
				coverageVerified: false,
				coveringSources: [],
			}).coverageVerified,
		).toBe(false));
});

describe("intent projection for diffs and rebases", () => {
	it("keeps unrelated current links on additive rebases and never mutates its inputs", () => {
		const current = {
			...base(),
			coveringSources: [coordinate(1, 1), coordinate(2, 1)],
			dedicationAssignments: [
				...base().dedicationAssignments,
				{ dedicationId: 11, expiresAt: null },
			],
			moedIds: [2, 4],
		};
		const frozen = structuredClone(current);
		const commands = [
			covering("add"),
			dedication("add", 10, "2028-03-01 00:00:00"),
			moadim("add", [3]),
		];
		const projected = projectArticleLinks(current, { commands });
		expect(projected.coveringSources).toEqual([
			coordinate(1, 1),
			coordinate(1, 2),
			coordinate(2, 1),
		]);
		expect(projected.dedicationAssignments.map((a) => a.dedicationId)).toEqual([
			9, 10, 11,
		]);
		expect(projected.moedIds).toEqual([2, 3, 4]);
		expect(projected.authorId).toBe(current.authorId);
		expect(projected.contentHash).toBe(current.contentHash);
		expect(projected.sourceHash).toBe(current.sourceHash);
		expect(current).toEqual(frozen);
	});
	it("removes only named members and forces emptied coverage to unknown", () => {
		const projected = projectArticleLinks(base(), {
			commands: [
				covering("remove", [coordinate(1, 1)], true),
				dedication("remove"),
				moadim("remove", [2]),
			],
		});
		expect(projected.coveringSources).toEqual([]);
		expect(projected.coverageVerified).toBe(false);
		expect(projected.dedicationAssignments).toEqual([]);
		expect(projected.moedIds).toEqual([]);
	});
	it("preserves verification on a nonempty removal unless explicitly reviewed otherwise", () => {
		const current = {
			...base(),
			coveringSources: [coordinate(1, 1), coordinate(1, 2)],
		};
		expect(
			projectArticleLinks(current, {
				commands: [covering("remove", [coordinate(1, 2)])],
			}).coverageVerified,
		).toBe(true);
		expect(
			projectArticleLinks(current, {
				commands: [covering("remove", [coordinate(1, 2)], false)],
			}).coverageVerified,
		).toBe(false);
	});
	it("replaces full sets only for explicit replace/clear intents", () => {
		const projected = projectArticleLinks(base(), {
			commands: [
				{
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: 4 },
				},
				covering("replace", [coordinate(3, 1)], false),
				dedication("replace", 9, null),
				moadim("replace", [6]),
			],
		});
		expect(projected.perekId).toBe(4);
		expect(projected.coveringSources).toEqual([coordinate(3, 1)]);
		expect(projected.coverageVerified).toBe(false);
		expect(projected.dedicationAssignments).toEqual([
			{ dedicationId: 9, expiresAt: null },
		]);
		expect(projected.moedIds).toEqual([6]);
		const cleared = projectArticleLinks(base(), {
			commands: [covering("clear", []), moadim("clear", [])],
		});
		expect(cleared.coveringSources).toEqual([]);
		expect(cleared.coverageVerified).toBe(false);
		expect(cleared.moedIds).toEqual([]);
	});
	it("never turns adding an existing dedication into an unreviewed expiry replacement", () =>
		expect(
			projectArticleLinks(base(), { commands: [dedication("add", 9, null)] })
				.dedicationAssignments,
		).toEqual(base().dedicationAssignments));
	it("refuses replacement of a disappeared dedication assignment", () =>
		expect(() =>
			projectArticleLinks(base(), { commands: [dedication("replace", 99)] }),
		).toThrow(/does not exist/));
	it("recognizes already-satisfied intents without reporting a new effect", () => {
		expect(
			articleLinksHaveEffect(base(), {
				commands: [
					covering("add", [coordinate(1, 1)]),
					dedication("add", 9),
					moadim("add", [2]),
				],
			}),
		).toBe(false);
		expect(
			articleLinksHaveEffect(base(), { commands: [covering("add")] }),
		).toBe(true);
	});
});
