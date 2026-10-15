import { expect, test } from "../util/playwright/test-fixture";

const TOP_NAV_BLUE = "rgb(21, 82, 172)"; // #1552ac, the shared site top bar

async function topNavBackground(page: import("@playwright/test").Page) {
	const topNav = page.locator("nav.top-nav");
	await expect(topNav).toBeVisible();
	return topNav.evaluate(
		(el) => window.getComputedStyle(el).backgroundColor,
	);
}

test.describe("/לוח learning calendar", () => {
	test("renders the shared blue top bar on direct load", async ({ page }) => {
		await page.goto("/לוח");
		await expect(
			page.getByRole("heading", { name: "לוח לימוד יומי" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar when navigating from another page", async ({
		page,
	}) => {
		await page.goto("/");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		await page
			.locator("#main-menu")
			.getByRole("link", { name: "לוח לימוד יומי", exact: true })
			.click();
		await page.waitForURL(
			(url) => decodeURIComponent(url.pathname) === "/לוח",
		);
		await expect(
			page.getByRole("heading", { name: "לוח לימוד יומי" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar after switching month", async ({
		page,
	}) => {
		await page.goto("/לוח");
		await page.getByRole("button", { name: "חודש הבא" }).click();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});
});
