import { execute, query } from "../db";

export const ARTICLE_LINK_STATUS_RENAME =
	"ALTER TABLE tanah_article_link_proposal RENAME COLUMN status TO legacy_status, ALGORITHM=INPLACE, LOCK=NONE";
export const ARTICLE_LINK_STATUS_READ_COMPATIBILITY =
	"ALTER TABLE tanah_article_link_proposal ADD COLUMN status VARCHAR(12) GENERATED ALWAYS AS (CASE WHEN legacy_status='approved' THEN 'stale' ELSE legacy_status END) VIRTUAL COMMENT 'contribution-pr-apply-fence-v1', ALGORITHM=INPLACE, LOCK=NONE";

interface Column {
	name: string;
	extra: string;
	expression: string;
	comment: string;
	type: string;
	nullable: string;
}

const columns = () =>
	query<Column>(
		"SELECT COLUMN_NAME AS name,EXTRA AS extra,GENERATION_EXPRESSION AS expression,COLUMN_COMMENT AS comment,COLUMN_TYPE AS type,IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tanah_article_link_proposal' AND COLUMN_NAME IN ('status','legacy_status')",
	);
const physical = (column: Column | undefined) =>
	Boolean(
		column &&
			column.type.toLowerCase() === "varchar(12)" &&
			column.nullable === "NO" &&
			!column.expression &&
			!column.extra.includes("GENERATED"),
	);
function compatible(column: Column | undefined) {
	// Tokenize exact literal values before normalizing syntax. Removing spaces
	// inside a quoted value would incorrectly accept 'ap proved' as 'approved'.
	const expression = column?.expression
		.replace(/(?:_utf8mb4)?(?:\\'approved\\'|'approved')/g, "@approved@")
		.replace(/(?:_utf8mb4)?(?:\\'stale\\'|'stale')/g, "@stale@")
		.replace(/[\\`()\s]/g, "")
		.toLowerCase();
	return Boolean(
		column &&
			column.extra === "VIRTUAL GENERATED" &&
			column.type.toLowerCase() === "varchar(12)" &&
			column.comment === "contribution-pr-apply-fence-v1" &&
			expression ===
				"casewhenlegacy_status=@approved@then@stale@elselegacy_statusend",
	);
}
const race = (error: unknown) =>
	Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			[
				"ER_DUP_FIELDNAME",
				"ER_BAD_FIELD_ERROR",
				"ER_CANT_DROP_FIELD_OR_KEY",
			].includes(String(error.code)),
	);

/** The first metadata-only DDL is the execution fence: it waits out transactions
 * holding the legacy table, including its old HTTP and independent dedication
 * writes. Old code subsequently has no approved status field or writable status
 * column. The second DDL restores read compatibility with a virtual masked field.
 * Never combine these actions: MySQL would require a full table copy. */
export async function ensureArticleLinkStatusFence(): Promise<void> {
	let state = await columns();
	if (!state.some((column) => column.name === "legacy_status")) {
		if (!physical(state.find((column) => column.name === "status")))
			throw new Error(
				"Unexpected legacy article status schema; migration stopped",
			);
		try {
			await execute(ARTICLE_LINK_STATUS_RENAME);
		} catch (error) {
			if (!race(error)) throw error;
		}
		state = await columns();
	}
	if (!physical(state.find((column) => column.name === "legacy_status")))
		throw new Error(
			"The original article proposal status was not preserved; migration stopped",
		);
	if (!state.some((column) => column.name === "status")) {
		try {
			await execute(ARTICLE_LINK_STATUS_READ_COMPATIBILITY);
		} catch (error) {
			if (!race(error)) throw error;
		}
		state = await columns();
	}
	if (
		!physical(state.find((column) => column.name === "legacy_status")) ||
		!compatible(state.find((column) => column.name === "status"))
	)
		throw new Error(
			"Legacy article proposal read compatibility could not be verified; migration stopped",
		);
}
