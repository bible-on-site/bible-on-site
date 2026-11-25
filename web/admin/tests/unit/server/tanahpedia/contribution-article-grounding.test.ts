import { createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import type { ArticleLinkCommand } from "~/lib/tanahpedia/contribution-article-links";
import type {
	ChangeInput,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { assertCurrentAgentArticleGrounding } from "~/server/tanahpedia/contribution-article-grounding.server";
import type { ModelCatalogue } from "~/server/tanahpedia/contribution-llm.server";

const mocks = vi.hoisted(() => ({ article: vi.fn(), perek: vi.fn() }));
vi.mock("~/server/tanahpedia/contribution-article-links.server", () => ({
	readArticleLinkContext: mocks.article,
}));
vi.mock("~/server/tanahpedia/contribution-perek-reads.server", () => ({
	readAgentPerek: mocks.perek,
}));

const conn = { marker: "current-transaction" } as unknown as PoolConnection;
const sourceHash = "a".repeat(64);
const coordinates = {
	seferName: "בראשית",
	additionalLetter: null,
	perekInContext: 1,
	pasukCount: 31,
};
const fingerprint = createHash("sha256")
	.update(canonicalJson(coordinates))
	.digest("hex");
const point = { perekId: 1, pasuk: 26 };
const covering = (
	action: "add" | "replace" | "remove" | "clear",
	points = [point],
): ArticleLinkCommand => ({
	relationshipKey: "coveringSources",
	action,
	target: { pasukCoordinates: points },
});
const change = (
	commands = [covering("add")],
	targetId = "18",
): ChangeInput => ({ kind: "article_links", targetId, after: { commands } });
const catalogue = () =>
	({
		people: [],
		places: [],
		entities: [],
		targets: [],
		articleGroundings: [
			{
				articleId: "18",
				sourceHash,
				coordinates: [point],
				chapters: [{ id: 1, fingerprint }],
			},
		],
	}) satisfies ModelCatalogue;
const previous = (targetId = "18"): ReviewedChange => ({
	kind: "article_links",
	targetId,
	before: null,
	after: {
		commands: [
			{
				relationshipKey: "coveringSources",
				action: "add",
				target: { pasukCoordinates: [{ perekId: 1, pasuk: 26 }] },
			},
		],
	},
	labels: {},
});

describe("current literal grounding before generated PR writes", () => {
	beforeEach(() => {
		mocks.article
			.mockReset()
			.mockResolvedValue({ state: { sourceHash, coveringSources: [] } });
		mocks.perek
			.mockReset()
			.mockResolvedValue({ id: 1, name: "בראשית א", coordinates });
	});
	it("checks current article and physical chapter identity for a new literal point", async () => {
		await assertCurrentAgentArticleGrounding(conn, [change()], catalogue());
		expect(mocks.article).toHaveBeenCalledWith(conn, "18", { current: true });
		expect(mocks.perek).toHaveBeenCalledWith(conn, 1, true);
	});
	it("ignores nonarticle changes and nonadding article intents", async () => {
		await assertCurrentAgentArticleGrounding(
			conn,
			[
				{ kind: "metadata", targetId: "entry", after: { displayName: "Name" } },
				change([
					covering("remove"),
					covering("clear", []),
					{
						relationshipKey: "primaryPerek",
						action: "replace",
						target: { perekId: 2 },
					},
				]),
				change([covering("replace", [])]),
			],
			catalogue(),
		);
		expect(mocks.article).not.toHaveBeenCalled();
		expect(mocks.perek).not.toHaveBeenCalled();
	});
	it("rejects an unrelated point even if the chapter identity was read", async () => {
		await expect(
			assertCurrentAgentArticleGrounding(
				conn,
				[change([covering("add", [{ perekId: 1, pasuk: 1 }])])],
				catalogue(),
			),
		).rejects.toThrow("explicit literal citations");
		expect(mocks.perek).not.toHaveBeenCalled();
	});
	it("rejects a changed article source before reading citation chapters", async () => {
		mocks.article.mockResolvedValue({
			state: { sourceHash: "b".repeat(64), coveringSources: [] },
		});
		await expect(
			assertCurrentAgentArticleGrounding(conn, [change()], catalogue()),
		).rejects.toThrow("explicit literal citations");
		expect(mocks.perek).not.toHaveBeenCalled();
	});
	it("rejects a removed physical chapter", async () => {
		mocks.perek.mockResolvedValue(null);
		await expect(
			assertCurrentAgentArticleGrounding(conn, [change()], catalogue()),
		).rejects.toThrow("chapter changed");
	});
	it("rejects a bounds-only chapter change with the same public name", async () => {
		mocks.perek.mockResolvedValue({
			id: 1,
			name: "בראשית א",
			coordinates: { ...coordinates, pasukCount: 25 },
		});
		await expect(
			assertCurrentAgentArticleGrounding(conn, [change()], catalogue()),
		).rejects.toThrow("chapter changed");
	});
	it("requires a chapter fingerprint for each newly grounded point", async () => {
		const missing = catalogue();
		missing.articleGroundings[0].chapters = [];
		await expect(
			assertCurrentAgentArticleGrounding(conn, [change()], missing),
		).rejects.toThrow("chapter changed");
	});
	it("cannot hide an old stale chapter fingerprint behind another matching grounding", async () => {
		const stale = catalogue();
		stale.articleGroundings.push({
			...stale.articleGroundings[0],
			chapters: [{ id: 1, fingerprint: "old" }],
		});
		await expect(
			assertCurrentAgentArticleGrounding(conn, [change()], stale),
		).rejects.toThrow("chapter changed");
	});
	it("retains current canonical coverage without demanding a new literal read", async () => {
		mocks.article.mockResolvedValue({
			state: { sourceHash: "changed", coveringSources: [point] },
		});
		await assertCurrentAgentArticleGrounding(conn, [change()], {
			...catalogue(),
			articleGroundings: [],
		});
		expect(mocks.perek).not.toHaveBeenCalled();
	});
	it("retains only this article's current PR proposed coordinates", async () => {
		const prior = previous();
		await assertCurrentAgentArticleGrounding(
			conn,
			[change()],
			{ ...catalogue(), articleGroundings: [] },
			[prior],
		);
		expect(mocks.perek).not.toHaveBeenCalled();
		await expect(
			assertCurrentAgentArticleGrounding(
				conn,
				[change()],
				{ ...catalogue(), articleGroundings: [] },
				[previous("19")],
			),
		).rejects.toThrow("explicit literal citations");
	});
	it("locks articles in deterministic order and reuses the same current chapter read", async () => {
		const combined = catalogue();
		combined.articleGroundings.push({
			...combined.articleGroundings[0],
			articleId: "19",
		});
		await assertCurrentAgentArticleGrounding(
			conn,
			[change(undefined, "19"), change()],
			combined,
		);
		expect(mocks.article.mock.calls.map((call) => call[1])).toEqual([
			"18",
			"19",
		]);
		expect(mocks.perek).toHaveBeenCalledTimes(1);
	});
	it("propagates a current read failure without treating it as canonical permission", async () => {
		mocks.article.mockRejectedValue(new Error("current source unavailable"));
		await expect(
			assertCurrentAgentArticleGrounding(conn, [change()], catalogue()),
		).rejects.toThrow("current source unavailable");
		expect(mocks.perek).not.toHaveBeenCalled();
	});
});
