import { expect, test } from "@playwright/test";

test.describe("Admin App Health", () => {
	test("homepage loads", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("h1")).toContainText("ברוכים הבאים");
	});

	test("navigation works", async ({ page }) => {
		await page.goto("/");

		// Navigate to rabbis
		await page.getByRole("link", { name: "רבנים" }).click();
		await expect(page).toHaveURL("/rabbis");
		await expect(page.locator("h1")).toContainText("ניהול רבנים");

		// Navigate to articles
		await page.getByRole("link", { name: "מאמרים" }).click();
		await expect(page).toHaveURL("/articles");
		await expect(page.locator("h1")).toContainText("ניהול מאמרים");

		// Navigate back home
		await page.getByRole("link", { name: "בית" }).click();
		await expect(page).toHaveURL("/");
	});
});
