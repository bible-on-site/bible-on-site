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
			const typography = await page.evaluate(() => {
				const brand = getComputedStyle(document.documentElement)
					.getPropertyValue("--font-al-heperek")
					.trim();
				const primary = brand.split(",")[0].replace(/"/g, "");
				return {
					brand,
					body: getComputedStyle(document.body).fontFamily,
					loaded: Array.from(document.fonts).some(
						(face) =>
							face.family.replace(/"/g, "") === primary &&
							face.weight === "400" &&
							face.status === "loaded",
					),
				};
			});
			expect(typography.brand).not.toBe("");
			expect(typography.body).toContain(
				typography.brand.split(",")[0].replace(/"/g, ""),
			);
			expect(typography.loaded).toBe(true);
			expect(legacyRequests).toHaveLength(0);
		});
	}
	for (const weight of ["Regular", "SemiBold", "Bold"]) {
		test(`public ${weight} face can load in email clients across origins`, async ({
			request,
		}) => {
			const response = await request.get(`/fonts/AlHeperekUI-${weight}.woff2`, {
				headers: { Origin: "https://mail.example" },
			});
			expect(response.ok()).toBe(true);
			expect(response.headers()["access-control-allow-origin"]).toBe("*");
			expect(response.headers()["content-type"]).toContain("font/woff2");
			expect((await response.body()).subarray(0, 4).toString()).toBe("wOF2");
		});
	}
});
