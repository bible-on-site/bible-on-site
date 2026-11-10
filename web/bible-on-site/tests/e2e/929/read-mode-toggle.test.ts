import { expect, test } from "../../util/playwright/test-fixture";

const BASE_URL = "/929";

// Skip all tests in this file on mobile viewports - sefer view requires tablet+
test.beforeEach(({ skipOnNotWideEnough }) => {
	void skipOnNotWideEnough;
});

async function toggleSeferOn(page: import("@playwright/test").Page) {
	const toggler = page.getByTestId("read-mode-toggler");
	const checkbox = toggler.locator("input");
	const overlay = page.locator('[class*="seferOverlay"]');

	await toggler.scrollIntoViewIfNeeded();

	await expect(async () => {
		if (!(await checkbox.isChecked())) {
			await toggler.click();
		}
		await expect(overlay).toBeVisible();
	}).toPass({ timeout: 15_000 });
	await expect(checkbox).toBeChecked({ timeout: 5_000 });
}

async function toggleSeferOff(page: import("@playwright/test").Page) {
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

	await toggleSeferOn(page);

	const seferOverlay = page.locator('[class*="seferOverlay"]');
	await expect(seferOverlay).toBeVisible({ timeout: 10_000 });
	await expect(seferOverlay).toHaveCSS("opacity", "1", { timeout: 5_000 });
});

test("Hides overlay after animation when toggling sefer view OFF", async ({
	page,
}) => {
	const perekId = 1;
	await page.goto(`${BASE_URL}/${perekId}`);

	// Toggle ON
	await toggleSeferOn(page);

	const seferOverlay = page.locator('[class*="seferOverlay"]');

	await expect(seferOverlay).toHaveCSS("opacity", "1", { timeout: 5_000 });

	// Toggle OFF
	await toggleSeferOff(page);

	// Auto-retry until the overlay animation completes and display becomes none
	await expect(seferOverlay).toBeHidden({ timeout: 10_000 });
});

test("Keeps the usable viewport width constant across the sefer scroll lock", async ({
	page,
}) => {
	// Regression guard for a CLS alert: the perek reader scrolls inside
	// .perekContainer, so the root has no scrollbar — any width-affecting
	// rule tied to the lock (a scrollbar or a reserved scrollbar-gutter
	// appearing/disappearing on toggle) shifts the layout by ~15px, which
	// Bencher's CLS measure scores when it lands outside the input window.
	const viewportWidth = () =>
		page.evaluate(() => document.documentElement.clientWidth);

	await page.goto(`${BASE_URL}/1`);
	const widthBefore = await viewportWidth();

	await toggleSeferOn(page);
	const widthLocked = await viewportWidth();

	await toggleSeferOff(page);
	await expect(page.locator("html")).not.toHaveAttribute("data-book-view", {
		timeout: 10_000,
	});
	const widthAfter = await viewportWidth();

	expect(widthLocked).toBe(widthBefore);
	expect(widthAfter).toBe(widthBefore);
});
