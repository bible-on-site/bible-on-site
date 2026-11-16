import { expect, test } from "../util/test-fixture";

test.describe("Legacy link-proposal URLs", () => {
	test("opens the ordinary home PR queue", async ({ page }) => {
		await page.goto("/link-proposals");
		await expect(page).toHaveURL(
			(url) => url.pathname === "/" && url.searchParams.get("tab") === "prs",
		);
		await expect(
			page.getByText("איתור קישורים למאמר", { exact: true }),
		).toBeVisible();
	});
	test("preserves an article URL while resolving to the ordinary queue", async ({
		page,
	}) => {
		await page.goto("/link-proposals?articleId=6");
		await expect(page).toHaveURL(
			(url) => url.pathname === "/" && url.searchParams.get("tab") === "prs",
		);
		await expect(page.getByTestId("link-proposal-card")).toHaveCount(0);
	});
});
