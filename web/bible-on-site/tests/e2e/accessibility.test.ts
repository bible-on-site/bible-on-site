import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E for the public accessibility statement (#2396): direct URL loads,
 * structured content, working contact routes and a way back.
 */
test.describe("Accessibility statement page", () => {
	test("loads directly with title and main heading", async ({ page }) => {
		const response = await page.goto("/accessibility");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle('הצהרת נגישות | תנ"ך על הפרק');
		await expect(
			page.getByRole("heading", { level: 1, name: "הצהרת נגישות" }),
		).toBeVisible();
	});

	test("covers website and app separately, lists limitations and a review date", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const main = page.getByRole("main");
		await expect(
			main.getByRole("heading", { name: /נגישות באתר/ }),
		).toBeVisible();
		await expect(
			main.getByRole("heading", { name: /נגישות ביישומון/ }),
		).toBeVisible();
		await expect(main.getByRole("heading", { name: /מגבלות/ })).toBeVisible();
		await expect(main.getByText(/עודכנה לאחרונה/)).toBeVisible();
	});

	test("offers working contact routes and a way back to the service", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const main = page.getByRole("main");
		await expect(
			main.getByRole("link", { name: "tanah.site@gmail.com" }),
		).toHaveAttribute("href", "mailto:tanah.site@gmail.com");
		await expect(main.getByRole("link", { name: "ווטסאפ" })).toHaveAttribute(
			"href",
			"https://wa.me/37257078640",
		);
		await expect(
			main.getByRole("link", { name: "חזרה לעמוד הראשי" }),
		).toHaveAttribute("href", "/");
	});

	test("shows the shared top bar visibly styled, like other routes", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const nav = page.getByRole("navigation", { name: "ניווט עליון" });
		await expect(nav).toBeVisible();
		// The bar must be painted, not merely mounted — the regression was a
		// transparent white-on-white header (#2396).
		await expect(nav).toHaveCSS("background-color", "rgb(21, 82, 172)");
		await expect(nav.getByRole("link", { name: 'תנ"ך על הפרק' })).toBeVisible();
		await expect(nav.getByRole("link", { name: "חיפוש" })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "תפריט ראשי" }),
		).toBeVisible();
	});

	test("accessibility menu: keyboard-able, link last, reset restores defaults", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const trigger = page.getByRole("button", { name: "התאמות נגישות" });
		await trigger.press("Enter");
		const menu = page.getByRole("dialog", { name: "התאמות נגישות" });
		await expect(menu).toBeVisible();

		// The popup stays inside the viewport on every project size —
		// Desktop (~1280px) and Mobile (Pixel 5, ~393px).
		const menuBox = await menu.boundingBox();
		const viewport = page.viewportSize();
		expect(menuBox).not.toBeNull();
		expect(viewport).not.toBeNull();
		expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(
			viewport?.width ?? 0,
		);
		expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
			viewport?.height ?? 0,
		);

		// Last interactive element is the maintained statement link.
		const focusables = menu.locator("input, select, button, a[href]");
		await expect(focusables.last()).toHaveAttribute("href", "/accessibility");
		await expect(focusables.last()).toHaveText("הצהרת נגישות");

		// Adjust then reset — persistence and feedback. End jumps the range
		// to its max (200%).
		const fontScale = () =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement).getPropertyValue(
					"--perek-font-scale",
				),
			);
		await menu.getByRole("slider", { name: "גודל גופן" }).press("End");
		expect(await fontScale()).toBe("2");
		await menu.getByRole("button", { name: "איפוס התאמות נגישות" }).click();
		await expect(menu.locator('p[role="status"]')).toContainText("אופסו");
		await page.goto("/929/1");
		expect(await fontScale()).toBe("1");
	});

	test("docks next to the reader preferences gear on reader routes", async ({
		page,
	}) => {
		await page.goto("/929/1");
		const gear = page.getByRole("button", {
			name: "הגדרות קריאה",
			exact: true,
		});
		const trigger = page.getByRole("button", { name: "התאמות נגישות" });
		await expect(gear).toBeVisible();
		await expect(trigger).toBeVisible();
		// Search is intentionally absent on reader pages (#2274).
		await expect(page.getByRole("link", { name: "חיפוש" })).toHaveCount(0);

		const [gearBox, triggerBox] = await Promise.all([
			gear.boundingBox(),
			trigger.boundingBox(),
		]);
		expect(gearBox).not.toBeNull();
		expect(triggerBox).not.toBeNull();
		// Immediately right of the gear with a small gap, tops aligned.
		const gap =
			(triggerBox?.x ?? 0) - ((gearBox?.x ?? 0) + (gearBox?.width ?? 0));
		expect(gap).toBeGreaterThanOrEqual(0);
		expect(gap).toBeLessThanOrEqual(16);
		expect(
			Math.abs((triggerBox?.y ?? 0) - (gearBox?.y ?? 0)),
		).toBeLessThanOrEqual(4);

		// The menu still opens and dismisses cleanly on reader routes.
		await trigger.click();
		const menu = page.getByRole("dialog", { name: "התאמות נגישות" });
		await expect(menu).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
		await expect(trigger).toBeFocused();
	});

	test("pins the trigger to the left edge where reader-section routes mount no gear", async ({
		page,
	}) => {
		// /929/authors suppresses the search button like the rest of the
		// reader section, but mounts no preferences gear — docking at the
		// gear offset there left a stranded gap. /929/rabbis is a transparent
		// rewrite alias for the same gearless layout (#2396 follow-up).
		for (const path of ["/929/authors", "/929/rabbis"]) {
			await page.goto(path);
			const trigger = page.getByRole("button", { name: "התאמות נגישות" });
			await expect(trigger).toBeVisible();
			await expect(
				page.getByRole("button", {
					name: "הגדרות קריאה",
					exact: true,
				}),
			).toHaveCount(0);
			await expect(
				page.getByRole("link", { name: "חיפוש" }),
			).toHaveCount(0);

			const box = await trigger.boundingBox();
			expect(box).not.toBeNull();
			expect(box?.x ?? 999).toBeLessThanOrEqual(24);

			await trigger.click();
			const menu = page.getByRole("dialog", { name: "התאמות נגישות" });
			await expect(menu).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(menu).toHaveCount(0);
		}
	});

	test("the side nav no longer carries a standalone statement entry", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const menu = page.getByRole("navigation", { name: "תפריט ראשי" });
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("link", { name: /הצהרת נגישות/ })).toHaveCount(
			0,
		);
	});
});
