import type { Page, Response } from "@playwright/test";
import { expect, test } from "../util/playwright/test-fixture";

// Every human-facing miss must render the same branded Hebrew missing-page
// through the shared app/not-found component — a real 404 status, noindex,
// and a working home recovery link. No soft-200s, no stock framework or
// router fallback (issue #2935).
const PASUK = "הֲתָעִיף עֵינֶיךָ בּוֹ וְאֵינֶנּוּ";
const HOME_LINK = "חזרה לעמוד הראשי";

async function expectBrandedMissingPage(page: Page, response: Response | null) {
	expect(response?.status()).toBe(404);
	await expect(page).toHaveTitle("העמוד לא נמצא");
	await expect(page.getByRole("heading", { level: 1 })).toContainText(PASUK);
	const home = page.getByRole("link", { name: HOME_LINK });
	await expect(home).toHaveAttribute("href", "/");
	// A missing page must never be indexed as content.
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		"content",
		/noindex/,
	);
}

test.describe("uniform missing-page 404", () => {
	test("unknown top-level path", async ({ page }) => {
		const response = await page.goto("/__missing_page__");
		await expectBrandedMissingPage(page, response);
	});

	test("invalid dynamic route stays on the shared page", async ({ page }) => {
		// A perek outside 1..929 calls notFound() — the same branded
		// component, not a route-local error design.
		const response = await page.goto("/929/999999");
		await expectBrandedMissingPage(page, response);
	});

	test("invalid pedia entry stays on the shared page", async ({ page }) => {
		const response = await page.goto("/pedia/__missing_entry__");
		await expectBrandedMissingPage(page, response);
	});

	test("missing author shows the shared page title", async ({ page }) => {
		// Regression: this route used to title the same branded page
		// 'הרב לא נמצא | תנ"ך באתר' instead of העמוד לא נמצא (#2935).
		const response = await page.goto("/929/authors/__missing_author__");
		await expectBrandedMissingPage(page, response);
	});

	test("missing article shows the shared page title", async ({ page }) => {
		// Numeric slug on a real perek = article id; a missing one used to
		// title the page 'מאמר לא נמצא | …' on the same branded 404 (#2935).
		const response = await page.goto("/929/1/999999999");
		await expectBrandedMissingPage(page, response);
	});

	test("out-of-range perek with a slug is a 404, not a 500", async ({
		page,
	}) => {
		// Regression: /929/999999/1 used to throw inside getPerekByPerekId
		// and answer 500 — an invalid route masking as a server fault (#2935).
		const response = await page.goto("/929/999999/1");
		await expectBrandedMissingPage(page, response);
	});

	test("missing perush shows the shared page title", async ({ page }) => {
		const response = await page.goto("/929/1/__missing_perush__");
		await expectBrandedMissingPage(page, response);
	});

	test("direct /404 is the same page, still a real 404", async ({ page }) => {
		const response = await page.goto("/404");
		await expectBrandedMissingPage(page, response);
	});

	test("narrow viewport with dark theme keeps the branded page", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 640 });
		await page.emulateMedia({ colorScheme: "dark" });
		const response = await page.goto("/__missing_page__");
		await expectBrandedMissingPage(page, response);
	});

	test("browser Back from a missing page restores the previous page", async ({
		page,
	}) => {
		await page.goto("/");
		await page.goto("/__missing_page__");
		await page.goBack();
		await expect(page).toHaveTitle('תנ"ך על הפרק');
	});
});
