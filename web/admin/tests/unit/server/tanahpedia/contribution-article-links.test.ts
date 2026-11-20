import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import { validateArticleLinkChange } from "~/lib/tanahpedia/contribution-article-links";
import {
	prepareArticleLinkChange,
	readArticleLinkContext,
	readArticleLinkPreview,
	readArticleLinkState,
	searchArticleLinkTargets,
} from "~/server/tanahpedia/contribution-article-links.server";

const db = vi.hoisted(() => ({ one: vi.fn(), query: vi.fn() }));
vi.mock("~/server/db", () => ({ txQueryOne: db.one, txQuery: db.query }));
const conn = {} as never;
const row = {
	id: 123,
	name: "כותרת",
	abstract: "<p>מבוא</p>",
	content: "<p>תוכן <b>מאמר</b></p>",
	perekId: 1,
	authorId: 7,
	coverageVerified: 1,
	contentHash: "a".repeat(32),
};
const perek = (id: number) => ({
	id,
	seferName: "בראשית",
	additionalLetter: null,
	perekInContext: id,
	pasukCount: 31,
});
const changed = () =>
	validateArticleLinkChange({
		kind: "article_links",
		targetId: "123",
		after: {
			commands: [
				{
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: 2 },
				},
				{
					relationshipKey: "coveringSources",
					action: "add",
					target: { pasukCoordinates: [{ perekId: 2, pasuk: 3 }] },
				},
				{
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 10, expiresAt: null },
				},
				{ relationshipKey: "moadim", action: "add", target: { moedIds: [5] } },
			],
		},
	});

beforeEach(() => {
	vi.resetAllMocks();
	db.one.mockResolvedValue(row);
	db.query.mockImplementation(async (_conn, sql: string) => {
		if (sql.includes("subject AS name"))
			return [
				{ id: 9, name: "קיים" },
				{ id: 10, name: "מוצע" },
			];
		if (sql.includes("FROM tanah_article_covering_source"))
			return [{ perekId: 1, pasuk: 1 }];
		if (sql.includes("FROM tanah_article_dedication"))
			return [{ dedicationId: 9, expiresAt: "2027-01-01 00:00:00" }];
		if (sql.includes("FROM tanah_article_moed")) return [{ moedId: 2 }];
		if (sql.includes("FROM tanah_perek_view")) return [perek(1), perek(2)];
		if (sql.includes("FROM tanah_dedication"))
			return [
				{ id: 9, subject: "קיים" },
				{ id: 10, subject: "מוצע" },
			];
		if (sql.includes("FROM tanah_moed"))
			return [
				{ id: 2, name: "קיים" },
				{ id: 5, name: "מוצע" },
			];
		throw new Error(`Unexpected query: ${sql}`);
	});
});

it("finds articles by escaped bounded title search with perek and author context", async () => {
	db.query.mockImplementation(async (_conn, sql: string, params) => {
		if (sql.includes("LEFT JOIN tanah_author")) {
			expect(sql).toContain("LIKE ? ESCAPE '\\\\'");
			expect(sql).toMatch(/LIMIT 25/);
			expect(params).toEqual(["%לדוג\\%מה%"]);
			return [
				{
					id: 17,
					name: "מאמר לדוגמה",
					perekId: 1,
					authorName: "הרב דוגמה",
				},
				{ id: 42, name: "מאמר אחר", perekId: 2, authorName: null },
			];
		}
		if (sql.includes("FROM tanah_perek_view")) {
			expect(params).toEqual(["[1,2]"]);
			return [
				perek(1),
				{
					...perek(2),
					seferName: "שמות",
					perekInContext: 2,
					pasukCount: null,
				},
			];
		}
		throw new Error(`Unexpected query: ${sql}`);
	});
	const results = await searchArticleLinkTargets(conn, "לדוג%מה");
	expect(results).toEqual([
		{
			id: "17",
			title: "מאמר לדוגמה",
			perekLabel: "בראשית א",
			authorName: "הרב דוגמה",
		},
		{ id: "42", title: "מאמר אחר", perekLabel: "שמות ב", authorName: null },
	]);
	// The picker must stay a lightweight lookup — never article prose or hashes.
	expect(String(db.query.mock.calls[0][1])).not.toMatch(/content|abstract/);
});

