// import { test, expect } from "@playwright/test";

import { expect, test } from "../../util/playwright/test-fixture";

const ROOT_URL = "/";

test.describe("Root page", () => {
	test("Has correct title", async ({ page }) => {
		await page.goto(ROOT_URL);
		await expect(page).toHaveTitle('תנ"ך על הפרק');
	});

	test("Shows daily learning link", async ({ page }) => {
		await page.goto(ROOT_URL);
		const dailyLearningLink = page.getByRole("link", {
			name: "לימוד יומי על הפרק",
		});
		await expect(dailyLearningLink).toBeVisible();
	});

	test("Shows app section", async ({ page }) => {
		await page.goto(ROOT_URL);
		const appSection = page.getByRole("heading", {
			name: 'ישומון תנ"ך על הפרק',
		});
		await expect(appSection).toBeVisible();
	});
});
