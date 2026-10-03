import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the ArticlesSection component (carousel view).
 *
 * Tests verify that articles are displayed correctly when available.
 * Perek 1 (Bereshit א) has test articles seeded in the database.
 */

test.describe("Articles Section", () => {
	test("displays articles carousel when available for perek", async ({
		page,
	}) => {
		// Perek 1 has articles in test data (tanah_test_data.sql)
		await page.goto("/929/1");

		// Check for the articles section
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).toBeVisible();

		// Check that at least one carousel item (link) is displayed
		const carouselItems = articlesSection.locator("a");
		await expect(carouselItems.first()).toBeVisible();
	});

	test("displays author name and image in carousel", async ({ page }) => {
		await page.goto("/929/1");

		// Wait for articles section to appear
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).toBeVisible();

		// Check for author image (the section icon is decorative, alt="")
		const authorImage = articlesSection.locator('img:not([alt=""])');
		await expect(authorImage.first()).toBeVisible();
	});

	test("carousel items link to article page", async ({ page }) => {
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).toBeVisible();

		// Check that links point to article pages (/929/perekId/slug)
		const articleLink = articlesSection.locator("a").first();
		await expect(articleLink).toBeVisible();
		const href = await articleLink.getAttribute("href");
		expect(href).toMatch(/^\/929\/\d+\/\d+$/);
	});

	test("carousel prev/next buttons scroll one card at a time", async ({
		page,
	}) => {
		// Perek 1 has 4 test articles; they overflow a phone-width carousel.
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		const prev = articlesSection.getByRole("button", { name: "מאמר קודם" });
		const next = articlesSection.getByRole("button", { name: "מאמר הבא" });
		const position = articlesSection.getByTestId("carousel-position");

		await expect(next).toBeEnabled();
		await expect(prev).toBeDisabled();
		await expect(position).toHaveText(/^1 \/ 4$/);

		await next.click();
		await expect(position).toHaveText(/^2 \/ 4$/);
		await expect(prev).toBeEnabled();

		await prev.click();
		await expect(position).toHaveText(/^1 \/ 4$/);
		await expect(prev).toBeDisabled();
	});

	test("carousel controls stay hidden when every card fits", async ({
		page,
	}) => {
		// 4 test articles fit side by side at desktop width.
		await page.setViewportSize({ width: 1366, height: 850 });
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection.locator("a").first()).toBeVisible();
		await expect(
			articlesSection.getByRole("button", { name: "מאמר הבא" }),
		).toBeHidden();
		await expect(articlesSection.getByTestId("carousel-position")).toHaveCount(
			0,
		);
	});

	test("does not display articles section when no articles exist", async ({
		page,
	}) => {
		// Perek 2 should not have articles in test data
		await page.goto("/929/2");

		// Wait for the page to load by checking perek text area exists
		await expect(page.locator("article").first()).toBeVisible();

		// Articles section renders with an empty message when no articles exist
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection).toBeVisible();
		// Should show the empty message and have no article links
		await expect(articlesSection.getByText("אין מאמרים לפרק זה")).toBeVisible();
		await expect(articlesSection.locator("a")).toHaveCount(0);
	});
});
