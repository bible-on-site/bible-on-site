import { beforeEach, expect, it, vi } from "vitest";
import {
	ARTICLE_LINK_STATUS_READ_COMPATIBILITY,
	ARTICLE_LINK_STATUS_RENAME,
	ensureArticleLinkStatusFence,
} from "~/server/tanahpedia/contribution-article-import-schema.server";

const db = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("~/server/db", () => db);

const physical = (name = "legacy_status") => ({
	name,
	type: "varchar(12)",
	nullable: "NO",
	extra: "",
	expression: "",
	comment: "",
});
const virtual = () => ({
	name: "status",
	type: "varchar(12)",
	nullable: "YES",
	extra: "VIRTUAL GENERATED",
	expression:
		"case when (`legacy_status` = _utf8mb4'approved') then _utf8mb4'stale' else `legacy_status` end",
	comment: "contribution-pr-apply-fence-v1",
});
let columns: ReturnType<typeof physical>[];
beforeEach(() => {
	vi.resetAllMocks();
	columns = [physical("status")];
	db.query.mockImplementation(async () => structuredClone(columns));
	db.execute.mockImplementation(async (sql: string) => {
		if (sql === ARTICLE_LINK_STATUS_RENAME) {
			columns = columns.map((column) => ({ ...column, name: "legacy_status" }));
		} else if (sql === ARTICLE_LINK_STATUS_READ_COMPATIBILITY) {
			columns.push(virtual());
		} else throw new Error(`Unexpected DDL: ${sql}`);
	});
});

it("renames the physical status before adding the generated read mask and verifies both results", async () => {
	await ensureArticleLinkStatusFence();
	expect(db.execute.mock.calls).toEqual([
		[ARTICLE_LINK_STATUS_RENAME],
		[ARTICLE_LINK_STATUS_READ_COMPATIBILITY],
	]);
	expect(db.query).toHaveBeenCalledTimes(3);
	for (const [sql] of db.query.mock.calls) {
		expect(sql).toContain("information_schema.COLUMNS");
		expect(sql).toContain("TABLE_SCHEMA=DATABASE()");
		expect(sql).toContain("TABLE_NAME='tanah_article_link_proposal'");
	}
	expect(ARTICLE_LINK_STATUS_RENAME).toContain("ALGORITHM=INPLACE, LOCK=NONE");
	expect(ARTICLE_LINK_STATUS_READ_COMPATIBILITY).toContain(
		"ALGORITHM=INPLACE, LOCK=NONE",
	);
	expect(ARTICLE_LINK_STATUS_RENAME).not.toContain("ADD COLUMN");
	expect(columns).toEqual([physical(), virtual()]);
});

it("resumes a physical-only state without undoing or repeating the execution barrier", async () => {
	columns = [physical()];
	await ensureArticleLinkStatusFence();
	expect(db.execute.mock.calls).toEqual([
		[ARTICLE_LINK_STATUS_READ_COMPATIBILITY],
	]);
	expect(db.query).toHaveBeenCalledTimes(2);
});

it("does not perform DDL on an already verified fence", async () => {
	columns = [virtual(), physical()];
	await ensureArticleLinkStatusFence();
	expect(db.execute).not.toHaveBeenCalled();
	expect(db.query).toHaveBeenCalledTimes(1);
});

it.each([
	"CASE WHEN legacy_status='approved' THEN 'stale' ELSE legacy_status END",
	"case when (`legacy_status` = _utf8mb4\\'approved\\') then _utf8mb4\\'stale\\' else `legacy_status` end",
])(
	"accepts equivalent metadata formatting while preserving the exact mask literals",
	async (expression) => {
		columns = [physical(), { ...virtual(), expression }];
		await ensureArticleLinkStatusFence();
		expect(db.execute).not.toHaveBeenCalled();
	},
);

it("revalidates a concurrent rename's unknown-column error and a concurrent add's duplicate-column error", async () => {
	db.execute.mockImplementation(async (sql: string) => {
		if (sql === ARTICLE_LINK_STATUS_RENAME) {
			columns = [physical()];
			throw Object.assign(new Error("Other initializer renamed status"), {
				code: "ER_BAD_FIELD_ERROR",
				errno: 1054,
			});
		}
		columns = [physical(), virtual()];
		throw Object.assign(new Error("Other initializer added status"), {
			code: "ER_DUP_FIELDNAME",
			errno: 1060,
		});
	});
	await ensureArticleLinkStatusFence();
	expect(db.execute.mock.calls).toEqual([
		[ARTICLE_LINK_STATUS_RENAME],
		[ARTICLE_LINK_STATUS_READ_COMPATIBILITY],
	]);
	expect(db.query).toHaveBeenCalledTimes(3);
});

