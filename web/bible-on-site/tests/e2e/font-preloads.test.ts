import { expect, test } from "../util/playwright/test-fixture";

test.describe("Al Heperek font loading", () => {
	for (const path of ["/", "/929/1", `/pedia/${encodeURIComponent("יעקב")}`]) {
		test(`${path} uses the shared brand font`, async ({ page }) => {
			const legacyRequests: string[] = [];
			page.on("request", (request) => {
				if (/geist/i.test(request.url())) legacyRequests.push(request.url());
			});
			await page.goto(path);
			await page.evaluate(() => document.fonts.ready);
			const typography = await page.evaluate(() => ({
				brand: getComputedStyle(document.documentElement)
					.getPropertyValue("--font-al-heperek")
					.trim(),
				body: getComputedStyle(document.body).fontFamily,
				loaded: document.fonts.status,
			}));
			expect(typography.brand).not.toBe("");
			expect(typography.body).toContain(
				typography.brand.split(",")[0].replace(/"/g, ""),
			);
			expect(typography.loaded).toBe("loaded");
			expect(legacyRequests).toHaveLength(0);
		});
	}
});
