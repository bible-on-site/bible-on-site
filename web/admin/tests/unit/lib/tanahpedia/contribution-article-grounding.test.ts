import { describe, expect, it } from "vitest";
import {
	type ArticleLiteralGrounding,
	allowedLiteralArticleCoordinates,
	assertLiteralArticleCoverage,
	expandLiteralCitationCoordinates,
} from "~/lib/tanahpedia/contribution-article-grounding";
import type {
	ArticleLinkChangeInput,
	ArticleLinkCommand,
} from "~/lib/tanahpedia/contribution-article-links";
import type { ReviewedChange } from "~/lib/tanahpedia/contributions";

const point = (perekId: number, pasuk: number) => ({ perekId, pasuk });
const hash = "a".repeat(64);
const state = { sourceHash: hash, coveringSources: [point(7, 3)] };
const grounding = (
	coordinates = [point(1, 26)],
	articleId = "18",
	sourceHash = hash,
): ArticleLiteralGrounding => ({
	articleId,
	sourceHash,
	coordinates,
	chapters: [{ id: 1, fingerprint: "trusted-current-chapter" }],
});
const covering = (
	action: "add" | "replace" | "remove" | "clear",
	pasukCoordinates = [point(1, 26)],
): ArticleLinkCommand => ({
	relationshipKey: "coveringSources",
	action,
	target: { pasukCoordinates },
});
const change = (
	commands = [covering("add")],
	targetId = "18",
): ArticleLinkChangeInput => ({
	kind: "article_links",
	targetId,
	after: { commands },
});

describe("literal citation coordinates", () => {
	it("expands inclusive ranges, deduplicates overlaps and sorts exact pairs", () => {
		expect(
			expandLiteralCitationCoordinates([
				{ perekId: 2, pasuk: 4, pasukTo: 5 },
				{ perekId: 1, pasuk: 26, pasukTo: 26 },
				{ perekId: 2, pasuk: 3, pasukTo: 4 },
			]),
		).toEqual([point(1, 26), point(2, 3), point(2, 4), point(2, 5)]);
	});
	it("accepts the shared thirty-verse boundary and an empty extraction", () => {
		expect(
			expandLiteralCitationCoordinates([
				{ perekId: 1, pasuk: 10, pasukTo: 39 },
			]),
		).toHaveLength(30);
		expect(expandLiteralCitationCoordinates([])).toEqual([]);
	});
	it.each([
		{ perekId: 0, pasuk: 1, pasukTo: 1 },
		{ perekId: 1.5, pasuk: 1, pasukTo: 1 },
		{ perekId: 2147483648, pasuk: 1, pasukTo: 1 },
		{ perekId: 1, pasuk: 0, pasukTo: 1 },
		{ perekId: 1, pasuk: 2, pasukTo: 1 },
		{ perekId: 1, pasuk: 1, pasukTo: 31 },
		{ perekId: 1, pasuk: 1, pasukTo: Infinity },
		{ perekId: 1, pasuk: 1, pasukTo: 1.5 },
	])("rejects an invalid range before expansion: %j", (citation) => {
		expect(() => expandLiteralCitationCoordinates([citation])).toThrow(
			"Invalid literal citation range",
		);
	});
});

