import { expect, test } from "@playwright/test";

test.describe("Articles Management", () => {
	test("displays articles navigation", async ({ page }) => {
		await page.goto("/articles");

		await expect(page.locator("h1")).toContainText("ניהול מאמרים");
		// Should have quick navigation input
		await expect(page.getByPlaceholder("מספר פרק")).toBeVisible();
	});

	test("can navigate to new article form", async ({ page }) => {
		await page.goto("/articles");

		await page.getByRole("link", { name: "+ מאמר חדש" }).click();
		await expect(page).toHaveURL(/\/articles\/new/);
		await expect(page.locator("h1")).toContainText("מאמר חדש");
	});

	test("new article form has required fields", async ({ page }) => {
		await page.goto("/articles/new");

		// Check form fields exist
		await expect(page.getByLabel("שם המאמר")).toBeVisible();
		await expect(page.getByLabel("מחבר")).toBeVisible();
		await expect(page.getByLabel(/פרק/)).toBeVisible();
		await expect(page.getByLabel("עדיפות")).toBeVisible();
	});

	test("quick navigation to perek works", async ({ page }) => {
		await page.goto("/articles");

		// Enter a perek number
		await page.getByPlaceholder("מספר פרק").fill("1");
		await page.getByRole("button", { name: "עבור לפרק" }).click();

		await expect(page).toHaveURL("/articles/perek/1");
	});

	test("sefarim accordion expands", async ({ page }) => {
		await page.goto("/articles");

		// Find and click first sefer
		const firstSefer = page.locator("button").filter({ hasText: /▼/ }).first();
		if (await firstSefer.isVisible()) {
			await firstSefer.click();
			// Should show perek links
			await expect(page.getByRole("link", { name: "1" }).first()).toBeVisible();
		}
	});
});
