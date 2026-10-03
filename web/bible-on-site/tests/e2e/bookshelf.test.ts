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
});
