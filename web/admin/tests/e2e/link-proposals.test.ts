import { expect, test } from "../util/test-fixture";

test.describe("Legacy link-proposal URLs", () => {
	test("opens the ordinary home PR queue", async ({ page }) => {
		await page.goto("/link-proposals");
		await expect(page).toHaveURL(
			(url) => url.pathname === "/" && url.searchParams.get("tab") === "prs",
		);
		await expect(
			page.getByRole("heading", { name: "הצעות שינוי" }),
		).toBeVisible();
		// Discovery lives in the shared composer, not in a separate queue panel.
		await expect(
			page.getByText("איתור קישורים למאמר", { exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "+ PR חדש", exact: true }),
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
