import { expect, test } from "@playwright/test";

test.describe("Rabbis Management", () => {
	test("displays rabbis list", async ({ page }) => {
		await page.goto("/rabbis");

		await expect(page.locator("h1")).toContainText("ניהול רבנים", {
			timeout: 10000,
		});
		// Should have at least one rabbi card or empty state
		const content = await page.textContent("main");
		expect(content).toBeTruthy();
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
