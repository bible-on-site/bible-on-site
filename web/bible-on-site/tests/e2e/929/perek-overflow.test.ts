import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for perek view layout (issue #1270).
 * Ensures the perek page does not allow horizontal overflow beyond content boundaries.
 */

test.describe("Perek view horizontal overflow", () => {
	test("perek page has no horizontal overflow", async ({ page }) => {
		await page.goto("/929/1");

		await page.getByRole("article").waitFor({ state: "visible" });

		const hasHorizontalOverflow = await page.evaluate(() => {
			const { documentElement } = document;
			return documentElement.scrollWidth > documentElement.clientWidth;
		});

		expect(hasHorizontalOverflow, "perek page must not have horizontal overflow (issue #1270)").toBe(false);
	});

	test("perek page with articles has no horizontal overflow", async ({
		page,
	}) => {
		await page.goto("/929/1");

		await page.locator("section").filter({ hasText: "מאמרים" }).waitFor({ state: "visible" });

		const hasHorizontalOverflow = await page.evaluate(() => {
			const { documentElement } = document;
			return documentElement.scrollWidth > documentElement.clientWidth;
		});

		expect(hasHorizontalOverflow).toBe(false);
	});
});
