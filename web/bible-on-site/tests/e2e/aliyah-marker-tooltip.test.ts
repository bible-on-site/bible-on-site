import type { Page } from "@playwright/test";
import { expect, test } from "../util/playwright/test-fixture";

const VAYISHLACH = `/${encodeURIComponent("פרשה")}/${encodeURIComponent("וישלח")}`;

async function expectPortalInsideViewport(page: Page) {
	const detail = page.locator("[data-aliyah-detail-portal]");
	await expect(detail).toBeVisible();
	const box = await detail.boundingBox();
	const viewport = page.viewportSize();
	expect(box).not.toBeNull();
	expect(viewport).not.toBeNull();
	if (!box || !viewport) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test.describe("aliyah marker viewport-safe detail (#3840)", () => {
	// Parasha pages compile Torah text, commentary and the embedded book; use
	// the same cold-compile budget as the existing parasha reader suite.
	test.describe.configure({ timeout: 120_000 });
	test("keeps a left-edge plain-reader detail inside the viewport and flips it upward", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 700 });
		await page.goto(VAYISHLACH);
		const markers = page.locator(
			'[data-unit-text="torah"] [data-aliyah-marker]',
		);
		await expect(markers.first()).toBeVisible();
		const candidates = await markers.evaluateAll((els) =>
			els.flatMap((el, index) => {
				const rect = el.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0
					? [{ index, left: rect.left }]
					: [];
			}),
		);
		const nearest = candidates.reduce((best, candidate) =>
			candidate.left < best.left ? candidate : best,
		);
		// The regression is specifically about an inline pill whose line position
		// places it at the physical left edge of RTL text.
		expect(nearest.left).toBeLessThan(160);
		const marker = markers.nth(nearest.index);
		await marker.evaluate((el) => el.scrollIntoView({ block: "end" }));
		await expect
			.poll(async () => (await marker.boundingBox())?.y ?? 0)
			.toBeGreaterThan(350);
		const markerBox = await marker.boundingBox();
		expect(markerBox).not.toBeNull();

		await marker.hover();
		await expectPortalInsideViewport(page);
		const detailBox = await page
			.locator("[data-aliyah-detail-portal]")
			.boundingBox();
		expect(detailBox).not.toBeNull();
		if (detailBox && markerBox) {
			// At the bottom of the viewport there is no room below; the detail must
			// flip above its pill rather than being clamped over the text edge.
			expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(
				markerBox.y + 1,
			);
		}
	});

	test("keeps Sefer-view details inside the viewport outside the clipping leaf", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.setViewportSize({ width: 900, height: 700 });
		await page.goto(`${VAYISHLACH}?book`);
		await expect(page.locator('[class*="seferOverlay"]')).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.locator(".he-book.flipbook")).toBeVisible({
			timeout: 30_000,
		});
		const markers = page.locator(".he-book [data-aliyah-marker]");
		const visibleIndexes = await markers.evaluateAll((els) =>
			els.flatMap((el, index) =>
				el.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true,
				})
					? [index]
					: [],
			),
		);
		expect(visibleIndexes.length).toBeGreaterThan(0);
		const marker = markers.nth(visibleIndexes[0]);
		await marker.hover();
		await expectPortalInsideViewport(page);
		await expect(page.locator("[data-aliyah-detail-portal]")).toHaveCount(1);
		const parentIsBody = await page
			.locator("[data-aliyah-detail-portal]")
			.evaluate((el) => el.parentElement === document.body);
		expect(parentIsBody).toBe(true);
	});
});