it("returns no rows for an empty hit set without touching the perek catalogue", async () => {
	db.query.mockResolvedValue([]);
	expect(await searchArticleLinkTargets(conn, "אין כזה")).toEqual([]);
	expect(db.query).toHaveBeenCalledTimes(1);
});

it("labels a hit whose perek is missing from the view by its numeric id", async () => {
	const original = db.query.getMockImplementation();
	db.query.mockImplementation((connection, sql, params) =>
		String(sql).includes("LEFT JOIN tanah_author")
			? Promise.resolve([
					{ id: 7, name: "מאמר יתום", perekId: 99, authorName: null },
				])
			: original?.(connection, sql, params),
	);
	expect((await searchArticleLinkTargets(conn, "יתום"))[0].perekLabel).toBe(
		"פרק 99",
	);
});

it("returns a bounded title/link preview and picker labels without exposing article prose", async () => {
	const preview = await readArticleLinkPreview(conn, "123");
	expect(preview).toMatchObject({
		id: "123",
		title: row.name,
		references: {
			dedication: [
				{ id: 9, name: "קיים" },
				{ id: 10, name: "מוצע" },
			],
			moed: [
				{ id: 2, name: "קיים" },
				{ id: 5, name: "מוצע" },
			],
		},
		hasMore: { dedication: false, moed: false },
	});
	expect(preview).not.toHaveProperty("plainText");
	expect(preview).not.toHaveProperty("content");
	expect(
		db.query.mock.calls.filter(([, sql]) =>
			String(sql).includes("ORDER BY subject,id"),
		)[0][1],
	).toContain("LIMIT 2001");
});

it("reports picker truncation explicitly", async () => {
	const original = db.query.getMockImplementation();
	db.query.mockImplementation((connection, sql, params) =>
		String(sql).includes("LIMIT 2001")
			? Promise.resolve(
					Array.from({ length: 2001 }, (_, i) => ({
						id: i + 1,
						name: `Choice ${i + 1}`,
					})),
				)
			: original?.(connection, sql, params),
	);
	const preview = await readArticleLinkPreview(conn, "123");
	expect(preview.references.dedication).toHaveLength(2000);
	expect(preview.references.moed).toHaveLength(2000);
	expect(preview.hasMore).toEqual({ dedication: true, moed: true });
});

it("captures complete link state and expiry without taking locks across an external API mutation", async () => {
	const state = await readArticleLinkState(conn, "123");
	expect(state).toMatchObject({
		perekId: 1,
		authorId: 7,
		contentHash: row.contentHash,
		coverageVerified: true,
		coveringSources: [{ perekId: 1, pasuk: 1 }],
		dedicationAssignments: [
			{ dedicationId: 9, expiresAt: "2027-01-01 00:00:00" },
		],
		moedIds: [2],
	});
	expect(state.sourceHash).toBe(
		createHash("sha256")
			.update(
				canonicalJson({
					name: row.name,
					abstract: row.abstract,
					content: row.content,
					authorId: row.authorId,
				}),
			)
			.digest("hex"),
	);
	for (const call of [...db.one.mock.calls, ...db.query.mock.calls]) {
		expect(call[1]).not.toMatch(/FOR (SHARE|UPDATE)/);
		expect(call[2]).toEqual([123]);
	}
});

it("uses current locking reads for source and every relation set in an agent completion", async () => {
	await readArticleLinkState(conn, "123", { current: true });
	for (const call of [...db.one.mock.calls, ...db.query.mock.calls])
		expect(call[1]).toMatch(/ FOR SHARE$/);
	const source = db.one.mock.invocationCallOrder[0];
	expect(
		db.query.mock.invocationCallOrder.every((order) => order > source),
	).toBe(true);
});

it("binds complete plain text and its source hash to the same single article read", async () => {
	db.one
		.mockResolvedValueOnce(row)
		.mockResolvedValue({ ...row, content: "different later text" });
	const context = await readArticleLinkContext(conn, "123", { current: true });
	expect(context).toMatchObject({
		id: "123",
		title: row.name,
		plainText: "כותרת\nמבוא\nתוכן מאמר",
	});
	expect(db.one).toHaveBeenCalledTimes(1);
	expect(context.state.sourceHash).toBe(
		createHash("sha256")
			.update(
				canonicalJson({
					name: row.name,
					abstract: row.abstract,
					content: row.content,
					authorId: 7,
				}),
			)
			.digest("hex"),
	);
});

