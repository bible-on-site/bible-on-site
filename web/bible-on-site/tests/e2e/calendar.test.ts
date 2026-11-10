import { expect, test } from "../util/playwright/test-fixture";
import { TOP_NAV_BLUE, topNavBackground } from "../util/playwright/top-nav";

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

	test("switches the yearly view between overview grid and vertical flip book", async ({
		page,
	}) => {
		await page.goto("/לוח?view=year");
		await expect(
			page.getByRole("heading", { name: /שנת/ }),
		).toBeVisible();

		// Overview is the default presentation: the mini-month grid renders.
		await expect(page.locator(".cal-book")).toHaveCount(0);

		await page.getByRole("button", { name: "דפדוף" }).click();

		// The lazy-loaded vertical book mounts with its toolbar and spiral
		// binding, and the shareable URL records the presentation.
		const book = page.locator(".cal-book.flipbook--vertical");
		await expect(book).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("toolbar", { name: "FlipBook navigation" }),
		).toBeVisible();
		await expect(page).toHaveURL(/flip=1/);
		// One readable month sheet per visible face.
		await expect(
			book.locator(".page.current-page .cal-sheet__title").first(),
		).toBeVisible();

		// Toolbar navigation advances the month and keeps ?month= in sync.
		const monthBefore = page.url();
		await page.locator(".flipbook-toolbar-next").click();
		await expect
			.poll(() => page.url(), { timeout: 15_000 })
			.not.toBe(monthBefore);
		await expect(page).toHaveURL(/month=\d+/);

		// Returning to the overview restores the grid, clears flip=1, and
		// returns focus to the persistent presentation toggle.
		await page
			.getByRole("button", { name: "מעבר לתצוגת הסקירה" })
			.click();
		await expect(page.locator(".cal-book")).toHaveCount(0);
		await expect(page).not.toHaveURL(/flip=1/);
		await expect(
			page.getByRole("button", { name: "סקירה", exact: true }),
		).toBeFocused();
	});
});
