import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E regression for entity-preview clipping (#3712): a keyboard-focused
 * entity link keeps its preview alive while the reader scrolls, but the
 * preview must hide while the link itself is clipped out of the reader's
 * scrollport and reappear when it scrolls back. This exercises a real
 * browser scrollport, complementing the unit suite's stubbed geometry.
 */

const TOOLTIP = "#tanahpedia-entry-preview";

test.describe("Tanahpedia entity preview", () => {
	test("hides and re-shows the focused preview as its link leaves and reenters the reader scrollport", async ({
		page,
	}) => {
		// The delegate disables itself on touch-primary devices so taps keep
		// navigating; coarse-pointer projects have nothing to show.
		const previewEnabled = await page.evaluate(() =>
			window.matchMedia("(hover: hover) and (pointer: fine)").matches,
		);
		test.skip(
			!previewEnabled,
			"entity previews are disabled on coarse-pointer devices",
		);

		// Seeded mention data decorates אלהים inside בראשית א (mention-refs).
		await page.goto("/929/1");
		const link = page
			.locator(`a[href="/pedia/${encodeURIComponent("אלהים")}"]`)
			.first();
		await expect(link).toBeVisible({ timeout: 10_000 });

		// Keyboard focus opens the preview tooltip; the delegate also picks
		// up anchors focused before hydration, so this cannot flake on the
		// listener-registration race.
		await link.focus();
		const tooltip = page.locator(TOOLTIP);
		await expect(tooltip).toBeVisible({ timeout: 10_000 });
		await expect(tooltip).toContainText("אלהים");

		// Scroll the link just above the reader's top edge while keeping its
		// rect inside the window: the reader's scrollport clip is then the
		// only thing that can hide the preview.
		const clipped = await link.evaluate((anchor) => {
			let scroller = anchor.parentElement;
			while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
				scroller = scroller.parentElement;
			}
			if (!scroller) {
				throw new Error("entity link has no scrollable ancestor");
			}
			const clipTop = scroller.getBoundingClientRect().top;
			scroller.scrollTop +=
				anchor.getBoundingClientRect().bottom - clipTop / 2;
			return { bottom: anchor.getBoundingClientRect().bottom, clipTop };
		});
		expect(clipped.bottom).toBeGreaterThan(0);
		expect(clipped.bottom).toBeLessThan(clipped.clipTop);
		await expect(tooltip).toBeHidden();

		// Scrolling back re-anchors the same focused preview.
		await link.evaluate((anchor) => {
			let scroller = anchor.parentElement;
			while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
				scroller = scroller.parentElement;
			}
			if (!scroller) {
				throw new Error("entity link has no scrollable ancestor");
			}
			scroller.scrollTop = 0;
		});
		await expect(tooltip).toBeVisible();
	});

	test("retries a failed preview fetch on the next focus", async ({
		page,
	}) => {
		const previewEnabled = await page.evaluate(() =>
			window.matchMedia("(hover: hover) and (pointer: fine)").matches,
		);
		test.skip(
			!previewEnabled,
			"entity previews are disabled on coarse-pointer devices",
		);

		let calls = 0;
		await page.route("**/api/tanahpedia/preview/**", async (route) => {
			calls++;
			if (calls === 1) {
				await route.fulfill({ status: 500, body: "boom" });
				return;
			}
			await route.continue();
		});

		await page.goto("/929/1");
		const link = page
			.locator(`a[href="/pedia/${encodeURIComponent("אלהים")}"]`)
			.first();
		await expect(link).toBeVisible({ timeout: 10_000 });

		// First focus: the preview endpoint 500s, so no tooltip shows.
		await link.focus();
		await expect
			.poll(() => calls, { timeout: 10_000 })
			.toBe(1);
		// The 500 was already delivered; give the delegate a tick to settle.
		await page.waitForTimeout(300);
		await expect(page.locator(TOOLTIP)).toHaveCount(0);

		// A transient failure must not disable the preview for the rest of
		// the session: blurring past the delegate's hide delay, then
		// refocusing, refetches and renders the real preview.
		await page.locator("h1").first().click();
		await page.waitForTimeout(400);
		await link.focus();
		const tooltip = page.locator(TOOLTIP);
		await expect(tooltip).toBeVisible({ timeout: 10_000 });
		await expect(tooltip).toContainText("אלהים");
		expect(calls).toBe(2);
	});
});
