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
	// overflowed. The content-aware collapse must reflow the rail to a vertical
	// stack at every width it does not fit — not just below 600px.
	//
	// Two mechanisms keep the rail from spilling, and both are exercised here:
	//  - <=600px: a CSS media query forces the single-column stack (anti-flash),
	//    so JS never needs to collapse and leaves data-spouse-rail="rail".
	//  - >600px (the former dead zone): the media query no longer applies, so the
	//    content-aware JS collapse must kick in and set data-spouse-rail="collapsed".
	// Either way, the rail must never overflow or clip at any of these widths.
	for (const width of [360, 550, 700, 850]) {
		test(`collapses the Shimshon spouse-only rail without overflow at ${width}px`, async ({
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

			if (width > 600) {
				// Above the CSS media breakpoint the JS content-aware collapse is the
				// only thing preventing the natural multi-column rail from spilling,
				// so it must reflow to the vertical single-column stack (not scroll).
				await expect(rail).toHaveAttribute("data-spouse-rail", "collapsed");
			}
		});
	}

	// A sibling (e.g. עשו next to יעקב) must never be clipped off the viewport on
	// narrow screens: the focal+sibling row must reflow rather than overflow.
	for (const width of [320, 360, 414]) {
		test(`keeps every sibling within the viewport at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 1400 });
			await page.goto(JACOB_URL);

			const familyRegion = page.getByRole("region", { name: "משפחה" });
			await expect(familyRegion).toBeVisible();

			// עשו is one of Jacob's siblings; it must be rendered fully on-screen.
			const esav = familyRegion.getByText("עשו", { exact: true });
			await expect(esav).toBeVisible();
			const esavInView = await esav.evaluate((el) => {
				const r = el.getBoundingClientRect();
				return r.left >= -1 && r.right <= window.innerWidth + 1;
			});
			expect(esavInView).toBe(true);

			// No card anywhere in the tree may be clipped off the viewport.
			expect(await worstViewportEscape(familyRegion)).toBeLessThanOrEqual(1);
			expect(
				await horizontalOverflow(page.locator("body")),
			).toBeLessThanOrEqual(1);
		});
	}
});
