import { beforeEach, expect, it, vi } from "vitest";
import {
	lockReviewedArticleDedicationOwners,
	setReviewedArticleDedicationTarget,
} from "~/server/dedication-targets.server";

const db = vi.hoisted(() => ({
	one: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
}));
const effects = vi.hoisted(() => ({ revalidate: vi.fn(), sync: vi.fn() }));
vi.mock("~/server/db", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	transaction: db.transaction,
	txQueryOne: db.one,
	txExecute: db.execute,
}));
vi.mock("~/server/dedication-expiry", () => ({
	currentTargets: vi.fn(),
	mergeChanges: vi.fn(),
	syncDedicationExpiry: effects.sync,
}));
vi.mock("~/server/website-revalidate", () => ({
	dedicationChange: vi.fn(),
	revalidateWebsite: effects.revalidate,
}));

const conn = {} as never;
let rows: Map<string, string | null>;
let ownerExists: boolean;
let order: string[];
const key = (dedication: number, article: number) => `${dedication}:${article}`;
const update = (
	before: { expiresAt: string | null } | null,
	after: { expiresAt: string | null } | null,
) =>
	setReviewedArticleDedicationTarget(conn, {
		dedicationId: 9,
		articleId: 123,
		before,
		after,
	});
beforeEach(() => {
	vi.resetAllMocks();
	ownerExists = true;
	rows = new Map([
		[key(9, 456), "2030-01-01 00:00:00"],
		[key(10, 123), null],
		["sefer:9:1", null],
	]);
	order = [];
	db.one.mockImplementation(
		async (connection, sql: string, params: number[]) => {
			expect(connection).toBe(conn);
			expect(sql).toContain("FOR UPDATE");
			if (sql.includes("FROM tanah_dedication WHERE")) {
				order.push("owner-lock");
				expect(params).toHaveLength(1);
				return ownerExists ? { id: params[0] } : null;
			}
			if (
				!sql.includes(
					"FROM tanah_article_dedication WHERE dedication_id=? AND article_id=?",
				)
			)
				throw new Error(`Unexpected read: ${sql}`);
			order.push("assignment-lock");
			const target = key(params[0], params[1]);
			return rows.has(target) ? { expiresAt: rows.get(target) } : null;
		},
	);
	db.execute.mockImplementation(
		async (connection, sql: string, params: (number | string | null)[]) => {
			expect(connection).toBe(conn);
			order.push("write");
			if (sql.startsWith("INSERT INTO tanah_article_dedication")) {
				rows.set(
					key(Number(params[1]), Number(params[0])),
					params[2] as string | null,
				);
			} else if (
				sql.startsWith(
					"UPDATE tanah_article_dedication SET expires_at=? WHERE dedication_id=? AND article_id=?",
				)
			) {
				rows.set(
					key(Number(params[1]), Number(params[2])),
					params[0] as string | null,
				);
			} else if (
				sql.startsWith(
					"DELETE FROM tanah_article_dedication WHERE dedication_id=? AND article_id=?",
				)
			) {
				rows.delete(key(Number(params[0]), Number(params[1])));
			} else throw new Error(`Unexpected write: ${sql}`);
		},
	);
});

it("locks each dedication owner once in sorted order before any child reads", async () => {
	const ids = [10, 9, 10];
	await lockReviewedArticleDedicationOwners(conn, ids);
	expect(ids).toEqual([10, 9, 10]);
	expect(db.one.mock.calls.map(([, , params]) => params)).toEqual([[9], [10]]);
	expect(order).toEqual(["owner-lock", "owner-lock"]);
	expect(db.execute).not.toHaveBeenCalled();
});

it("does not access the database when there are no dedication owners", async () => {
	await lockReviewedArticleDedicationOwners(conn, []);
	expect(db.one).not.toHaveBeenCalled();
	expect(db.execute).not.toHaveBeenCalled();
});

