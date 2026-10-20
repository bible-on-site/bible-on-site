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

	test("Shows מספרים על הפרק counters with database totals", async ({
		page,
	}) => {
		await page.goto(ROOT_URL);
		const section = page.locator("#numbers");
		await expect(
			section.getByRole("heading", { name: "מספרים על הפרק" }),
		).toBeVisible();
		// Scroll trigger starts the shared count-up; fixture data (4 public
		// articles) must settle at the exact totals. רבנים is the fixed word
		// עשרות by design, never a number (#2397).
		await section.scrollIntoViewIfNeeded();
		const expected: [string, RegExp][] = [
			["רבנים כותבים על הפרק", /^עשרות$/],
			["מאמרים על הפרק", /^4$/],
			["ערכים על הפרק בתנכפדיה", /^\d[\d,]*$/],
			["פרקים מוקלטים", /^\d[\d,]*$/],
			["שנים שהתוכנית רצה", /^\d+$/],
		];
		for (const [label, value] of expected) {
			const stat = section.locator("dl > div", { hasText: label });
			await expect(stat.locator('[aria-hidden="true"]')).toHaveText(value, {
				timeout: 10_000,
			});
		}
	});

	test("Footer links to the accessibility statement", async ({ page }) => {
		await page.goto(ROOT_URL);
		const link = page
			.locator("footer")
			.getByRole("link", { name: "הצהרת נגישות" });
		await expect(link).toHaveAttribute("href", "/accessibility");
	});
});
