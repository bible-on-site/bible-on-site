import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E tests for author detail page (/929/authors/[authorParam]).
 * Test data (tanah_test_data.sql) seeds authors with ids 1–4; author 1 has articles.
 * Normalised name slug for author 1 (הרב לדוגמא שליט"א) is הרב לדוגמא שליטא.
 */

const AUTHOR_1_SLUG = encodeURIComponent("הרב לדוגמא שליטא");

test.describe("Author detail page", () => {
	test("renders author page with name and content", async ({ page }) => {
		await page.goto(`/929/authors/${AUTHOR_1_SLUG}`);

		await expect(page).toHaveTitle(/הרב לדוגמא|תנ״ך באתר/);
		const authorName = page.locator("h1").filter({ hasText: "הרב" });
		await expect(authorName).toBeVisible();
	});

	test("shows articles section when author has articles", async ({
		page,
	}) => {
		await page.goto(`/929/authors/${AUTHOR_1_SLUG}`);

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
		await page.goto("/929/authors");
		await expect(page.locator("h1")).toContainText("הרבנים");

		// Click first author link (test data has authors 1–4, links use name slugs)
		const firstAuthorLink = page
			.locator('a[href^="/929/authors/"]')
			.first();
		await firstAuthorLink.click();

		await page.waitForURL(/\/929\/authors\/.+$/);
		await expect(page.locator("h1")).toBeVisible();
	});

	test("numeric ID still resolves via backward-compat", async ({ page }) => {
		await page.goto("/929/authors/1");

		await expect(page).toHaveTitle(/הרב לדוגמא|תנ״ך באתר/);
		const authorName = page.locator("h1").filter({ hasText: "הרב" });
		await expect(authorName).toBeVisible();
	});

	test("/929/rabbis alias works for author detail", async ({ page }) => {
		await page.goto(`/929/rabbis/${AUTHOR_1_SLUG}`);

		await expect(page).toHaveTitle(/הרב לדוגמא|תנ״ך באתר/);
		const authorName = page.locator("h1").filter({ hasText: "הרב" });
		await expect(authorName).toBeVisible();
	});
});
