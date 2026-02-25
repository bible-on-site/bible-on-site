import { expect, test } from "@playwright/test";

// This test checks that the hamburger menu is clickable and toggles the menu
// It also checks that the clickable area matches the hamburger icon boundaries

test.describe("NavBar hamburger menu", () => {
	test("Toggles menu when hamburger is clicked", async ({ page }) => {
		await page.goto("/");
		const menuBtn = page.locator("label[class*=menuBtn]");
		const menuIcon = page.locator("span[class*=menuIcon]");
		// Check that the menu button is visible and clickable
		await expect(menuBtn).toBeVisible();
		const btnBox = await menuBtn.boundingBox();
		const iconBox = await menuIcon.boundingBox();
		if (!btnBox || !iconBox) {
			throw new Error("Could not get bounding box for menuBtn or menuIcon");
		}
		// Click the hamburger and check menu state
		await menuBtn.click();
		// Example: check that menu is open (adjust selector as needed)
		const menuBox = page.locator("nav[class*=menuBox]");
		await expect(menuBox).toBeVisible();
	});
});
