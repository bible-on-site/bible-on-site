import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the article detail page (/929/[number]/[articleId]).
 *
 * Test data (tanah_test_data.sql): perek 1 has articles; first article has
 * name "בראשית ברא - עיון בפסוק הראשון", author 1 "הרב לדוגמא שליט"א", and HTML content.
 */

test.describe("Article page", () => {
	test("shows rabbi name, picture, title, and article body", async ({
		page,
	}) => {
		// Direct navigation to first article of perek 1
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });

		// Rabbi (author) name in header
		await expect(
			articleView.locator("span").filter({ hasText: "הרב לדוגמא" }),
		).toBeVisible();

		// Rabbi picture
		await expect(articleView.locator("img[alt*='הרב']")).toBeVisible();

		// Article title
		await expect(
			articleView.getByRole("heading", { name: /בראשית ברא/ }),
		).toBeVisible();

		// Article body content (test data has "פתיחה" and "בראשית" in content)
		await expect(articleView.getByText("פתיחה")).toBeVisible();
		await expect(
			articleView.getByRole("heading", { name: /פירוש המילה "בראשית"/ }),
		).toBeVisible();
	});

	test("author name links to author page", async ({ page }) => {
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });

		const authorLink = articleView.locator('a[href^="/authors/"]');
		await expect(authorLink).toBeVisible();
		await expect(authorLink).toHaveAttribute("href", "/authors/1");

		await authorLink.click();
		await page.waitForURL(/\/authors\/1$/);
		await expect(page.locator("h1")).toContainText("הרב");
	});

	test("back to perek link returns to perek page", async ({ page }) => {
		await page.goto("/929/1/1");

		const backLink = page.getByRole("link", { name: /חזרה לפרק/ });
		await expect(backLink).toBeVisible();
		await expect(backLink).toHaveAttribute("href", "/929/1");

		await backLink.click();
		await page.waitForURL(/\/929\/1$/);
		await expect(page).toHaveURL(/\/929\/1$/);
	});

	test("opening article from carousel shows same article content", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection).toBeVisible();

		// Click first article in carousel
		await articlesSection.locator("a").first().click();
		await page.waitForURL(/\/929\/1\/\d+$/);

		// Same article view content
		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });
		await expect(
			articleView.getByRole("heading", { name: /בראשית ברא/ }),
		).toBeVisible();
	});
});
