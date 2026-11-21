import { expect, test } from "../util/playwright/test-fixture";

// Regression coverage for #2477: .menuList is a scroll container
// (overflow-y: auto), which makes overflow-x compute to `auto` too - any
// overhang then produces a redundant bottom scrollbar. The status ribbons
// that first triggered it are gone (#3702), but grouped sections and the
// active-item accent still need the same guarantee.

test.describe("NavBar hamburger menu layout", () => {
	test("has no horizontal overflow", async ({ page }) => {
		await page.goto("/accessibility");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const menu = page.locator("#main-menu");
		const list = menu.locator(":scope > ul");

		const result = await list.evaluate((el) => ({
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
		}));

		expect(
			result.scrollWidth,
			"menu list must not scroll horizontally",
		).toBeLessThanOrEqual(result.clientWidth);
	});

	test("still scrolls vertically to reach תרומות on short viewports without horizontal overflow", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 320 });
		await page.goto("/accessibility");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const list = page.locator("#main-menu > ul");

		const metrics = await list.evaluate((el) => ({
			clientHeight: el.clientHeight,
			scrollHeight: el.scrollHeight,
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
		}));
		expect(
			metrics.scrollHeight,
			"short viewport must overflow vertically",
		).toBeGreaterThan(metrics.clientHeight);

		await list.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(
			page.locator("#main-menu").getByRole("link", { name: "תרומות" }),
		).toBeInViewport();

		const after = await list.evaluate((el) => ({
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
		}));
		expect(
			after.scrollWidth,
			"scrolled menu must not scroll horizontally",
		).toBeLessThanOrEqual(after.clientWidth);
	});
});
