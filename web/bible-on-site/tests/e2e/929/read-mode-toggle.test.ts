import { expect, test } from "../../util/playwright/test-fixture";

const BASE_URL = "/929";

// Skip all tests in this file on mobile viewports - sefer view requires tablet+
test.beforeEach(({ skipOnNotWideEnough }) => {
	void skipOnNotWideEnough;
});

async function toggleSefer(page: import("@playwright/test").Page) {
	const toggler = page.getByTestId("read-mode-toggler");
	await toggler.scrollIntoViewIfNeeded();
	await toggler.click({ timeout: 10_000 });
}

test("Hides perek breadcrumbs when toggling to sefer view", async ({
	page,
}) => {
	const perekId = 1;
	await page.goto(`${BASE_URL}/${perekId}`);
	const perekBreadCrumbs = page.getByTestId(`perek-breadcrumb-${perekId}`);
	await expect(perekBreadCrumbs).toBeVisible();

	await toggleSefer(page);

	const seferOverlay = page.locator('[class*="seferOverlay"]');
	await expect(seferOverlay).toBeVisible({ timeout: 10_000 });
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

	// Toggle ON
	await toggleSefer(page);

	const seferOverlay = page.locator('[class*="seferOverlay"]');
	await expect(seferOverlay).toBeVisible({ timeout: 10_000 });

	// Wait for the lazy-loaded Sefer component to mount inside the overlay,
	// confirming the React startTransition has committed. Without this the
	// second click can land during the concurrent render and the toggle
	// state change may be dropped.
	await expect(
		seferOverlay.locator('[class*="bookWrapper"]'),
	).toBeVisible({ timeout: 15_000 });

	// Toggle OFF
	await toggleSefer(page);

	// Auto-retry until the overlay animation completes and display becomes none
	await expect(seferOverlay).toBeHidden({ timeout: 10_000 });
});
