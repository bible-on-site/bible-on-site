import type { Page } from "@playwright/test";
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

/**
 * E2E for the site-wide accessibility preferences (#2767): the ניגודיות
 * גבוהה and קו תחתון לקישורים toggles persist, re-apply before paint on
 * reload, survive client navigation, reset with the rest of the menu and
 * keep links identifiable under forced colors. Baseline 1.4.1 cue and the
 * corrected ~7.41:1 white-on-brand measurement are asserted here too.
 */
test.describe("Site-wide accessibility preferences (#2767)", () => {
	const PEDIA_JOSHUA = `/pedia/${encodeURIComponent("יהושע-בן-נון")}`;

	// WCAG relative luminance + contrast ratio for measured-pair evidence.
	const luminance = (rgb: number[]) => {
		const chan = (v: number) => {
			const s = v / 255;
			return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return (
			0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2])
		);
	};
	const ratio = (fg: number[], bg: number[]) =>
		(Math.max(luminance(fg), luminance(bg)) + 0.05) /
		(Math.min(luminance(fg), luminance(bg)) + 0.05);
	// Parses both computed rgb()/rgba() strings and #rrggbb token values.
	const rgb = (css: string): number[] => {
		const hex = css.trim().match(/^#([0-9a-f]{6})$/i);
		if (hex) {
			const n = Number.parseInt(hex[1], 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		}
		const channels = css.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
		if (channels.length < 3) throw new Error(`Not a color: "${css}"`);
		return channels.slice(0, 3);
	};

	const openMenu = async (page: Page) => {
		const trigger = page.getByRole("button", { name: "התאמות נגישות" });
		const menu = page.getByRole("dialog", { name: "התאמות נגישות" });
		// Route hydration can lag first paint in dev — Enter toggles, so retry
		// only while the popover is still closed.
		await expect(async () => {
			if ((await menu.count()) === 0) await trigger.press("Enter");
			await expect(menu).toBeVisible({ timeout: 750 });
		}).toPass();
		return menu;
	};

	test("toggles persist, re-apply before paint and survive client navigation", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const menu = await openMenu(page);
		const contrast = menu.getByRole("checkbox", { name: "ניגודיות גבוהה" });
		const links = menu.getByRole("checkbox", { name: "קו תחתון לקישורים" });
		await expect(contrast).not.toBeChecked();
		await expect(links).not.toBeChecked();

		// Keyboard operation — Space toggles the focused control.
		await links.press("Space");
		await contrast.press("Space");
		const html = page.locator("html");
		await expect(html).toHaveAttribute("data-a11y-links", "underlined");
		await expect(html).toHaveAttribute("data-a11y-contrast", "high");
		const stored = await page.evaluate(() =>
			localStorage.getItem("siteA11ySettings"),
		);
		expect(JSON.parse(stored ?? "null")).toMatchObject({
			contrast: true,
			links: true,
		});

		// Reload: the pre-paint bootstrap runs in <head>, so by
		// domcontentloaded the attributes are already applied — no flash.
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(html).toHaveAttribute("data-a11y-contrast", "high");
		await expect(html).toHaveAttribute("data-a11y-links", "underlined");

		// Client-side navigation keeps the applied state.
		await page.getByRole("link", { name: 'תנ"ך על הפרק' }).first().click();
		await expect(page).toHaveURL(/\/$/);
		await expect(html).toHaveAttribute("data-a11y-contrast", "high");
		await expect(html).toHaveAttribute("data-a11y-links", "underlined");

		// Re-opened controls reflect the applied values.
		const reopened = await openMenu(page);
		await expect(
			reopened.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).toBeChecked();
		await expect(
			reopened.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).toBeChecked();
	});

	test("underline cue: baseline in prose, opt-in everywhere, reset everywhere", async ({
		page,
	}) => {
		await page.goto(PEDIA_JOSHUA);
		// The pedia entry body renders inside an <article> landmark.
		const entry = page.getByRole("article").first();

		// Baseline 1.4.1: a DB-authored inline link is underlined without any
		// preference set (the global reset would otherwise hide it).
		const inline = entry
			.getByRole("link", { name: "משה", exact: true })
			.first();
		await expect(inline).toBeVisible();
		await expect(inline).toHaveCSS("text-decoration-line", /underline/);

		// Footnote markers keep their own affordance — the sup letter is a
		// marker, not color-only, so it is not underlined by default.
		const marker = entry.locator("sup a").first();
		await expect(marker).toBeVisible();
		await expect(marker).toHaveCSS("text-decoration-line", "none");

		// Opt-in: every a[href] gains the persistent cue, including the
		// marker and the menu's own statement link.
		const menu = await openMenu(page);
		await menu
			.getByRole("checkbox", { name: "קו תחתון לקישורים" })
			.check();
		await expect(marker).toHaveCSS("text-decoration-line", /underline/);
		await expect(
			menu.getByRole("link", { name: "הצהרת נגישות" }),
		).toHaveCSS("text-decoration-line", /underline/);
	});

	test("reset clears both site toggles and preserves unrelated data", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		await page.evaluate(() =>
			localStorage.setItem("unrelatedUserData", "keep-me"),
		);
		const menu = await openMenu(page);
		await menu.getByRole("checkbox", { name: "ניגודיות גבוהה" }).check();
		await menu
			.getByRole("checkbox", { name: "קו תחתון לקישורים" })
			.check();

		await menu
			.getByRole("button", { name: "איפוס התאמות נגישות" })
			.click();
		const html = page.locator("html");
		await expect(html).not.toHaveAttribute("data-a11y-contrast", "high");
		await expect(html).not.toHaveAttribute("data-a11y-links", "underlined");
		await expect(
			menu.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).not.toBeChecked();
		await expect(
			menu.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).not.toBeChecked();
		await expect(menu.locator('p[role="status"]')).toContainText("אופסו");
		expect(
			await page.evaluate(() => localStorage.getItem("unrelatedUserData")),
		).toBe("keep-me");
	});

	test("measured contrast: nav ~7.41:1, high-contrast palette in the ≥7 band", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		const nav = page.getByRole("navigation", { name: "ניווט עליון" });

		// The corrected measurement — white on brand #1552ac is 7.4087:1,
		// not the 8.6:1 the docs previously claimed. The measured pair is the
		// white a11y-trigger icon/text on the blue bar (the logo itself is an
		// image and carries no text color).
		const a11yTrigger = page.getByRole("button", { name: "התאמות נגישות" });
		const [navBg, navFg] = await Promise.all([
			nav.evaluate((el) => getComputedStyle(el).backgroundColor),
			a11yTrigger.evaluate((el) => getComputedStyle(el).color),
		]);
		const navRatio = ratio(rgb(navFg), rgb(navBg));
		expect(navRatio).toBeGreaterThan(7);
		expect(navRatio).toBeLessThan(8);

		const menu = await openMenu(page);
		await menu.getByRole("checkbox", { name: "ניגודיות גבוהה" }).check();
		await expect(page.locator("html")).toHaveAttribute(
			"data-a11y-contrast",
			"high",
		);

		// Light HC palette: black on white 21:1; muted/link accents ≥7.
		const [bodyBg, bodyFg, linkAccent, muted] = await page.evaluate(() => {
			const cs = getComputedStyle(document.body);
			const root = getComputedStyle(document.documentElement);
			return [
				cs.backgroundColor,
				cs.color,
				root.getPropertyValue("--link-accent"),
				root.getPropertyValue("--muted-text"),
			];
		});
		expect(rgb(bodyBg)).toEqual([255, 255, 255]);
		expect(rgb(bodyFg)).toEqual([0, 0, 0]);
		expect(ratio(rgb(bodyFg), rgb(bodyBg))).toBe(21);
		expect(ratio(rgb(linkAccent), rgb(bodyBg))).toBeGreaterThanOrEqual(7);
		expect(ratio(rgb(muted), rgb(bodyBg))).toBeGreaterThanOrEqual(7);
	});

	test("high contrast follows the dark system scheme", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/accessibility");
		const menu = await openMenu(page);
		await menu.getByRole("checkbox", { name: "ניגודיות גבוהה" }).check();

		const [bodyBg, bodyFg, linkAccent] = await page.evaluate(() => {
			const cs = getComputedStyle(document.body);
			return [
				cs.backgroundColor,
				cs.color,
				getComputedStyle(document.documentElement).getPropertyValue(
					"--link-accent",
				),
			];
		});
		expect(rgb(bodyBg)).toEqual([0, 0, 0]);
		expect(rgb(bodyFg)).toEqual([255, 255, 255]);
		expect(ratio(rgb(bodyFg), rgb(bodyBg))).toBe(21);
		expect(ratio(rgb(linkAccent), rgb(bodyBg))).toBeGreaterThanOrEqual(7);
	});

	test("forced-colors mode keeps links identifiable regardless of toggles", async ({
		page,
	}) => {
		await page.emulateMedia({ forcedColors: "active" });
		await page.goto("/accessibility");
		const main = page.getByRole("main");
		const link = main
			.getByRole("link", { name: "tanah.site@gmail.com" })
			.first();
		await expect(link).toBeVisible();
		// The global `a { color: inherit }` would hide link identity under
		// forced colors — the media query hands it back LinkText + underline.
		const [linkColor, bodyColor] = await page.evaluate(() => [
			getComputedStyle(
				document.querySelector('a[href^="mailto:"]') as Element,
			).color,
			getComputedStyle(document.body).color,
		]);
		expect(linkColor).not.toBe(bodyColor);
		await expect(link).toHaveCSS("text-decoration-line", /underline/);
	});

	test("preferences follow the user across the exercised surfaces", async ({
		page,
	}) => {
		// Seven routes in one sweep — the dev server compiles each once, so
		// this legitimately needs the extended budget.
		test.slow();
		await page.goto("/");
		const menu = await openMenu(page);
		await menu
			.getByRole("checkbox", { name: "קו תחתון לקישורים" })
			.check();
		await expect(page.locator("html")).toHaveAttribute(
			"data-a11y-links",
			"underlined",
		);

		// Every route family the acceptance list calls out — homepage,
		// /929, flat + book readers, an article, a Tanahpedia entry, the
		// calendar and the statement page itself.
		for (const path of [
			"/929",
			"/929/1",
			"/929/1?book",
			"/929/1/1",
			PEDIA_JOSHUA,
			"/לוח",
			"/accessibility",
		]) {
			await page.goto(path);
			await expect(
				page.locator("html"),
				`data-a11y-links missing on ${path}`,
			).toHaveAttribute("data-a11y-links", "underlined");
			await expect(
				page.getByRole("button", { name: "התאמות נגישות" }),
			).toBeVisible();
		}
	});

	test("menu stays bounded and the statement link reachable on a narrow RTL viewport", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto("/");
		const menu = await openMenu(page);

		const box = await menu.boundingBox();
		expect(box).not.toBeNull();
		expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(568);

		const statement = menu.getByRole("link", { name: "הצהרת נגישות" });
		await statement.scrollIntoViewIfNeeded();
		await statement.click();
		await expect(page).toHaveURL(/\/accessibility$/);
	});

	test("viewport meta never blocks pinch-zoom (SC 1.4.4)", async ({ page }) => {
		await page.goto("/");
		const content =
			(await page
				.locator('meta[name="viewport"]')
				.getAttribute("content")) ?? "";
		expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/);
		expect(content).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
	});
});
