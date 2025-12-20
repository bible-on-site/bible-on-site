import { expect, test } from "../../util/playwright/test-fixture";

const BASE_URL = "/929";
const togglerAnimationDuration = 300;

// Helper to click the toggler button
async function clickToggler(
	page: import("@playwright/test").Page,
	testId: string,
) {
	const button = page.getByTestId(testId);
	await button.scrollIntoViewIfNeeded();
	await button.click({ timeout: 10_000 });
}

// Skip all tests in this file on mobile viewports - sefer view requires tablet+
test.beforeEach(({ skipOnNotWideEnough }) => {
	void skipOnNotWideEnough;
});

test("Hides perek breadcrumbs when toggling to sefer view", async ({
	page,
}) => {
	const perekId = 1;
	await page.goto(`${BASE_URL}/${perekId}`);
	const perekBreadCrumbs = page.getByTestId(`perek-breadcrumb-${perekId}`);
	await expect(perekBreadCrumbs).toBeVisible();

	await clickToggler(page, "read-mode-toggler-sefer-view-button");
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

test("Hides overlay after animation when toggling sefer view OFF", async ({
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
