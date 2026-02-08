import { expect, test } from "@playwright/test";

test.describe("/929/authors page", () => {
	test("renders authors listing page with title", async ({ page }) => {
		await page.goto("/929/authors");

		// Check page title
		await expect(page.locator("h1")).toContainText("הרבנים");

		// Check the page loads without errors
		expect(page.url()).toContain("/929/authors");
	});

	test("has blue navigation bar", async ({ page }) => {
		await page.goto("/929/authors");

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
		const authorsLink = page.locator('a[href="/929/authors"]');
		await expect(authorsLink).toBeVisible();
		await expect(authorsLink).toContainText("הרבנים");
	});

	test("navigates from menu to authors page", async ({ page }) => {
		await page.goto("/");

		// Open the hamburger menu
		await page.click('label[for="menu-toggle"]');

		// Click the authors link
		await page.click('a[href="/929/authors"]');

		// Should navigate to authors page
		await page.waitForURL("**/929/authors");
		await expect(page.locator("h1")).toContainText("הרבנים");
	});

	test("/929/rabbis alias redirects to authors", async ({ page }) => {
		await page.goto("/929/rabbis");

		// Should land on the authors listing (rewrite is transparent)
		await expect(page.locator("h1")).toContainText("הרבנים");
	});

	test("legacy /authors redirects to /929/authors", async ({ request }) => {
		const response = await request.get("/authors", {
			maxRedirects: 0,
		});

		// Permanent redirect (308 for Next.js permanent redirects)
		expect([301, 308]).toContain(response.status());
		const location = response.headers().location;
		expect(location).toContain("/929/authors");
	});
});
