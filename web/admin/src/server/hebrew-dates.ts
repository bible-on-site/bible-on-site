import type mysql from "mysql2/promise";
import { hasBulletinArticleText } from "~/lib/bulletin-article";
import { hebrewBulletinMonthDay } from "~/lib/daily-bulletin";
import { execute, query, txExecute, txQuery } from "./db";

/**
 * One recurring Hebrew month/day an article is assigned to (#3098) — one row
 * in tanah_article_hebrew_date, recurring every Hebrew year. `hebrew_month`
 * uses the uniform numbering shared with the app, the API and the bulletin:
 * 1=Tishrei..12=Elul, 6=Adar of a non-leap year, 13=Adar I, 14=Adar II.
 */
export interface HebrewDateAssignment {
	hebrew_month: number;
	hebrew_day: number;
}

/**
 * Maximum day each uniform Hebrew month can reach in some year: Cheshvan and
 * Kislev vary 29/30 so 30 stays valid input for them; Tevet, non-leap Adar,
 * Iyar, Tammuz, Elul and Adar II never reach 30.
 */
const MAX_DAY_FOR_HEBREW_MONTH: Record<number, number> = {
	1: 30,
	2: 30,
	3: 30,
	4: 29,
	5: 30,
	6: 29,
	7: 30,
	8: 29,
	9: 30,
	10: 29,
	11: 30,
	12: 29,
	13: 30,
	14: 29,
};

/**
 * Whether a query failure means the Hebrew-date schema is not deployed yet —
 * same MySQL signals the covering-source path degrades on.
 */
export function isHebrewDateSchemaMissing(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { code, errno } = error as { code?: unknown; errno?: unknown };
	return (
		code === "ER_BAD_FIELD_ERROR" ||
		code === "ER_NO_SUCH_TABLE" ||
		errno === 1054 ||
		errno === 1146
	);
}

/**
 * Validates the client-supplied shape BEFORE touching the database: integer
 * coordinates, month 1-14, day within the month's real maximum, no duplicate
 * dates — the composite primary key is the backstop, not the contract.
 */
export function normalizeHebrewDates(
	rows: HebrewDateAssignment[],
): HebrewDateAssignment[] {
	const seen = new Set<number>();
	const normalized: HebrewDateAssignment[] = [];
	for (const row of rows) {
		if (
			!Number.isInteger(row.hebrew_month) ||
			!Number.isInteger(row.hebrew_day)
		) {
			throw new Error("Hebrew dates must use integer month and day values");
		}
		const maxDay = MAX_DAY_FOR_HEBREW_MONTH[row.hebrew_month];
		if (maxDay === undefined) {
			throw new Error(
				`Hebrew month must be between 1 and 14 (got ${row.hebrew_month})`,
			);
		}
		if (row.hebrew_day < 1 || row.hebrew_day > maxDay) {
			throw new Error(
				`Hebrew day ${row.hebrew_day} is invalid for month ${row.hebrew_month} (allowed: 1-${maxDay})`,
			);
		}
		const key = row.hebrew_month * 100 + row.hebrew_day;
		if (seen.has(key)) {
			throw new Error(
				`Duplicate Hebrew date ${row.hebrew_month}/${row.hebrew_day}`,
			);
		}
		seen.add(key);
		normalized.push({
			hebrew_month: row.hebrew_month,
			hebrew_day: row.hebrew_day,
		});
	}
	return normalized;
}

/**
 * Rejects dates another article already holds inside the save transaction —
 * one article per recurring date — with a readable conflict instead of the
 * raw duplicate-key error.
 */
export async function assertHebrewDatesAvailable(
	conn: mysql.PoolConnection,
	articleId: number,
	rows: HebrewDateAssignment[],
): Promise<void> {
	if (rows.length === 0) return;
	const conditions = rows
		.map(() => "(hebrew_month = ? AND hebrew_day = ?)")
		.join(" OR ");
	const params = rows.flatMap((row) => [row.hebrew_month, row.hebrew_day]);
	const conflicts = await txQuery<{ article_id: number }>(
		conn,
		`SELECT article_id FROM tanah_article_hebrew_date
		 WHERE article_id <> ? AND (${conditions})`,
		[articleId, ...params],
	);
	if (conflicts.length > 0) {
		throw new Error(
			`Hebrew date is already assigned to article ${conflicts[0].article_id}; remove it there first — one article per date`,
		);
	}
}

