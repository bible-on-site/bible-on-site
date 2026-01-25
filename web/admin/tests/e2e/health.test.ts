import { expect, test } from "@playwright/test";

test.describe("Admin App Health", () => {
	test("homepage loads", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("h1")).toContainText("ברוכים הבאים");
	});

	test("navigation works", async ({ page }) => {
		await page.goto("/");

		// Navigate to rabbis via navbar (first link with that name)
		await page.getByRole("link", { name: "רבנים" }).first().click();
		await expect(page).toHaveURL("/rabbis");
		// Wait for page to fully load
		await expect(page.locator("h1")).toContainText("ניהול רבנים", {
			timeout: 10000,
		});

		// Navigate to articles via navbar
		await page.getByRole("link", { name: "מאמרים" }).first().click();
		await expect(page).toHaveURL("/articles");
		await expect(page.locator("h1")).toContainText("ניהול מאמרים", {
			timeout: 10000,
		});

		// Navigate back home
		await page.getByRole("link", { name: "בית" }).click();
		await expect(page).toHaveURL("/");
	});
});
