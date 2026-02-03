import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E tests for author detail page (/authors/[id]).
 * Test data (tanah_test_data.sql) seeds authors with ids 1–4; author 1 has articles.
 */

test.describe("Author detail page", () => {
	test("renders author page with name and content", async ({ page }) => {
		await page.goto("/authors/1");

		await expect(page).toHaveTitle(/הרב לדוגמא|תנ״ך באתר/);
		const authorName = page.locator("h1").filter({ hasText: "הרב" });
		await expect(authorName).toBeVisible();
	});

	test("shows articles section when author has articles", async ({
		page,
	}) => {
		await page.goto("/authors/1");

		const articlesHeading = page.getByRole("heading", {
			name: /מאמרים/,
		});
		await expect(articlesHeading).toBeVisible();
		// At least one article link
		const articleLink = page.locator('a[href^="/929/"]').first();
		await expect(articleLink).toBeVisible();
	});

	test("navigating from authors list to author detail works", async ({
		page,
	}) => {
		await page.goto("/authors");
		await expect(page.locator("h1")).toContainText("הרבנים");

		// Click first author link (test data has authors 1–4)
		const firstAuthorLink = page.locator('a[href^="/authors/"]').first();
		await firstAuthorLink.click();

		await page.waitForURL(/\/authors\/\d+$/);
		await expect(page.locator("h1")).toBeVisible();
	});
});
