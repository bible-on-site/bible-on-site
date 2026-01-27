import { expect, test } from "@playwright/test";

test.describe("/authors page", () => {
	test("renders authors listing page with title", async ({ page }) => {
		await page.goto("/authors");

		// Check page title
		await expect(page.locator("h1")).toContainText("הרבנים");

		// Check the page loads without errors
		expect(page.url()).toContain("/authors");
	});

	test("has blue navigation bar", async ({ page }) => {
		await page.goto("/authors");

		// The top-nav should have blue background color
		const topNav = page.locator(".top-nav");
		await expect(topNav).toBeVisible();

		// Check the computed background color
		const bgColor = await topNav.evaluate((el) => {
			return window.getComputedStyle(el).backgroundColor;
		});

		// #1552ac converts to rgb(21, 82, 172)
		expect(bgColor).toBe("rgb(21, 82, 172)");
	});

	test("has link to authors in navbar", async ({ page }) => {
		await page.goto("/");

		// Open the hamburger menu
		await page.click('label[for="menu-toggle"]');

		// Find the authors link in the menu
		const authorsLink = page.locator('a[href="/authors"]');
		await expect(authorsLink).toBeVisible();
		await expect(authorsLink).toContainText("הרבנים");
	});

	test("navigates from menu to authors page", async ({ page }) => {
		await page.goto("/");

		// Open the hamburger menu
		await page.click('label[for="menu-toggle"]');

		// Click the authors link
		await page.click('a[href="/authors"]');

		// Should navigate to authors page
		await page.waitForURL("**/authors");
		await expect(page.locator("h1")).toContainText("הרבנים");
	});
});
