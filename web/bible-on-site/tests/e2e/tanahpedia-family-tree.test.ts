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

const JACOB_URL = `/pedia/${encodeURIComponent("יעקב")}`;
const SHIMSHON_URL = `/pedia/${encodeURIComponent("שמשון")}`;

/** Horizontal overflow of an element in CSS pixels (0 = no horizontal scroll). */
async function horizontalOverflow(locator: Locator): Promise<number> {
	return locator.evaluate((el) => el.scrollWidth - el.clientWidth);
}

/**
 * The largest number of CSS pixels by which any descendant of `locator` spills
 * past the viewport horizontally (either off the right edge or off the left
 * edge). 0 means every card stays fully on-screen. This catches content that is
 * clipped-and-lost (no scroll container) — e.g. a sibling card pushed off-screen.
 */
async function worstViewportEscape(locator: Locator): Promise<number> {
	return locator.evaluate((root) => {
		const vw = window.innerWidth;
		let worst = 0;
		for (const el of root.querySelectorAll("*")) {
			const r = el.getBoundingClientRect();
			if (r.width < 24 || r.width > 2000) continue;
			const overRight = r.right - vw;
			const overLeft = -r.left;
			worst = Math.max(worst, overRight, overLeft);
		}
		return Math.round(worst);
	});
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

	// The original 600px media breakpoint only shrank the spouse-only rail at
	// <=600px, leaving a 601–950px "dead zone" where the full-width desktop rail
	// overflowed. Small screens (<=767px) now use the generalized vertical preset
	// (data-family-vertical): parents above, then the focal person, siblings,
	// spouses and children — all on one vertical axis. Above 767px the
	// content-aware collapse still reflows the rail whenever it would not fit.
	// Whether that collapse engages at a given width depends on the data, so the
	// collapse mechanism itself is verified deterministically in the unit tests;
	// here we assert the width-independent no-overflow guarantee plus the preset.
	for (const width of [360, 550, 700, 850]) {
		test(`renders the Shimshon spouse-only rail without overflow at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 1100 });
			await page.goto(SHIMSHON_URL);

			const familyRegion = page.getByRole("region", { name: "משפחה" });
			await expect(familyRegion).toBeVisible();

			const rail = page.locator("[data-spouse-rail]");
			await expect(rail).toBeVisible();

			// Nothing may scroll or spill horizontally at any of these widths.
			expect(
				await horizontalOverflow(page.locator("body")),
			).toBeLessThanOrEqual(1);
			expect(await horizontalOverflow(familyRegion)).toBeLessThanOrEqual(1);
			expect(await worstViewportEscape(familyRegion)).toBeLessThanOrEqual(1);

			if (width <= 767) {
				// Small screens use the generalized vertical preset with the spouse
				// stack rendered vertically.
				await expect(page.locator("[data-family-vertical]")).toBeVisible();
				await expect(rail).toHaveAttribute("data-spouse-rail", "collapsed");
			} else {
				await expect(page.locator("[data-family-vertical]")).toHaveCount(0);
			}
		});
	}

	// A sibling (e.g. עשו next to יעקב) must never be clipped off the viewport on
	// narrow screens: the vertical preset stacks parents above the focal person,
	// then siblings below it (label above the group), then spouses and children.
	// 602/700 cover the 600–767 band where the old sibling grid pushed עשו
	// off-screen.
	for (const width of [320, 360, 414, 602, 700]) {
		test(`keeps every sibling within the viewport at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 1400 });
			await page.goto(JACOB_URL);

			const familyRegion = page.getByRole("region", { name: "משפחה" });
			await expect(familyRegion).toBeVisible();

			// Small screens use the generalized vertical preset.
			await expect(page.locator("[data-family-vertical]")).toBeVisible();

			// עשו is one of Jacob's siblings; it must be rendered fully on-screen.
			const esav = familyRegion.getByText("עשו", { exact: true });
			await expect(esav).toBeVisible();
			const esavInView = await esav.evaluate((el) => {
				const r = el.getBoundingClientRect();
				return r.left >= -1 && r.right <= window.innerWidth + 1;
			});
			expect(esavInView).toBe(true);

			// Vertical order: parents above focal, siblings below focal, spouses
			// after siblings, each mother above her children.
			const treeText = (await familyRegion.textContent()) ?? "";
			expect(treeText.indexOf("יצחק")).toBeLessThan(
				treeText.indexOf("יעקב"),
			);
			expect(treeText.indexOf("יעקב")).toBeLessThan(treeText.indexOf("עשו"));
			expect(treeText.indexOf("עשו")).toBeLessThan(treeText.indexOf("לאה"));
			expect(treeText.indexOf("לאה")).toBeLessThan(
				treeText.indexOf("ראובן"),
			);

			// No card anywhere in the tree may be clipped off the viewport.
			expect(await worstViewportEscape(familyRegion)).toBeLessThanOrEqual(1);
			expect(
				await horizontalOverflow(page.locator("body")),
			).toBeLessThanOrEqual(1);
		});
	}
});
