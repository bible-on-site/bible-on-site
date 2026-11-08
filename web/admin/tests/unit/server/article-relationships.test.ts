import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
	queryMock: vi.fn(),
	queryOneMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("~/server/db", () => ({
	query: queryMock,
	queryOne: queryOneMock,
}));

import { getArticleRelationshipDetails } from "~/server/article-relationships";

const noSuchTable = Object.assign(new Error("missing table"), {
	code: "ER_NO_SUCH_TABLE",
});

describe("getArticleRelationshipDetails", () => {
	beforeEach(() => {
		queryMock.mockReset().mockResolvedValue([]);
		queryOneMock.mockReset();
	});

	it("rejects when the article does not exist", async () => {
		queryOneMock.mockResolvedValueOnce(null);
		await expect(
			getArticleRelationshipDetails({ data: 999 }),
		).rejects.toThrow("Article not found");
	});

	it("aggregates dedication links and mention annotations", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 }) // exists check
			.mockResolvedValueOnce({ h: "ABCDEF0123" }); // HEX(content_hash)
		queryMock
			.mockResolvedValueOnce([
				{
					dedication_id: 5,
					subject: "לעילוי נשמת",
					expires_at: "2030-01-02 03:04:05",
					dedication_expires_at: null,
				},
			])
			.mockResolvedValueOnce([
				{
					id: "ann-1",
					intended_name: "אברהם",
					entity_type: "PERSON",
					disambiguation: null,
					confidence: "0.92",
					acceptance: "manual",
					model_revision: "rev-1",
					span_start: 3,
					span_end: 9,
					surface: "אברהם אבינו",
					content_hash: "c".repeat(64),
					current_content: 1,
				},
			]);

		const details = await getArticleRelationshipDetails({ data: 7 });
		expect(details.articleId).toBe(7);
		expect(details.contentHash).toBe("abcdef0123");
		expect(details.dedications).toEqual([
			{
				dedicationId: 5,
				subject: "לעילוי נשמת",
				expiresAt: "2030-01-02 03:04:05",
				dedicationExpiresAt: null,
			},
		]);
		expect(details.mentionAnnotations).toHaveLength(1);
		expect(details.mentionAnnotations?.[0]).toMatchObject({
			id: "ann-1",
			intendedName: "אברהם",
			confidence: "0.92",
			acceptance: "manual",
			currentContent: true,
		});
	});

	it("reports a stale annotation when the content hash no longer matches", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 })
			.mockResolvedValueOnce({ h: "aa" });
		queryMock
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					id: "ann-2",
					intended_name: "משה",
					entity_type: "PERSON",
					disambiguation: "הור הקדש",
					confidence: null,
					acceptance: "held",
					model_revision: "rev-2",
					span_start: null,
					span_end: null,
					surface: "משה רבנו",
					content_hash: "d".repeat(64),
					current_content: 0,
				},
			]);
		const details = await getArticleRelationshipDetails({ data: 7 });
		expect(details.mentionAnnotations?.[0].currentContent).toBe(false);
	});

	it("degrades when the annotation schema is not deployed", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 })
			.mockResolvedValueOnce({ h: "aa" });
		queryMock
			.mockResolvedValueOnce([]) // dedications
			.mockRejectedValueOnce(noSuchTable); // mention query
		const details = await getArticleRelationshipDetails({ data: 7 });
		expect(details.mentionAnnotations).toBeUndefined();
		expect(details.dedications).toEqual([]);
	});

	it("degrades an absent content_hash column to an empty token", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 })
			.mockRejectedValueOnce(noSuchTable); // hash read on pre-upgrade schema
		queryMock.mockResolvedValue([]);
		const details = await getArticleRelationshipDetails({ data: 7 });
		expect(details.contentHash).toBe("");
	});

	it("degrades a missing hash row to an empty token", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 })
			.mockResolvedValueOnce(null); // article exists but hash select returned no row
		queryMock.mockResolvedValue([]);
		const details = await getArticleRelationshipDetails({ data: 7 });
		expect(details.contentHash).toBe("");
	});

	it("propagates real errors from the mention query", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 })
			.mockResolvedValueOnce({ h: "aa" });
		queryMock
			.mockResolvedValueOnce([]) // dedications
			.mockRejectedValueOnce(new Error("connection lost")); // mention query
		await expect(
			getArticleRelationshipDetails({ data: 7 }),
		).rejects.toThrow("connection lost");
	});

	it("surfaces real database errors instead of degrading", async () => {
		queryOneMock
			.mockResolvedValueOnce({ id: 7 })
			.mockRejectedValueOnce(new Error("connection lost"));
		await expect(
			getArticleRelationshipDetails({ data: 7 }),
		).rejects.toThrow("connection lost");
	});
});