/**
 * Post-write eligibility for a Hebrew-date assignment owner (#3098): an
 * article that still holds recurring dates must stay distribution-eligible
 * with a non-empty body — the daily bulletin's assigned-article lookup
 * treats an ineligible owner as broken data and aborts preparation, so an
 * assignment must never be left on such an article. Run inside the save
 * transaction (the article INSERT/UPDATE already holds its row lock), so a
 * violation rolls the whole save back. `article` is the just-written state —
 * the same values the INSERT/UPDATE persisted — and `dates` is the effective
 * assignment set after the save (new set on replace, persisted set when the
 * field was omitted, undefined when the schema is absent).
 */
export function assertHebrewDateArticleEligible(
	article: {
		id: number;
		name?: string;
		distributable: boolean;
		content?: string | null;
	},
	dates: HebrewDateAssignment[] | undefined,
): void {
	if (!dates || dates.length === 0) return;
	if (
		!article.distributable ||
		!hasBulletinArticleText(article.content ?? null, article.name)
	) {
		throw new Error(
			`Article ${article.id} holds recurring Hebrew-date assignments and must stay distributable with a non-empty body of written content - clear the dates or restore eligibility first`,
		);
	}
}

/**
 * Replaces the article's date assignments inside the save transaction:
 * clears existing rows and inserts the validated set. The shared
 * (hebrew_month, hebrew_day) PK makes a same-transaction replace safe.
 */
export async function replaceHebrewDates(
	conn: mysql.PoolConnection,
	articleId: number,
	rows: HebrewDateAssignment[],
): Promise<void> {
	await txExecute(
		conn,
		"DELETE FROM tanah_article_hebrew_date WHERE article_id = ?",
		[articleId],
	);
	if (rows.length > 0) {
		const placeholders = rows.map(() => "(?, ?, ?)").join(", ");
		const params = rows.flatMap((row) => [
			articleId,
			row.hebrew_month,
			row.hebrew_day,
		]);
		await txExecute(
			conn,
			`INSERT INTO tanah_article_hebrew_date (article_id, hebrew_month, hebrew_day) VALUES ${placeholders}`,
			params,
		);
	}
}

/**
 * Safe invalidation for unsent prepared bulletins after a Hebrew-date
 * assignment change (#3098). A prepared bulletin whose target date maps to a
 * changed recurring date was built from the old selection — but artifacts
 * are immutable, so regeneration happens by deleting the prepared row and
 * letting the next prepareBulletin rebuild it. Deletion is allowed ONLY
 * while every delivery channel is still 'pending': a sent/failed/unknown
 * delivery means content already left (or a job is uncertain), and the
 * issue contract forbids mutating sent artifacts or resetting uncertain
 * jobs — those rows stay for explicit operator handling.
 */
export async function invalidateUnsentBulletinsForHebrewDates(
	dates: HebrewDateAssignment[],
): Promise<void> {
	if (dates.length === 0) return;
	try {
		const keys = new Set(dates.map((d) => d.hebrew_month * 100 + d.hebrew_day));
		const prepared = await query<{ bulletin_date: string }>(
			"SELECT DATE_FORMAT(bulletin_date, '%Y-%m-%d') AS bulletin_date FROM tanah_daily_bulletin",
		);
		for (const row of prepared) {
			const { hebrewMonth, hebrewDay } = hebrewBulletinMonthDay(
				row.bulletin_date,
			);
			if (!keys.has(hebrewMonth * 100 + hebrewDay)) continue;
			const deliveries = await query<{ status: string }>(
				"SELECT status FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ?",
				[row.bulletin_date],
			);
			if (!deliveries.every((d) => d.status === "pending")) {
				// Anything sent or uncertain stays immutable — the operator
				// regenerates it explicitly if needed.
				continue;
			}
			await execute(
				"DELETE FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ?",
				[row.bulletin_date],
			);
			await execute(
				"DELETE FROM tanah_daily_bulletin WHERE bulletin_date = ?",
				[row.bulletin_date],
			);
		}
	} catch (error) {
		if (!isHebrewDateSchemaMissing(error)) {
			// Best-effort projection cleanup: the authoritative assignment
			// committed already — warn rather than fail the article save.
			console.warn(
				"Failed to invalidate unsent bulletins for Hebrew-date change:",
				error instanceof Error ? error.message : error,
			);
		}
	}
}
