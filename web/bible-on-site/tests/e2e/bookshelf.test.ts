import { expect, test } from "../util/playwright/test-fixture";

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

	test("shows a 2D sefarim grid with large tap targets below tablet width", async ({
		page,
		isWideEnough,
	}) => {
		test.skip(isWideEnough, "Mobile-only layout");
		await page.goto("/bookshelf");

		const sefer = page.getByRole("button", { name: "שמות", exact: true });
		await expect(sefer).toBeVisible();
		const box = await sefer.boundingBox();
		expect(box?.height).toBeGreaterThanOrEqual(44);
		expect(box?.width).toBeGreaterThanOrEqual(44);

		// Wait for hydration so the click reaches React's handler
		await page.waitForLoadState("networkidle");
		await sefer.click();
		await expect(page).toHaveURL(/\/929\/51$/, { timeout: 30_000 });
	});

	test("keeps the 3D shelf on tablet and desktop", async ({
		page,
		skipOnNotWideEnough: _,
	}) => {
		await page.goto("/bookshelf");
		await expect(page.locator("[class*=surface]").first()).toBeVisible();
		await expect(page.locator("[class*=mobileGrid]")).toBeHidden();
	});
});
