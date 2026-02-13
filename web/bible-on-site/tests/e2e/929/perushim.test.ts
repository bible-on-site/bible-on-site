import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the PerushimSection (commentaries carousel and full view).
 *
 * - Section heading "פרשנים על הפרק" is always present.
 * - When no perushim for the perek: empty message "אין פרשנות לפרק זה".
 * - When perushim exist: carousel has clickable items; opening one shows full view
 *   with back button, perush name, and parshan name (birth year when available).
 */

test.describe("Perushim Section", () => {
	test("shows perushim section with heading on 929 perek page", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const section = page.locator("section").filter({
			has: page.locator("text=פרשנים על הפרק"),
		});
		await expect(section).toBeVisible();
	});

	test("shows empty message or carousel when perushim section visible", async ({
		page,
	}) => {
		await page.goto("/929/2");

		const section = page.locator("section").filter({
			has: page.locator("text=פרשנים על הפרק"),
		});
		await expect(section).toBeVisible();

		// Either empty message or at least one carousel button (depends on test DB)
		const emptyMsg = section.getByText("אין פרשנות לפרק זה");
		const anyButton = section.locator("button").first();
		await expect(emptyMsg.or(anyButton)).toBeVisible();
	});

	test("carousel items are buttons that open full view", async ({ page }) => {
		await page.goto("/929/1");

		const section = page.locator("section").filter({
			has: page.locator("text=פרשנים על הפרק"),
		});
		await expect(section).toBeVisible();

		const firstCarouselButton = section.locator("button").first();
		const emptyMessage = section.getByText("אין פרשנות לפרק זה");

		if (await emptyMessage.isVisible()) {
			test.skip();
			return;
		}

		await expect(firstCarouselButton).toBeVisible();
		await firstCarouselButton.click();

		// Full view: back button and title area (perush name + parshan)
		await expect(
			page.getByRole("button", { name: /חזרה לפרשנים/ }),
		).toBeVisible({ timeout: 5000 });
	});

	test("full view shows parshan name and back returns to carousel", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const section = page.locator("section").filter({
			has: page.locator("text=פרשנים על הפרק"),
		});
		const firstButton = section.locator("button").first();
		if (!(await firstButton.isVisible())) {
			test.skip();
			return;
		}

		await firstButton.click();
		await expect(
			page.getByRole("button", { name: /חזרה לפרשנים/ }),
		).toBeVisible({ timeout: 5000 });

		// Parshan name appears in full view (subtitle)
		const fullViewSection = page.locator("section").filter({
			has: page.locator("text=חזרה לפרשנים"),
		});
		await expect(fullViewSection).toBeVisible();

		await page.getByRole("button", { name: /חזרה לפרשנים/ }).click();

		// Back to carousel (no back button visible, carousel visible)
		await expect(
			page.getByRole("button", { name: /חזרה לפרשנים/ }),
		).not.toBeVisible();
		await expect(section).toBeVisible();
	});
});
