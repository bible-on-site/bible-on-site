import { test, expect } from "@playwright/test";
import mysql from "mysql2/promise";

/**
 * Regression coverage for the production failure reported at
 * https://xn--febl3a.co.il/929/693/2215?book= (#3095): a deep-linked
 * article inside the תהילים reader showed "לא ניתן לטעון את הספר." when
 * the multi-MB uncompressed book asset failed in transit. The reader
 * route now serves the Brotli payload with immutable caching, and an
 * unrecoverable load still offers refresh plus a flat-view escape.
 */

const PEREK_ID = 693;
const ARTICLE_ID = 2215;
const ARTICLE_NAME = "מאמר בדיקה על תהילים קכו";
const DEEP_LINK = `/929/${PEREK_ID}/${ARTICLE_ID}?book=`;
// The content-hashed תהילים reader payload (perekFrom 568).
const TANAH_TEILLIM_ASSET = /\/generated\/sefarim\/568\.[a-f0-9]{64}\.json$/;

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
	// Deterministic deep-link target: an article on the exact perek from the
	// production report. Id 2215 mirrors the reported URL. Delete first so a
	// leftover row from a killed run cannot fail the seed with a duplicate key.
	await connection.query("DELETE FROM tanah_article WHERE id = ?", [
		ARTICLE_ID,
	]);
	await connection.query(
		`INSERT INTO tanah_article
			(id, perek_id, author_id, abstract, name, priority, content, distributable)
		VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
		[
			ARTICLE_ID,
			PEREK_ID,
			1,
			"תקציר מאמר הבדיקה",
			ARTICLE_NAME,
			1,
			"<p>גוף מאמר הבדיקה על תהילים קכו</p>",
		],
	);
});

test.afterAll(async () => {
	await connection?.query("DELETE FROM tanah_article WHERE id = ?", [
		ARTICLE_ID,
	]);
	await connection?.end();
});

test.describe("929 sefer deep link resilience (#3095)", () => {
	// Both specs share the seeded 2215 row; parallel workers would delete and
	// re-insert it mid-test, so the file runs serially in one worker.
	test.describe.configure({ mode: "serial" });
	test("loads the deep-linked article from a Brotli, immutable-cached asset", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const assetResponse = page.waitForResponse(
			(response) =>
				TANAH_TEILLIM_ASSET.test(response.url()) && response.ok(),
			{ timeout: 60_000 },
		);
		await page.goto(DEEP_LINK);
		const response = await assetResponse;
		// The fix: the reader payload travels as precompressed Brotli — a few
		// hundred KB instead of the 2 MB raw transfer that failed in production —
		// and content-addressed URLs are immutable-cached so repeat opens stay
		// off the network. The asset is a static file under public/ whose
		// Content-Encoding: br comes from next.config headers(), so the wire
		// contract holds in dev and standalone alike (#3095).
		expect(response.headers()["cache-control"]).toContain("immutable");
		expect(response.headers()["content-encoding"]).toBe("br");
		// Re-request the same asset the way a real browser negotiates it.
		const brotliResponse = await page.request.get(response.url(), {
			headers: { "accept-encoding": "br" },
		});
		expect(brotliResponse.status()).toBe(200);
		expect(brotliResponse.headers()["content-encoding"]).toBe("br");
		expect(brotliResponse.headers()["cache-control"]).toContain("immutable");
		// Playwright decodes the body transparently; the wire itself was Brotli.
		expect(await brotliResponse.json()).toMatchObject({
			name: "תהילים",
			perekFrom: 568,
		});
		const book = page.locator(".he-book");
		await expect(book).toBeVisible({ timeout: 60_000 });
		await expect(
			book.getByRole("button", { name: "חזרה למאמרים" }),
		).toBeVisible({ timeout: 60_000 });
		await expect(
			book.getByRole("heading", { name: ARTICLE_NAME }),
		).toBeVisible();
	});

	test("a persistent asset failure offers a working flat-view escape", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.route(TANAH_TEILLIM_ASSET, (route) =>
			route.fulfill({ status: 503, body: "Bad Gateway" }),
		);
		await page.goto(DEEP_LINK);
		// Next.js mounts an empty role="alert" route announcer alongside the
		// reader's error box — filter on the message to reach the right one.
		const alert = page
			.getByRole("alert")
			.filter({ hasText: "לא ניתן לטעון את הספר." });
		await expect(alert).toBeVisible({ timeout: 60_000 });
		const flatViewLink = alert.getByRole("link", {
			name: "חזרה לתצוגת הפרק",
		});
		await expect(flatViewLink).toHaveAttribute(
			"href",
			`/929/${PEREK_ID}/${ARTICLE_ID}`,
		);
		await flatViewLink.click();
		// The flat article page is the promised recovery — same chapter/article.
		// (level 1: the reader panel renders its own h2 while it fades out.)
		await expect(
			page.getByRole("heading", { name: ARTICLE_NAME, level: 1 }),
		).toBeVisible({ timeout: 30_000 });
		// The escape also clears the stored book preference — otherwise the
		// composite's preference restore would re-add ?book and reopen the
		// failing reader, trapping the user in the error loop (#3095).
		await expect(page).toHaveURL(`/929/${PEREK_ID}/${ARTICLE_ID}`);
		expect(
			await page.evaluate(() => localStorage.getItem("perekViewMode")),
		).toBe("seo");
	});
});
