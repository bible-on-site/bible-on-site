import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E smoke test: visit key routes so they are exercised in the coverage run.
 * Ensures app/page, authors/page, authors/layout, [section]/page, article page,
 * AppSection, ScrollToSection, lib/authors (server-side) etc. are loaded.
 */

test.describe("Key routes load", () => {
	test("root, authors list, section page, perek, article load without error", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(page).toHaveTitle('תנ"ך על הפרק');
		await expect(page.getByRole("heading", { name: /תנ"ך על הפרק/ })).toBeVisible();

		await page.goto("/authors");
		await expect(page.locator("h1")).toContainText("הרבנים");

		await page.goto("/contact");
		await expect(page.getByRole("heading", { name: "יצירת קשר" })).toBeVisible();

		await page.goto("/929/1");
		await expect(page.locator("article").first()).toBeVisible();

		await page.goto("/929/1/1");
		await expect(page.locator("#article-view")).toBeVisible({ timeout: 10_000 });
	});
});
