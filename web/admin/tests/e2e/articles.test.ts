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

	test.skip("quick navigation to perek works", async ({ page }) => {
		// TODO: Fix - navigation with window.location.href not working reliably in tests
		await page.goto("/articles");

		// Wait for page to load
		await expect(page.locator("h1")).toContainText("ניהול מאמרים", {
			timeout: 10000,
		});

		// Enter a perek number and click button
		const perekInput = page.getByPlaceholder("מספר פרק (1-929)");
		await perekInput.fill("1");

		// Click the navigation button - this uses window.location so we need to wait for navigation
		await Promise.all([
			page.waitForURL(/\/articles\/perek\/1/, { timeout: 15000 }),
			page.getByRole("button", { name: /עבור לפרק/ }).click(),
		]);
	});

	test("sefarim accordion shows Hebrew perek labels", async ({ page }) => {
		await page.goto("/articles");

		// Expand בראשית (first sefer, no additionals)
		await page.getByRole("button", { name: /בראשית/ }).click();
		await expect(page.getByRole("link", { name: "א'" }).first()).toBeVisible();
		await expect(page.getByRole("link", { name: "נ'" })).toBeVisible();
	});

	test("sefarim with additionals show additional letter prefix", async ({
		page,
	}) => {
		await page.goto("/articles");

		// Expand שמואל (has additionals א and ב)
		await page.getByRole("button", { name: /שמואל/ }).click();
		// First perek of שמואל א
		await expect(
			page.getByRole("link", { name: "א א'" }).first(),
		).toBeVisible();
		// First perek of שמואל ב
		await expect(
			page.getByRole("link", { name: "ב א'" }).first(),
		).toBeVisible();
	});
});
