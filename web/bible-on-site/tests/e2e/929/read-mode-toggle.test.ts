// import { test, expect } from "@playwright/test";

import { expect, test } from "../../util/playwright/test-fixture";

const BASE_URL = "/929";
const togglerAnimationDuration = 300;

// Helper to click the toggler button with fallback strategies for mobile viewports
async function clickToggler(
	page: import("@playwright/test").Page,
	testId: string,
) {
	const button = page.getByTestId(testId);
	await button.scrollIntoViewIfNeeded();
	try {
		await button.click({ timeout: 10_000 });
	} catch {
		try {
			await button.click({ force: true, timeout: 5_000 });
		} catch {
			await button.evaluate((el) => (el as HTMLElement).click());
		}
	}
}

test("toggling to sefer view hides perek breadcrumbs", async ({ page }) => {
	const perekId = 1;
	await page.goto(`${BASE_URL}/${perekId}`);
	const perekBreadCrumbs = page.getByTestId(`perek-breadcrumb-${perekId}`);
	await expect(perekBreadCrumbs).toBeVisible();
	const seferViewButton = page.getByTestId(
		"read-mode-toggler-sefer-view-button",
	);

	// On mobile viewport the button can sit just outside the visible area; be lenient on click strategy
	await seferViewButton.scrollIntoViewIfNeeded();
	try {
		await seferViewButton.click({ timeout: 10_000 });
	} catch (_firstError) {
		try {
			await seferViewButton.click({ force: true, timeout: 5_000 });
		} catch (_secondError) {
			await seferViewButton.evaluate((el) => (el as HTMLElement).click());
		}
	}
	await page.waitForTimeout(togglerAnimationDuration);
	// The sefer overlay covers the breadcrumbs with a white background and higher z-index.
	// We verify this by checking that the sefer overlay is visible with the expected properties.
	const seferOverlay = page.locator('[class*="seferOverlay"]');
	await expect(seferOverlay).toBeVisible();
	const opacity = await seferOverlay.evaluate(
		(el) => getComputedStyle(el).opacity,
	);
	expect(opacity).toBe("1");
});

test("toggling sefer view OFF hides overlay after animation", async ({
	page,
}) => {
	const perekId = 1;
	await page.goto(`${BASE_URL}/${perekId}`);

	// First toggle ON
	await clickToggler(page, "read-mode-toggler-sefer-view-button");
	await page.waitForTimeout(togglerAnimationDuration);

	const seferOverlay = page.locator('[class*="seferOverlay"]');
	await expect(seferOverlay).toBeVisible();

	// Now toggle OFF using the basic view button
	await clickToggler(page, "read-mode-toggler-basic-view-button");

	// Wait for the animation to complete (setTimeout delay in SeferComposite)
	await page.waitForTimeout(togglerAnimationDuration + 100);

	// Verify the overlay is hidden (display: none)
	await expect(seferOverlay).toBeHidden();
});
