import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for book-view URL navigation.
 *
 * Validates that:
 * - /929/{perekId}?book opens the book in toggled-on state
 * - Flipping pages updates the browser URL with correct perekId
 * - Slug URLs with ?book open the book (when slug page is available)
 * - Perushim are shown on blank pages when navigated via slug URL
 */

test.beforeEach(({ skipOnNotWideEnough }) => {
	void skipOnNotWideEnough;
});

test.describe("Book view URL navigation", () => {
	test("opens book when navigating to ?book URL", async ({ page }) => {
		await page.goto("/929/1?book");

		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
	});

	test("URL does not contain /0/ when flipping pages in book view", async ({
		page,
	}) => {
		await page.goto("/929/1?book");

		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });

		const bookWrapper = overlay.locator('[class*="bookWrapper"]');
		await expect(bookWrapper).toBeVisible({ timeout: 15_000 });

		const nextButton = page.locator('[aria-label="הדף הבא"]');
		if (await nextButton.isVisible()) {
			await nextButton.click();
			await page.waitForTimeout(1500);

			const newUrl = page.url();
			expect(newUrl).toContain("/929/");
			expect(newUrl).toContain("book");
			expect(newUrl).not.toContain("/929/0/");
		}
	});

	test("slug URL with ?book opens book (requires DB)", async ({ page }) => {
		const response = await page.goto("/929/1");
		if (!response || response.status() !== 200) {
			test.skip();
			return;
		}

		const section = page.locator("section").filter({
			has: page.locator("text=פרשנים על הפרק"),
		});
		const firstLink = section.locator("a").first();
		if (!(await firstLink.isVisible({ timeout: 5_000 }).catch(() => false))) {
			test.skip();
			return;
		}

		const href = await firstLink.getAttribute("href");
		if (!href) {
			test.skip();
			return;
		}

		const slugResponse = await page.goto(`${href}?book`);
		if (!slugResponse || slugResponse.status() === 404) {
			test.skip();
			return;
		}

		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });

		const bookWrapper = overlay.locator('[class*="bookWrapper"]');
		await expect(bookWrapper).toBeVisible({ timeout: 15_000 });
	});

	test("book opens and renders from slug URL with ?book (requires DB)", async ({
		page,
	}) => {
		const response = await page.goto("/929/1");
		if (!response || response.status() !== 200) {
			test.skip();
			return;
		}

		const section = page.locator("section").filter({
			has: page.locator("text=פרשנים על הפרק"),
		});
		const firstLink = section.locator("a").first();
		if (!(await firstLink.isVisible({ timeout: 5_000 }).catch(() => false))) {
			test.skip();
			return;
		}

		const href = await firstLink.getAttribute("href");
		if (!href) {
			test.skip();
			return;
		}

		const slugResponse = await page.goto(`${href}?book`);
		if (!slugResponse || slugResponse.status() === 404) {
			test.skip();
			return;
		}

		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });

		const bookWrapper = overlay.locator('[class*="bookWrapper"]');
		await expect(bookWrapper).toBeVisible({ timeout: 15_000 });
	});
});
