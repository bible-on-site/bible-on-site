import { expect, test } from "../util/playwright/test-fixture";

test.describe("/929/authors page", () => {
	test("renders authors listing page with title", async ({ page }) => {
		await page.goto("/929/authors");

		// Check page title
		await expect(page.locator("h1")).toContainText("הרבנים");

		// Check the page loads without errors
		expect(page.url()).toContain("/929/authors");
	});

	test("has blue navigation bar", async ({ page }) => {
		await page.goto("/929/authors");

		// The top-nav should have blue background color
		const topNav = page.locator(".top-nav");
		await expect(topNav).toBeVisible();

		// Check the computed background color
		const bgColor = await topNav.evaluate((el) => {
			return window.getComputedStyle(el).backgroundColor;
		});

		// #1552ac converts to rgb(21, 82, 172)
		expect(bgColor).toBe("rgb(21, 82, 172)");
	});

	test("has link to authors in navbar", async ({ page }) => {
		await page.goto("/");

		// Open the hamburger menu
		await page.getByRole("button", { name: "תפריט ראשי" }).click();

		// Find the authors link in the menu (the homepage counters link to
		// /929/authors too — scope to the opened nav).
		const menu = page.getByRole("navigation", { name: "תפריט ראשי" });
		const authorsLink = menu.locator('a[href="/929/authors"]');
		await expect(authorsLink).toBeVisible();
		await expect(authorsLink).toContainText("הרבנים");
	});

	test("navigates from menu to authors page", async ({ page }) => {
		await page.goto("/");

		// Open the hamburger menu
		await page.getByRole("button", { name: "תפריט ראשי" }).click();

		// Click the authors link (scoped — the counters link there too)
		await page
			.getByRole("navigation", { name: "תפריט ראשי" })
			.locator('a[href="/929/authors"]')
			.click();

		// Should navigate to authors page
		await page.waitForURL("**/929/authors");
		await expect(page.locator("h1")).toContainText("הרבנים");
	});

	test("/929/rabbis alias redirects to authors", async ({ page }) => {
		await page.goto("/929/rabbis");

		// Should land on the authors listing (rewrite is transparent)
		await expect(page.locator("h1")).toContainText("הרבנים");
	});

	test("legacy /authors redirects to /929/authors", async ({ request }) => {
		const response = await request.get("/authors", {
			maxRedirects: 0,
		});

		// Permanent redirect (308 for Next.js permanent redirects)
		expect([301, 308]).toContain(response.status());
		const location = response.headers().location;
		expect(location).toContain("/929/authors");
	});

	test("serves the blue sketch asset", async ({ request }) => {
		const response = await request.get("/images/rabbis-blue-sketch.webp");

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("image/webp");
	});

	test("paints the blue sketch as a fixed backdrop behind the index", async ({
		page,
	}) => {
		await page.goto("/929/authors");

		const backdrop = await page.locator("main").evaluate((el) => {
			const style = window.getComputedStyle(el, "::before");
			return {
				backgroundImage: style.backgroundImage,
				position: style.position,
			};
		});

		// Fixed keeps the congregation scene recognizable while the grid scrolls.
		expect(backdrop.position).toBe("fixed");
		expect(backdrop.backgroundImage).toContain("rabbis-blue-sketch.webp");
	});

	test("keeps the sketch as a subdued etching in dark mode", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/929/authors");

		const backgroundImage = await page
			.locator("main")
			.evaluate(
				(el) => window.getComputedStyle(el, "::before").backgroundImage,
			);

		expect(backgroundImage).toContain("rabbis-blue-sketch.webp");
		// Dark scrim layer (--background #0f1219) keeps dark surfaces readable.
		expect(backgroundImage).toContain("15, 18, 25");
	});

	test("drops the decorative backdrop under high-contrast preference", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem(
				"siteA11ySettings",
				JSON.stringify({ contrast: true }),
			);
		});
		await page.goto("/929/authors");
		await expect(page.locator("html")).toHaveAttribute(
			"data-a11y-contrast",
			"high",
		);

		const content = await page
			.locator("main")
			.evaluate((el) => window.getComputedStyle(el, "::before").content);

		expect(content).toBe("none");
	});
});
