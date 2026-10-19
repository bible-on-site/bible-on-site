import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E for the public accessibility statement (#2396): direct URL loads,
 * structured content, working contact routes and a way back.
 */
test.describe("Accessibility statement page", () => {
	test("loads directly with title and main heading", async ({ page }) => {
		const response = await page.goto("/accessibility");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle('הצהרת נגישות | תנ"ך על הפרק');
		await expect(
			page.getByRole("heading", { level: 1, name: "הצהרת נגישות" }),
		).toBeVisible();
	});

	test("covers website and app separately, lists limitations and a review date", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const main = page.getByRole("main");
		await expect(
			main.getByRole("heading", { name: /נגישות באתר/ }),
		).toBeVisible();
		await expect(
			main.getByRole("heading", { name: /נגישות ביישומון/ }),
		).toBeVisible();
		await expect(main.getByRole("heading", { name: /מגבלות/ })).toBeVisible();
		await expect(main.getByText(/עודכנה לאחרונה/)).toBeVisible();
	});

	test("offers working contact routes and a way back to the service", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const main = page.getByRole("main");
		await expect(
			main.getByRole("link", { name: "tanah.site@gmail.com" }),
		).toHaveAttribute("href", "mailto:tanah.site@gmail.com");
		await expect(main.getByRole("link", { name: "ווטסאפ" })).toHaveAttribute(
			"href",
			"https://wa.me/37257078640",
		);
		await expect(
			main.getByRole("link", { name: "חזרה לעמוד הראשי" }),
		).toHaveAttribute("href", "/");
	});
});