it("does not accept an apparent rename race without a preserved physical column", async () => {
	db.execute.mockRejectedValueOnce(
		Object.assign(new Error("Missing status"), { code: "ER_BAD_FIELD_ERROR" }),
	);
	await expect(ensureArticleLinkStatusFence()).rejects.toThrow(
		"original article proposal status was not preserved",
	);
	expect(db.execute).toHaveBeenCalledTimes(1);
	expect(db.query).toHaveBeenCalledTimes(2);
});

it("does not accept an add race with an unowned or unsafe generated field", async () => {
	columns = [physical()];
	db.execute.mockImplementationOnce(async () => {
		columns.push({ ...virtual(), expression: "legacy_status" });
		throw Object.assign(new Error("Column added by another writer"), {
			code: "ER_DUP_FIELDNAME",
		});
	});
	await expect(ensureArticleLinkStatusFence()).rejects.toThrow(
		"read compatibility could not be verified",
	);
	expect(db.query).toHaveBeenCalledTimes(2);
});

it.each([
	"ER_TABLEACCESS_DENIED_ERROR",
	"ER_LOCK_WAIT_TIMEOUT",
	"ER_PARSE_ERROR",
])(
	"propagates unexpected DDL failure %s without retrying or weakening the schema",
	async (code) => {
		const error = Object.assign(new Error(code), { code });
		db.execute.mockRejectedValueOnce(error);
		await expect(ensureArticleLinkStatusFence()).rejects.toBe(error);
		expect(db.execute).toHaveBeenCalledTimes(1);
		expect(columns).toEqual([physical("status")]);
	},
);

it("retains the physical-only safety floor on a failed virtual add and completes it on a later call", async () => {
	const apply = db.execute.getMockImplementation();
	const error = new Error(
		"Connection interrupted before the compatibility add",
	);
	db.execute
		.mockImplementationOnce((...args) => apply?.(...args))
		.mockRejectedValueOnce(error);
	await expect(ensureArticleLinkStatusFence()).rejects.toBe(error);
	expect(columns).toEqual([physical()]);
	await ensureArticleLinkStatusFence();
	expect(db.execute.mock.calls).toEqual([
		[ARTICLE_LINK_STATUS_RENAME],
		[ARTICLE_LINK_STATUS_READ_COMPATIBILITY],
		[ARTICLE_LINK_STATUS_READ_COMPATIBILITY],
	]);
	expect(columns).toEqual([physical(), virtual()]);
});

it("propagates metadata read failures without issuing DDL", async () => {
	const error = new Error("Metadata unavailable");
	db.query.mockRejectedValueOnce(error);
	await expect(ensureArticleLinkStatusFence()).rejects.toBe(error);
	expect(db.execute).not.toHaveBeenCalled();
});

it.each([
	{ state: [] },
	{ state: [{ ...physical("status"), type: "varchar(255)" }] },
	{ state: [{ ...physical("status"), nullable: "YES" }] },
	{
		state: [
			{
				...physical("status"),
				expression: "'approved'",
				extra: "VIRTUAL GENERATED",
			},
		],
	},
])(
	"rejects an unexpected original status schema before the rename",
	async ({ state }) => {
		columns = state;
		await expect(ensureArticleLinkStatusFence()).rejects.toThrow(
			"Unexpected legacy article status schema",
		);
		expect(db.execute).not.toHaveBeenCalled();
	},
);

it.each([
	{ type: "varchar(255)" },
	{ nullable: "YES" },
	{ expression: "'approved'", extra: "VIRTUAL GENERATED" },
])(
	"rejects a nonphysical or changed original column after the barrier",
	async (changed) => {
		columns = [{ ...physical(), ...changed }, virtual()];
		await expect(ensureArticleLinkStatusFence()).rejects.toThrow(
			"original article proposal status was not preserved",
		);
		expect(db.execute).not.toHaveBeenCalled();
	},
);

it.each([
	{ comment: "unowned" },
	{ type: "varchar(13)" },
	{ extra: "STORED GENERATED" },
	{ expression: "legacy_status" },
	{
		expression:
			"case when legacy_status='ap proved' then 'stale' else legacy_status end",
	},
	{
		expression:
			"case when legacy_status='ap(proved)' then 'stale' else legacy_status end",
	},
	{
		expression:
			"case when legacy_status='approved_utf8mb4' then 'stale' else legacy_status end",
	},
	{
		expression:
			"case when legacy_status='approved' then 'sta le' else legacy_status end",
	},
	{
		expression:
			"case when legacy_status='approved' then 'sta(le)' else legacy_status end",
	},
	{
		expression:
			"case when other_status='approved' then 'stale' else legacy_status end",
	},
	{
		expression:
			"case when legacy_status='approved' then 'stale' else 'stale' end",
	},
])(
	"rejects a generated field with changed ownership, storage, type or exact SQL literals",
	async (changed) => {
		columns = [physical(), { ...virtual(), ...changed }];
		await expect(ensureArticleLinkStatusFence()).rejects.toThrow(
			"read compatibility could not be verified",
		);
		expect(db.execute).not.toHaveBeenCalled();
	},
);
