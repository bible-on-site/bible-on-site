import { expect, test } from "../../util/playwright/test-fixture";

const BASE_URL = "/929";

const perekText = (page: import("@playwright/test").Page) =>
	page.getByRole("article").first();

async function fontScaleVar(page: import("@playwright/test").Page) {
	return page.evaluate(() =>
		document.documentElement.style.getPropertyValue("--perek-font-scale"),
	);
}

async function lineHeightVar(page: import("@playwright/test").Page) {
	return page.evaluate(() =>
		document.documentElement.style.getPropertyValue("--perek-line-height"),
	);
}

test.describe("Reader settings", () => {
	test("A+ increases the perek text font size and persists across reload", async ({
		page,
	}) => {
		await page.goto(`${BASE_URL}/1`);
		await perekText(page).waitFor({ state: "visible" });

		const increase = page.getByTestId("reader-font-increase");
		await increase.click();
		expect(await fontScaleVar(page)).toBe("1.15");

		await page.reload();
		await perekText(page).waitFor({ state: "visible" });
		// Bootstrap script re-applies the stored setting before paint.
		expect(await fontScaleVar(page)).toBe("1.15");
	});

	test("line spacing control cycles through the steps", async ({ page }) => {
		await page.goto(`${BASE_URL}/1`);
		await perekText(page).waitFor({ state: "visible" });

		const spacing = page.getByTestId("reader-line-spacing");
		await spacing.click();
		expect(await lineHeightVar(page)).toBe("1.75");
		await spacing.click();
		expect(await lineHeightVar(page)).toBe("2");
		await spacing.click();
		expect(await lineHeightVar(page)).toBe("1.5");
	});

	test("controls stay in the top strip and do not cover the perek text", async ({
		page,
	}) => {
		await page.goto(`${BASE_URL}/1`);
		const article = perekText(page);
		await article.waitFor({ state: "visible" });

		const settings = page.getByTestId("reader-settings");
		await expect(settings).toBeVisible();
		const settingsBox = await settings.boundingBox();
		const articleBox = await article.boundingBox();
		expect(settingsBox).not.toBeNull();
		expect(articleBox).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: checked with toBeNull above
		expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(
			// biome-ignore lint/style/noNonNullAssertion: checked with toBeNull above
			articleBox!.y + 1,
		);
	});

	test("A- decreases until disabled at the minimum step", async ({ page }) => {
		await page.goto(`${BASE_URL}/1`);
		await perekText(page).waitFor({ state: "visible" });

		const decrease = page.getByTestId("reader-font-decrease");
		await decrease.click();
		expect(await fontScaleVar(page)).toBe("0.92");
		await decrease.click();
		expect(await fontScaleVar(page)).toBe("0.85");
		await expect(decrease).toBeDisabled();
	});
});
