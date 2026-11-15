import { expect, test } from "../util/playwright/test-fixture";

/**
 * Geist Sans is consumed only by the pedia family tree (#2734). Home and
 * reader routes must not preload or fetch the Geist font files; the pedia
 * family-tree section carries the scoped --font-geist-sans variable itself.
 */

const GEIST_PATTERN = /geist/i;
const JACOB_URL = `/pedia/${encodeURIComponent("יעקב")}`;

test.describe("Geist font loading", () => {
	for (const path of ["/", "/929/1"]) {
		test(`${path} neither preloads nor fetches Geist fonts`, async ({
			page,
		}) => {
			const geistRequests: string[] = [];
			page.on("request", (request) => {
				if (GEIST_PATTERN.test(request.url())) {
					geistRequests.push(request.url());
				}
			});

			await page.goto(path);
			await page.waitForLoadState("domcontentloaded");

			await expect(
				page.locator('link[rel="preload"][href*="Geist"]'),
			).toHaveCount(0);
			expect(geistRequests).toHaveLength(0);
		});
	}

	test("pedia family tree resolves the scoped Geist Sans variable", async ({
		page,
	}) => {
		const fontRequests: string[] = [];
		page.on("request", (request) => {
			if (GEIST_PATTERN.test(request.url())) {
				fontRequests.push(request.url());
			}
		});

		await page.goto(JACOB_URL);

		const section = page.locator(
			'section[aria-labelledby="person-family-heading"]',
		);
		await expect(section).toBeVisible();

		// The variable is scoped on the pedia layout wrapper: --font-geist-sans
		// must resolve to a generated font family so .section's font-family
		// applies it through inheritance.
		const resolvedVar = await section.evaluate((el) =>
			getComputedStyle(el).getPropertyValue("--font-geist-sans").trim(),
		);
		expect(resolvedVar.length).toBeGreaterThan(0);
		expect(resolvedVar).not.toBe("initial");
	});
});