describe("trusted literal article coverage boundary", () => {
	it("allows literal verse twenty-six without allowing verse one", () => {
		expect(() =>
			assertLiteralArticleCoverage(change(), state, [grounding()]),
		).not.toThrow();
		expect(() =>
			assertLiteralArticleCoverage(
				change([covering("add", [point(1, 1)])]),
				state,
				[grounding()],
			),
		).toThrow("Article coverage additions require explicit literal citations");
	});
	it("never forms a Cartesian product from permitted chapters and verses", () => {
		const trusted = [grounding([point(1, 26), point(2, 10)])];
		expect(() =>
			assertLiteralArticleCoverage(
				change([covering("replace", [point(1, 26), point(2, 10)])]),
				state,
				trusted,
			),
		).not.toThrow();
		for (const forbidden of [point(1, 10), point(2, 26)])
			expect(() =>
				assertLiteralArticleCoverage(
					change([covering("add", [forbidden])]),
					state,
					trusted,
				),
			).toThrow("explicit literal citations");
	});
	it("requires both exact article identity and exact source hash", () => {
		expect(
			allowedLiteralArticleCoordinates("18", state, [
				grounding([point(1, 26)], "19"),
				grounding([point(1, 27)], "18", "b".repeat(64)),
				grounding([point(2, 10)]),
			]),
		).toEqual([point(2, 10), point(7, 3)]);
	});
	it("unites matching source pages without mutating trusted inputs", () => {
		const first = grounding([point(2, 10), point(1, 26)]);
		const second = grounding([point(1, 26), point(2, 11)]);
		const before = JSON.stringify([state, first, second]);
		expect(
			allowedLiteralArticleCoordinates("18", state, [first, second]),
		).toEqual([point(1, 26), point(2, 10), point(2, 11), point(7, 3)]);
		expect(JSON.stringify([state, first, second])).toBe(before);
	});
	it("retains existing canonical coordinates even without a readable source", () => {
		expect(() =>
			assertLiteralArticleCoverage(
				change([covering("replace", [point(7, 3)])]),
				{ coveringSources: [point(7, 3)] },
				[],
			),
		).not.toThrow();
	});
	it.each([null, undefined, {}, [], "article", { sourceHash: 9 }])(
		"does not grant a literal coordinate from unknown current state %j",
		(current) => {
			expect(
				allowedLiteralArticleCoordinates("18", current, [grounding()]),
			).toEqual([]);
		},
	);
	it("ignores malformed and held coordinates instead of inventing support", () => {
		expect(
			allowedLiteralArticleCoordinates(
				"18",
				{
					sourceHash: hash,
					coveringSources: [null, { perekId: 1 }, point(0, 2)],
				},
				[grounding([point(1, 26), point(2, -1), point(3, Number.NaN)])],
			),
		).toEqual([point(1, 26)]);
	});
	it.each(["add", "replace"] as const)(
		"retains current PR's prior %s points when the current source changed",
		(action) => {
			const prior = change([covering(action, [point(3, 9)])]);
			expect(() =>
				assertLiteralArticleCoverage(
					change([covering("replace", [point(3, 9)])]),
					state,
					[],
					[prior],
				),
			).not.toThrow();
		},
	);
	it("accepts reviewed prior changes and preserves only this article", () => {
		const prior: ReviewedChange = {
			...change([covering("add", [point(3, 9)])]),
			before: null,
			after: {
				commands: [covering("add", [point(3, 9)])],
			} as ReviewedChange["after"],
			labels: {},
		};
		expect(
			allowedLiteralArticleCoordinates(
				"18",
				state,
				[],
				[
					prior,
					change([covering("add", [point(4, 10)])], "19"),
					{ kind: "metadata", targetId: "18", after: { displayName: "name" } },
				],
			),
		).toEqual([point(3, 9), point(7, 3)]);
	});
	it("does not treat prior removals or clears as permission to add", () => {
		expect(
			allowedLiteralArticleCoordinates(
				"18",
				state,
				[],
				[
					change([covering("remove", [point(1, 26)])]),
					change([covering("clear", [point(2, 10)])]),
				],
			),
		).toEqual([point(7, 3)]);
	});
	it("does not grant coordinates from a previous deleted or absent operation body", () => {
		const removed: ReviewedChange = {
			kind: "article_links",
			targetId: "18",
			before: null,
			after: null,
			labels: {},
		};
		expect(
			allowedLiteralArticleCoordinates("18", state, [], [removed]),
		).toEqual([point(7, 3)]);
	});
	it("leaves removals, clear and independent metadata intents unrestricted", () => {
		expect(() =>
			assertLiteralArticleCoverage(
				change([
					covering("remove", [point(9, 9)]),
					covering("clear", []),
					{
						relationshipKey: "primaryPerek",
						action: "replace",
						target: { perekId: 9 },
					},
					{
						relationshipKey: "moadim",
						action: "add",
						target: { moedIds: [5] },
					},
					{
						relationshipKey: "dedicationAssignments",
						action: "add",
						target: { dedicationId: 5, expiresAt: null },
					},
				]),
				undefined,
				[],
			),
		).not.toThrow();
	});
	it("checks every adding command, not just the first permitted one", () => {
		expect(() =>
			assertLiteralArticleCoverage(
				change([covering("add"), covering("replace", [point(1, 1)])]),
				state,
				[grounding()],
			),
		).toThrow("explicit literal citations");
	});
});
