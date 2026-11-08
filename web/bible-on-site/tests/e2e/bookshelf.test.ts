import { expect, test } from "../util/playwright/test-fixture";
import { TOP_NAV_BLUE, topNavBackground } from "../util/playwright/top-nav";

test.describe("Bookshelf page", () => {
	test("loads without console or page errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		page.on("console", (msg) => {
			if (msg.type() === "error") errors.push(msg.text());
		});

		await page.goto("/bookshelf");
		await expect(
			page.getByRole("heading", { level: 1, name: 'ספרי התנ"ך' }),
		).toBeAttached();
		await expect(page.getByRole("button", { name: /בראשית/ })).toBeAttached();
		await page.waitForLoadState("networkidle");

		expect(errors).toEqual([]);
	});

	test("renders the shared blue top bar on direct load", async ({ page }) => {
		await page.goto("/bookshelf");
		await expect(
			page.getByRole("heading", { level: 1, name: 'ספרי התנ"ך' }),
		).toBeAttached();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar after opening the main menu", async ({
		page,
	}) => {
		await page.goto("/bookshelf");
		const menuButton = page.getByRole("button", { name: "תפריט ראשי" });
		await menuButton.click();
		await expect(menuButton).toHaveAttribute("aria-expanded", "true");

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});
});
