import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the ArticlesSection component.
 *
 * Tests verify that articles are displayed correctly when available.
 * Perek 1 (Bereshit א) has test articles seeded in the database.
 */

test.describe("Articles Section", () => {
	test("displays articles when available for perek", async ({ page }) => {
		// Perek 1 has articles in test data (tanah_test_data.sql)
		await page.goto("/929/1");

		// Wait for the page to load (use .first() as there are multiple article elements)
		await expect(page.locator("article").first()).toBeVisible();

		// Check for the articles section
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		// Articles section should be visible
		await expect(articlesSection).toBeVisible();

		// Check that at least one article card is displayed
		const articleCards = articlesSection.locator("article");
		await expect(articleCards.first()).toBeVisible();

		// Verify article title is visible
		const articleTitle = articlesSection.locator("h3");
		await expect(articleTitle.first()).toBeVisible();
	});

	test("displays article abstract when available", async ({ page }) => {
		await page.goto("/929/1");

		// Wait for articles section to appear
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection).toBeVisible();

		// Check for abstract content (rendered from HTML in test data)
		// The test data has: '<h1>מאמר של הרב לדוגמא שליט"א על בראשית א</h1>'
		const abstractContent = articlesSection.locator("h1");
		await expect(abstractContent.first()).toBeVisible();
	});

	test("shows 'קרא עוד' link for each article", async ({ page }) => {
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection).toBeVisible();

		// Check for "Read more" text
		const readMoreLinks = articlesSection.locator("text=קרא עוד");
		await expect(readMoreLinks.first()).toBeVisible();
	});

	test("does not display articles section when no articles exist", async ({
		page,
	}) => {
		// Perek 2 should not have articles in test data
		await page.goto("/929/2");

		// Wait for the page to load
		await expect(page.locator("article")).toBeVisible();

		// Articles section should NOT be visible (returns null when no articles)
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).not.toBeVisible();
	});
});
