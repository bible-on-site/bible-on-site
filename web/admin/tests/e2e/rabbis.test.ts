import { expect, test } from "@playwright/test";

test.describe("Rabbis Management", () => {
	test("displays rabbis list with authors", async ({ page }) => {
		await page.goto("/rabbis");

		await expect(page.locator("h1")).toContainText("ניהול רבנים", {
			timeout: 10000,
		});
		// Test data has 4 authors
		await expect(page.getByText("4 רבנים במערכת")).toBeVisible();
		// At least one edit link should be visible
		await expect(
			page.getByRole("link", { name: "עריכה" }).first(),
		).toBeVisible();
	});

	test("can navigate to new rabbi form", async ({ page }) => {
		await page.goto("/rabbis");

		await page.getByRole("link", { name: "+ רב חדש" }).click();
		await expect(page).toHaveURL("/rabbis/new");
		await expect(page.locator("h1")).toContainText("רב חדש");
	});

	test("new rabbi form has required fields", async ({ page }) => {
		await page.goto("/rabbis/new");

		// Check form fields exist
		await expect(page.getByLabel("שם הרב")).toBeVisible();
		await expect(page.getByLabel("פרטים")).toBeVisible();

		// Image upload should show "save first" message for new rabbi
		await expect(page.getByText("שמור את הרב לפני")).toBeVisible();
	});

	test("can edit existing rabbi", async ({ page }) => {
		await page.goto("/rabbis");

		// Click edit on first rabbi (if exists)
		const editLink = page.getByRole("link", { name: "עריכה" }).first();
		if (await editLink.isVisible()) {
			await editLink.click();
			await expect(page).toHaveURL(/\/rabbis\/\d+/);
			await expect(page.locator("h1")).toContainText("עריכת רב");
		}
	});
});
