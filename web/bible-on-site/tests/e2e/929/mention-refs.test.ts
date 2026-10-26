import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the mention-decoration pipeline (issue #2516).
 *
 * Test data (tanah_test_data.sql):
 * - perek 1 pasuk 1: a pasuk decoration for אלהים, which has a live entry.
 * - article 1 of perek 1: an article decoration for ישראל (has an entry) and
 *   one for יצחק (entity exists but no entry -> must stay plain text).
 */

test.describe("Mention decorations", () => {
	test("resolved pasuk mention renders a Tanahpedia link", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const link = page.locator(
			`a[href="/pedia/${encodeURIComponent("אלהים")}"]`,
		);
		await expect(link.first()).toBeVisible({ timeout: 10_000 });
	});

	test("resolved article mention renders a dashed link", async ({
		page,
	}) => {
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });

		const link = articleView.locator(
			`a.tanahpedia-mention[href="/pedia/${encodeURIComponent("ישראל")}"]`,
		);
		await expect(link).toBeVisible();
		await expect(link).toHaveText("ישראל");
	});

	test("unresolved article mention stays plain text without an anchor", async ({
		page,
	}) => {
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });

		// יצחק appears in the article text as ordinary words.
		await expect(articleView.getByText("יצחק").first()).toBeVisible();

		// Only the resolved mention (ישראל) may be an anchor.
		await expect(articleView.locator("a.tanahpedia-mention")).toHaveCount(1);
	});
});
