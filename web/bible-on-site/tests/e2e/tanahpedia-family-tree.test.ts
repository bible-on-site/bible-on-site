import type { Locator } from "@playwright/test";
import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E coverage for the Tanahpedia person family tree responsive layout.
 *
 * The family tree renders three shapes depending on the data:
 *  - a spouses-with-children matrix (יעקב: multiple wives, many children),
 *  - a spouse-only rail (שמשון: unions but no recorded children),
 *  - plain cards.
 *
 * On desktop the matrix is a 2D grid (columns = mothers, rows = children).
 * That grid is far wider than a phone, so on narrow viewports it must collapse
 * into a vertical, mother-grouped stack instead of a horizontally-scrolling
 * grid that clips every column but the last. These tests run under both the
 * Desktop (Chrome, wide) and Mobile (Pixel 5, ~393px) Playwright projects, so a
 * single spec asserts both branches: the wide project must keep the matrix and
 * the narrow project must switch to the mobile stack with no horizontal clipping.
 *
 * The db-populator seeds יעקב and שמשון family demo data into the e2e database,
 * so these routes are always populated in CI and locally.
 */

const JACOB_URL = `/tanahpedia/entry/${encodeURIComponent("יעקב")}`;
const SHIMSHON_URL = `/tanahpedia/entry/${encodeURIComponent("שמשון")}`;

/** Horizontal overflow of an element in CSS pixels (0 = no horizontal scroll). */
async function horizontalOverflow(locator: Locator): Promise<number> {
	return locator.evaluate((el) => el.scrollWidth - el.clientWidth);
}

test.describe("Tanahpedia person family tree responsive layout", () => {
	test("renders the Jacob spouses-with-children matrix per viewport", async ({
		page,
		isWideEnough,
	}) => {
		await page.goto(JACOB_URL);

		const familyRegion = page.getByRole("region", { name: "משפחה" });
		await expect(familyRegion).toBeVisible();

		const mobileStack = page.locator("[data-matrix-mobile]");
		const desktopMatrixCards = page.locator("[data-matrix-spouse-card]");

		if (isWideEnough) {
			// Wide viewport: keep the 2D desktop matrix, no mobile collapse.
			await expect(desktopMatrixCards.first()).toBeVisible();
			expect(await desktopMatrixCards.count()).toBeGreaterThan(1);
			await expect(mobileStack).toHaveCount(0);
		} else {
			// Narrow viewport: collapse into the vertical mother-grouped stack.
			// The desktop matrix cards (data-matrix-spouse-card) must be absent so
			// the wide, horizontally-scrolling grid can never clip columns on a phone.
			await expect(mobileStack).toBeVisible();
			await expect(desktopMatrixCards).toHaveCount(0);

			// The stacked layout must fit the phone width without a clipped,
			// horizontally-scrolling column strip (the original small-screen bug).
			expect(await horizontalOverflow(mobileStack)).toBeLessThanOrEqual(1);
		}

		// The page itself must never scroll horizontally on any viewport.
		expect(await horizontalOverflow(page.locator("body"))).toBeLessThanOrEqual(
			1,
		);
	});

	test("renders the Shimshon spouse-only rail without horizontal clipping", async ({
		page,
	}) => {
		await page.goto(SHIMSHON_URL);

		const familyRegion = page.getByRole("region", { name: "משפחה" });
		await expect(familyRegion).toBeVisible();

		// Shimshon has unions but no recorded children, so it uses the spouse-only
		// rail rather than the matrix; it must fit any viewport without the page
		// scrolling horizontally.
		expect(await horizontalOverflow(page.locator("body"))).toBeLessThanOrEqual(
			1,
		);
		expect(await horizontalOverflow(familyRegion)).toBeLessThanOrEqual(1);
	});
});