it("fails before child reads when any sorted dedication owner is missing", async () => {
	db.one.mockResolvedValueOnce({ id: 9 }).mockResolvedValueOnce(null);
	await expect(
		lockReviewedArticleDedicationOwners(conn, [11, 10, 9]),
	).rejects.toThrow("dedication does not exist");
	expect(db.one.mock.calls.map(([, , params]) => params)).toEqual([[9], [10]]);
	expect(db.execute).not.toHaveBeenCalled();
});

it("locks the owning aggregate before adding one article assignment in the caller's transaction", async () => {
	const untouched = new Map(rows);
	await update(null, { expiresAt: "2028-02-01T01:02" });
	expect(order).toEqual(["owner-lock", "assignment-lock", "write"]);
	expect(rows.get(key(9, 123))).toBe("2028-02-01 01:02:00");
	rows.delete(key(9, 123));
	expect(rows).toEqual(untouched);
	expect(db.transaction).not.toHaveBeenCalled();
	expect(effects.revalidate).not.toHaveBeenCalled();
	expect(effects.sync).not.toHaveBeenCalled();
});

it("changes an exact reviewed expiry without rewriting other targets", async () => {
	rows.set(key(9, 123), "2027-01-01 00:00:00");
	await update({ expiresAt: "2027-01-01 00:00:00" }, { expiresAt: null });
	expect(rows).toEqual(
		new Map([
			[key(9, 456), "2030-01-01 00:00:00"],
			[key(10, 123), null],
			["sefer:9:1", null],
			[key(9, 123), null],
		]),
	);
	expect(db.execute.mock.calls[0][1]).toMatch(
		/^UPDATE tanah_article_dedication SET expires_at=\? WHERE dedication_id=\? AND article_id=\?$/,
	);
});

it("removes a reviewed ongoing assignment while preserving all other assignments", async () => {
	const untouched = new Map(rows);
	rows.set(key(9, 123), null);
	await update({ expiresAt: null }, null);
	expect(rows).toEqual(untouched);
	expect(db.execute.mock.calls[0][2]).toEqual([9, 123]);
});

it("treats absent to absent as a no-op after both locks", async () => {
	await update(null, null);
	expect(order).toEqual(["owner-lock", "assignment-lock"]);
	expect(db.execute).not.toHaveBeenCalled();
});

it.each([
	["new assignment", null, { expiresAt: null }, null],
	["missing assignment", { expiresAt: null }, null, undefined],
	[
		"changed expiry",
		{ expiresAt: "2027-01-01 00:00:00" },
		null,
		"2028-01-01 00:00:00",
	],
])(
	"rejects a concurrently %s without modifying any target",
	async (_name, before, after, current) => {
		if (current !== undefined) rows.set(key(9, 123), current);
		const untouched = new Map(rows);
		await expect(update(before, after)).rejects.toThrow(
			"assignment changed since review",
		);
		expect(rows).toEqual(untouched);
		expect(db.execute).not.toHaveBeenCalled();
	},
);

it("refuses a missing owning dedication before reading or modifying target rows", async () => {
	ownerExists = false;
	await expect(update(null, { expiresAt: null })).rejects.toThrow(
		"dedication does not exist",
	);
	expect(order).toEqual(["owner-lock"]);
	expect(db.execute).not.toHaveBeenCalled();
});

it.each(["2027-02-30 00:00:00", "2027-01-01 24:00:00", "tomorrow"])(
	"rejects invalid expiry %s before a write",
	async (expiresAt) => {
		await expect(update(null, { expiresAt })).rejects.toThrow();
		expect(db.execute).not.toHaveBeenCalled();
	},
);

it("propagates a transaction write failure without launching independent side effects", async () => {
	db.execute.mockRejectedValueOnce(new Error("Write failed"));
	await expect(update(null, { expiresAt: null })).rejects.toThrow(
		"Write failed",
	);
	expect(db.transaction).not.toHaveBeenCalled();
	expect(effects.revalidate).not.toHaveBeenCalled();
	expect(effects.sync).not.toHaveBeenCalled();
});
