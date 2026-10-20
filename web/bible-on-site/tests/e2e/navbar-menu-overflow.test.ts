import { expect, test } from "../util/playwright/test-fixture";

// Regression coverage for #2477: #2424 turned .menuList into a scroll
// container (overflow-y: auto), which made overflow-x compute to `auto` too.
// The status ribbons (::after at left: -10px, rotated) then produced real
// horizontal overflow — a redundant bottom scrollbar appeared and the ribbons
// rendered clipped at the scrollport's left edge.

const RIBBON_CLASSES = ["ribbonBuilding", "ribbonComingSoon"] as const;

test.describe("NavBar hamburger menu layout", () => {
	test("has no horizontal overflow and keeps status ribbons inside the menu", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const menu = page.locator("#main-menu");
		const list = menu.locator(":scope > ul");

		const result = await list.evaluate((el, ribbonClasses) => {
			const listRect = el.getBoundingClientRect();
			const ribbons = [...el.querySelectorAll("li")]
				.filter((li) =>
					ribbonClasses.some((cls) => li.className.includes(cls)),
				)
				.map((li) => {
					const after = getComputedStyle(li, "::after");
					return {
						content: after.content,
						// Space between the item's left edge and the list's left
						// edge must fit the ribbon's overhang (left: -10px) plus
						// the extra reach of its -18deg rotation.
						leftGap:
							li.getBoundingClientRect().left - listRect.left,
						overhang: -Number.parseFloat(after.left),
					};
				});
			return {
				clientWidth: el.clientWidth,
				scrollWidth: el.scrollWidth,
				ribbons,
			};
		}, RIBBON_CLASSES);

		expect(
			result.scrollWidth,
			"menu list must not scroll horizontally",
		).toBeLessThanOrEqual(result.clientWidth);
		expect(result.ribbons.length).toBeGreaterThan(0);
		for (const ribbon of result.ribbons) {
			// ~2px of extra reach from the rotation on top of the -10px offset.
			expect(
				ribbon.leftGap,
				`ribbon ${ribbon.content} must have room for its overhang`,
			).toBeGreaterThanOrEqual(ribbon.overhang + 2);
		}
	});

	test("still scrolls vertically to reach תרומות on short viewports without horizontal overflow", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 320 });
		await page.goto("/accessibility");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const list = page.locator("#main-menu > ul");

		const metrics = await list.evaluate((el) => ({
			clientHeight: el.clientHeight,
			scrollHeight: el.scrollHeight,
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
		}));
		expect(
			metrics.scrollHeight,
			"short viewport must overflow vertically",
		).toBeGreaterThan(metrics.clientHeight);

		await list.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(
			page.locator("#main-menu").getByRole("link", { name: "תרומות" }),
		).toBeInViewport();

		const after = await list.evaluate((el) => ({
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
		}));
		expect(
			after.scrollWidth,
			"scrolled menu must not scroll horizontally",
		).toBeLessThanOrEqual(after.clientWidth);
	});
});
