import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../util/playwright/test-fixture";

test.describe("Perek breadcrumb selectors", () => {
	test("open from the keyboard, one at a time, and close on Escape", async ({
		page,
	}) => {
		await page.goto("/929/1");
		await expect(page.getByRole("article")).toHaveAttribute(
			"data-pasuk-navigation-ready",
			"",
		);
		const breadcrumb = page.getByTestId("perek-breadcrumb-1");
		const sefer = breadcrumb.getByRole("button", { name: /ספר נוכחי/ });
		const perek = breadcrumb.getByRole("button", { name: /פרק נוכחי/ });
		const seferOptions = breadcrumb.getByRole("link", { name: "שמות" });

		await sefer.focus();
		await page.keyboard.press("Enter");
		await expect(sefer).toHaveAttribute("aria-expanded", "true");
		await expect(seferOptions).toBeVisible();

		await perek.focus();
		await page.keyboard.press("Space");
		await expect(perek).toHaveAttribute("aria-expanded", "true");
		await expect(sefer).toHaveAttribute("aria-expanded", "false");
		await expect(seferOptions).toBeHidden();
		const grid = await breadcrumb
			.getByRole("link", { name: "ב", exact: true })
			.locator("xpath=ancestor::div[1]")
			.boundingBox();
		expect(grid?.x).toBeGreaterThanOrEqual(0);
		expect((grid?.x ?? 0) + (grid?.width ?? 0)).toBeLessThanOrEqual(
			page.viewportSize()?.width ?? 0,
		);

		await page.keyboard.press("Escape");
		await expect(perek).toHaveAttribute("aria-expanded", "false");
		await expect(perek).toBeFocused();
	});

	test("open on tap/click and close on an outside click", async ({ page }) => {
		await page.goto("/929/1");
		const breadcrumb = page.getByTestId("perek-breadcrumb-1");
		const helek = breadcrumb.getByRole("button", { name: /חלק נוכחי/ });

		await helek.click();
		await expect(helek).toHaveAttribute("aria-expanded", "true");
		await expect(
			breadcrumb.getByRole("link", { name: "נביאים" }),
		).toBeVisible();

		await page.locator("#pasuk-10").click({ position: { x: 5, y: 5 } });
		await expect(helek).toHaveAttribute("aria-expanded", "false");
	});
});

async function expectBelowHeader(page: Page, target: Locator) {
	await expect(target).toBeVisible({ timeout: 10_000 });
	await expect(async () => {
		const headerBottom = await page
			.locator(".top-nav")
			.evaluate((el) => el.getBoundingClientRect().bottom);
		const targetTop = await target.evaluate(
			(el) => el.getBoundingClientRect().top,
		);
		expect(targetTop).toBeGreaterThanOrEqual(headerBottom);
		expect(targetTop).toBeLessThan(page.viewportSize()?.height ?? 0);
	}).toPass({ timeout: 5_000 });
}

for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 1366, height: 850 },
]) {
	test.describe(`Deep links clear the top nav at ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport });

		test("article", async ({ page }) => {
			await page.goto("/929/1/1");
			await expectBelowHeader(page, page.locator("#article-view"));
		});

		test("perush", async ({ page }) => {
			await page.goto(`/929/1/${encodeURIComponent("אבן עזרא")}`);
			await expectBelowHeader(page, page.locator("#perush-view"));
		});
	});
}