it("does not confuse an approved primary-perek update with a prose change", async () => {
	const before = await readArticleLinkState(conn, "123");
	db.one.mockResolvedValue({ ...row, perekId: 2, contentHash: "c".repeat(32) });
	const linkChanged = await readArticleLinkState(conn, "123");
	expect(linkChanged.sourceHash).toBe(before.sourceHash);
	expect(linkChanged.contentHash).not.toBe(before.contentHash);
	db.one.mockResolvedValue({ ...row, content: `${row.content}<p>נוסף</p>` });
	expect((await readArticleLinkState(conn, "123")).sourceHash).not.toBe(
		before.sourceHash,
	);
});

it("keeps nullable prose fields distinct while returning a nonempty text view", async () => {
	db.one.mockResolvedValue({ ...row, abstract: null, content: null });
	expect((await readArticleLinkContext(conn, "123")).plainText).toBe(row.name);
});

it.each(["0", "001", "bad", "2147483648"])(
	"rejects unbound native IDs before querying: %s",
	async (id) => {
		await expect(readArticleLinkState(conn, id)).rejects.toThrow(/article/);
		expect(db.one).not.toHaveBeenCalled();
	},
);

it("fails closed when the article or exact content-hash schema is unavailable", async () => {
	db.one.mockResolvedValue(null);
	await expect(readArticleLinkState(conn, "123")).rejects.toThrow(
		"Article not found",
	);
	db.one.mockResolvedValue({ ...row, contentHash: null });
	await expect(readArticleLinkState(conn, "123")).rejects.toThrow(
		/exact content/,
	);
});

it("propagates storage failures without turning them into a recoverable content conflict", async () => {
	const failure = Object.assign(new Error("storage unavailable"), {
		code: "ECONNRESET",
	});
	db.query.mockRejectedValue(failure);
	await expect(readArticleLinkState(conn, "123")).rejects.toBe(failure);
});

it("prepares source-bound evidence labels and validates every target against its catalogue", async () => {
	const prepared = await prepareArticleLinkChange(conn, changed());
	expect(prepared.targetId).toBe("123");
	expect(prepared.after).toEqual(changed().after);
	expect(prepared.labels).toMatchObject({
		"article:123": row.name,
		"perek:1": "בראשית א",
		"perek:2": "בראשית ב",
		"dedication:10": "מוצע",
		"moed:5": "מוצע",
	});
	expect(
		db.query.mock.calls.find((call) =>
			String(call[1]).includes("FROM tanah_perek_view"),
		)?.[2],
	).toEqual(["[1,2]"]);
	expect(db.one.mock.calls[0][1]).toMatch(/ FOR SHARE$/);
});

it.each([
	["FROM tanah_perek_view", [perek(1)], "perek does not exist"],
	[
		"FROM tanah_dedication",
		[{ id: 9, subject: "קיים" }],
		"dedication does not exist",
	],
	["FROM tanah_moed", [{ id: 2, name: "קיים" }], "moed does not exist"],
	[
		"FROM tanah_perek_view",
		[perek(1), { ...perek(2), pasukCount: 2 }],
		"pasuk is outside",
	],
	[
		"FROM tanah_perek_view",
		[perek(1), { ...perek(2), pasukCount: null }],
		"pasuk is outside",
	],
])(
	"rejects stale or out-of-bounds target catalogue rows: %s",
	async (table, rows, message) => {
		const original = db.query.getMockImplementation();
		db.query.mockImplementation((connection, sql, params) =>
			String(sql).includes(String(table))
				? Promise.resolve(rows)
				: original?.(connection, sql, params),
		);
		await expect(prepareArticleLinkChange(conn, changed())).rejects.toThrow(
			String(message),
		);
	},
);

it("does not invent a change when an additive intent is already satisfied, but permits an honest rebase", async () => {
	const input = validateArticleLinkChange({
		kind: "article_links",
		targetId: "123",
		after: {
			commands: [
				{
					relationshipKey: "coveringSources",
					action: "add",
					target: { pasukCoordinates: [{ perekId: 1, pasuk: 1 }] },
				},
			],
		},
	});
	await expect(prepareArticleLinkChange(conn, input)).rejects.toThrow(
		/does not change/,
	);
	expect(
		await prepareArticleLinkChange(conn, input, { refresh: true }),
	).toMatchObject({ kind: "article_links", after: input.after });
});
