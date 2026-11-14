import { expect, test } from "../util/playwright/test-fixture";

const AHREFS_ENDPOINT = "https://analytics.ahrefs.com/analytics.js";

test.describe("Ahrefs Web Analytics", () => {
	test("does not load the Ahrefs script outside production", async ({
		page,
	}) => {
		const ahrefsRequests: string[] = [];
		await page.route(`${AHREFS_ENDPOINT}**`, async (route) => {
			ahrefsRequests.push(route.request().url());
			await route.fulfill({
				status: 200,
				contentType: "application/javascript",
				body: "// Mocked Ahrefs script",
			});
		});

		await page.goto("/");
		await page.waitForLoadState("domcontentloaded");

		// The test env is not production, so no request may fire.
		expect(ahrefsRequests).toHaveLength(0);

		const ahrefsScripts = page.locator(`script[src*="analytics.ahrefs.com"]`);
		await expect(ahrefsScripts).toHaveCount(0);
	});
});
