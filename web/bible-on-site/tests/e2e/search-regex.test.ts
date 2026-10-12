import { expect, test } from "@playwright/test";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { termRankPatterns, termRegexp } from "../../src/lib/search/db-content";

/**
 * Probes the generated candidate/rank patterns through `REGEXP_LIKE` on
 * the real MySQL test database — the unit suite verifies the patterns
 * structurally (the codacy gate forbids compiling a non-literal RegExp
 * in repo code), while this spec asserts the actual ICU behavior the
 * providers rely on: fuzzy-eligible words are selected, words outside
 * the `[term - edits, term + edits]` length window are not, and the
 * pre-cap rank estimate lands on the scorer's 90/80/60 tiers (#2140).
 */

let connection: mysql.Connection;

test.beforeAll(async () => {
	const url = new URL(process.env.DB_URL ?? "");
	connection = await mysql.createConnection({
		host: url.hostname,
		port: Number(url.port || 3306),
		user: url.username,
		password: url.password,
		database: url.pathname.slice(1),
	});
});

test.afterAll(async () => {
	await connection?.end();
});

async function regexpLike(expr: string, pattern: string): Promise<boolean> {
	const [rows] = await connection.query<RowDataPacket[]>(
		"SELECT REGEXP_LIKE(?, ?, 'i') AS matched",
		[expr, pattern],
	);
	return rows[0].matched === 1;
}

test.describe("generated search patterns on real MySQL", () => {
	test("selects the stored word the issue's example needs (#2140)", async () => {
		const pattern = termRegexp("ירושלימ");
		// The motivating example: `ירושלים` must reach the scorer.
		await expect(regexpLike("ירושלים", pattern)).resolves.toBe(true);
		await expect(regexpLike("על ירושלים נאמר", pattern)).resolves.toBe(true);
		// Ignorable runs between letters still match.
		await expect(regexpLike('שליט"א', termRegexp("שליטא"))).resolves.toBe(true);
	});

	test("keeps the exact/prefix path word-anchored", async () => {
		const pattern = termRegexp("את");
		await expect(regexpLike("אתר", pattern)).resolves.toBe(true);
		await expect(regexpLike("באת", pattern)).resolves.toBe(false);
	});

	test("rejects chunks inside words outside the length window", async () => {
		const pattern = termRegexp("ירושלימ");
		// Over the term + edits ceiling (12 letters for a 7-letter term
		// allowing one edit) — the review's אבגדירושאבגד example.
		await expect(regexpLike("אבגדירושאבגד", pattern)).resolves.toBe(false);
		// Under the term - edits floor — a bare chunk word, and two split
		// chunk words, are dead candidates and must not be selected.
		await expect(regexpLike("ירוש", pattern)).resolves.toBe(false);
		await expect(regexpLike("ירוש לימ", pattern)).resolves.toBe(false);
		// In-window words still select even when the scorer will rate them 0.
		await expect(regexpLike("ירושלמי", pattern)).resolves.toBe(true);
	});

	test("ranks terms on the scorer's 90/80/60 tiers", async () => {
		const [exact, prefix, candidate] = termRankPatterns("בראשית");
		async function estimate(word: string): Promise<number> {
			const [rows] = await connection.query<RowDataPacket[]>(
				`SELECT 10*REGEXP_LIKE(?, ?, 'i')
					+ 20*REGEXP_LIKE(?, ?, 'i')
					+ 60*REGEXP_LIKE(?, ?, 'i') AS estimate`,
				[word, exact, word, prefix, word, candidate],
			);
			return Number(rows[0].estimate);
		}
		await expect(estimate("בראשית")).resolves.toBe(90);
		await expect(estimate("אב בראשית גד")).resolves.toBe(90);
		await expect(estimate("בראשיתו")).resolves.toBe(80);
		await expect(estimate("בראשת")).resolves.toBe(60);
		await expect(estimate("בבראשית")).resolves.toBe(60);
		await expect(estimate("אזור")).resolves.toBe(0);
		// A split-chunk row rates 0 — it can no longer outrank a real
		// fuzzy-eligible word the way anchor counting allowed (#2140 review).
		const [e, p, f] = termRankPatterns("ירושלימ");
		const [rows] = await connection.query<RowDataPacket[]>(
			`SELECT 10*REGEXP_LIKE(?, ?, 'i')
				+ 20*REGEXP_LIKE(?, ?, 'i')
				+ 60*REGEXP_LIKE(?, ?, 'i') AS estimate`,
			["ירוש לימ", e, "ירוש לימ", p, "ירוש לימ", f],
		);
		expect(Number(rows[0].estimate)).toBe(0);
	});
});
